"""Converts the OFFICIAL minivision-ai/Silent-Face-Anti-Spoofing PyTorch
checkpoints to ONNX, with weights embedded inline (not external-data split
— simpler to deploy for models this small, ~1.9MB each).

Why this exists at all rather than just downloading a ready-made ONNX file:
during Phase 2's real-photo smoke test, TWO independent community ONNX
re-exports of this exact model (a Hugging Face upload and a GitHub repo's
pre-built export) both turned out to be non-functional — every input tested
(a real selfie, random noise, all-zeros, all-ones) produced nearly identical
output, meaning the exported graph wasn't meaningfully using its input at
all. Converting directly from the project's own official .pth checkpoints
and its own model definition code removes that trust dependency entirely.

This is a one-off/build-time script — it needs `torch`, which the runtime
service (onnxruntime only) does not otherwise depend on. Run it once (or
let the Dockerfile's build stage run it); the resulting .onnx files are
what the service actually loads.

Usage: python convert_minifasnet.py <output_dir>
"""
import sys
import urllib.request
from collections import OrderedDict
from pathlib import Path

import onnx
import torch

MINIFASNET_PY_URL = (
    "https://raw.githubusercontent.com/minivision-ai/Silent-Face-Anti-Spoofing/master/src/model_lib/MiniFASNet.py"
)
CHECKPOINTS = {
    # (checkpoint filename on the official repo, model class name, crop scale)
    "minifasnet_v2.onnx": (
        "2.7_80x80_MiniFASNetV2.pth",
        "MiniFASNetV2",
        2.7,
    ),
    "minifasnet_v1se_4.0.onnx": (
        "4_0_0_80x80_MiniFASNetV1SE.pth",
        "MiniFASNetV1SE",
        4.0,
    ),
}
CHECKPOINT_BASE_URL = (
    "https://raw.githubusercontent.com/minivision-ai/Silent-Face-Anti-Spoofing/master/resources/anti_spoof_models/"
)
# conv6_kernel=(5,5) — verified empirically from both checkpoints' own
# conv_6_dw.conv.weight shape ([512, 1, 5, 5]), NOT MiniFASNet.py's
# function-signature default of (7,7) (that default is for a different
# input resolution variant this project doesn't use).
CONV6_KERNEL = (5, 5)
NUM_CLASSES = 3


def _download(url: str, dest: Path) -> None:
    urllib.request.urlretrieve(url, dest)


def main(output_dir: str) -> None:
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dir = out_dir / "_convert_work"
    work_dir.mkdir(exist_ok=True)

    minifasnet_py = work_dir / "MiniFASNet.py"
    _download(MINIFASNET_PY_URL, minifasnet_py)
    sys.path.insert(0, str(work_dir))
    import MiniFASNet  # noqa: E402 — must import after download+path insert

    for onnx_filename, (ckpt_filename, model_class_name, _scale) in CHECKPOINTS.items():
        ckpt_path = work_dir / ckpt_filename
        _download(CHECKPOINT_BASE_URL + ckpt_filename, ckpt_path)

        state_dict = torch.load(ckpt_path, map_location="cpu")
        if isinstance(state_dict, dict) and "state_dict" in state_dict:
            state_dict = state_dict["state_dict"]
        # Checkpoints are saved from a DataParallel-wrapped model — strip
        # the "module." prefix, per the official anti_spoof_predict.py's
        # own loading logic.
        first_key = next(iter(state_dict.keys()))
        if first_key.startswith("module."):
            stripped = OrderedDict()
            for k, v in state_dict.items():
                stripped[k[len("module."):]] = v
            state_dict = stripped

        model_fn = getattr(MiniFASNet, model_class_name)
        model = model_fn(embedding_size=128, conv6_kernel=CONV6_KERNEL, num_classes=NUM_CLASSES)
        model.load_state_dict(state_dict, strict=True)
        model.eval()

        dummy_input = torch.randn(1, 3, 80, 80)
        onnx_tmp_path = work_dir / onnx_filename
        torch.onnx.export(
            model,
            dummy_input,
            str(onnx_tmp_path),
            input_names=["input"],
            output_names=["output"],
            dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
            opset_version=13,
        )

        # Re-save with weights embedded inline rather than as a sibling
        # external-data file — torch's exporter defaults to external data
        # for this model, which is easy to lose track of when only the
        # .onnx file gets copied/deployed.
        onnx_model = onnx.load(str(onnx_tmp_path), load_external_data=True)
        final_path = out_dir / onnx_filename
        onnx.save(onnx_model, str(final_path), save_as_external_data=False)
        print(f"Wrote {final_path}")

    import shutil

    shutil.rmtree(work_dir)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python convert_minifasnet.py <output_dir>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1])
