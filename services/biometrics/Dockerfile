# Stage 1: convert the OFFICIAL minivision-ai/Silent-Face-Anti-Spoofing
# PyTorch checkpoints to ONNX (see scripts/convert_minifasnet.py for why
# this project converts from source rather than trusting a pre-built ONNX
# file — two independent community re-exports turned out to be
# non-functional). torch is only ever needed here, at build time; it never
# reaches the final runtime image.
FROM python:3.11-slim AS model-convert
# onnxscript: a second real bug found by actually building this image for
# the first time — `pip install torch` (unpinned) resolved a newer torch
# than this script was last run against, and recent torch versions moved
# torch.onnx.export()'s internals to depend on onnxscript, which isn't
# pulled in automatically. Without it: "ModuleNotFoundError: No module
# named 'onnxscript'", failing the whole conversion step.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir onnx onnxscript onnxruntime numpy
COPY scripts/convert_minifasnet.py /convert/convert_minifasnet.py
RUN python /convert/convert_minifasnet.py /convert/models

# Stage 2: the actual runtime service.
FROM python:3.11-slim

# cmake + a C++ toolchain + BLAS/LAPACK are needed to build dlib from source
# (no prebuilt wheel for every platform/Python combination); poppler-utils
# for pdf2image, same as services/ocr. git is required too — a real bug
# found by actually running `docker build` for the first time (nobody had
# a working Docker install to catch this before): requirements.txt
# installs face_recognition_models via a `git+https://...` URL (it's not
# on PyPI), and python:3.11-slim has no git at all, so pip failed with
# "Cannot find command 'git'" before this was added.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    libopenblas-dev \
    liblapack-dev \
    poppler-utils \
    libgl1 \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY --from=model-convert /convert/models/minifasnet_v2.onnx app/models/minifasnet_v2.onnx
COPY --from=model-convert /convert/models/minifasnet_v1se_4.0.onnx app/models/minifasnet_v1se_4.0.onnx

# No published port in docker-compose.yml — internal-only, reachable from
# apps/api's container only, same posture as services/ocr.
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
