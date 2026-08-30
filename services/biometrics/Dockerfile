FROM python:3.11-slim

# cmake + a C++ toolchain + BLAS/LAPACK are needed to build dlib from source
# (no prebuilt wheel for every platform/Python combination); poppler-utils
# for pdf2image, same as services/ocr.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    libopenblas-dev \
    liblapack-dev \
    poppler-utils \
    libgl1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# MiniFASNet-V2 passive anti-spoofing model — Apache 2.0, ONNX export of
# minivision-ai/Silent-Face-Anti-Spoofing's pretrained weights (bit-
# equivalent to their upstream .pth file). Fetched here rather than
# committed to git, same posture as Tesseract's language data being an
# apt-installed dependency, not vendored source. Must come AFTER `COPY app
# ./app` — that COPY would otherwise clobber this directory.
RUN mkdir -p app/models && curl -L -o app/models/minifasnet_v2.onnx \
    https://huggingface.co/garciafido/minifasnet-v2-anti-spoofing-onnx/resolve/main/minifasnet_v2.onnx

# No published port in docker-compose.yml — internal-only, reachable from
# apps/api's container only, same posture as services/ocr.
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
