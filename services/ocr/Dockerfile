FROM python:3.11-slim

# tesseract-ocr + Arabic/English trained data, poppler-utils for pdf2image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-ara \
    tesseract-ocr-eng \
    poppler-utils \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# --timeout/--retries: pip's default 15s per-read timeout is too short for
# a slow-but-sustained connection on a large wheel (opencv-python-headless
# alone is 61MB) — found failing three times in a row on this exact
# connection, always the same package, always a clean ReadTimeoutError
# partway through, not a real download failure. Same class of fix as this
# project's other retry/timeout hardening (e.g. the login rate limiter).
RUN pip install --no-cache-dir --timeout 120 --retries 5 -r requirements.txt

COPY app ./app

# No published port in docker-compose.yml — internal-only, reachable from
# apps/api's container only. See the Phase 1 plan for why.
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
