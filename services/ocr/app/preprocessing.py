"""Image preprocessing before OCR — raw phone-camera photos of documents
need this or Tesseract accuracy craters. Deskew, denoise, contrast/threshold.
"""

import cv2
import numpy as np


def load_image(image_bytes: bytes) -> np.ndarray:
    array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode image — file is not a valid/supported image")
    return image


def deskew(gray: np.ndarray) -> np.ndarray:
    """Detects and corrects small rotation (a crooked phone-camera photo),
    via the minimum-area bounding rectangle of foreground (text) pixels."""
    inverted = cv2.bitwise_not(gray)
    _, thresh = cv2.threshold(inverted, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    coords = np.column_stack(np.where(thresh > 0))
    if coords.shape[0] < 20:
        # Not enough foreground detected to estimate a reliable angle —
        # better to skip deskewing than rotate based on noise.
        return gray

    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle

    # Small angles only — a large "correction" is more likely a misdetection
    # than an actual rotated document.
    if abs(angle) < 0.5 or abs(angle) > 15:
        return gray

    (h, w) = gray.shape[:2]
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(gray, matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def preprocess_for_ocr(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = deskew(gray)

    denoised = cv2.fastNlMeansDenoising(gray, h=10)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    contrasted = clahe.apply(denoised)

    # Adaptive threshold handles uneven lighting (e.g. glare on a laminated
    # passport photo page) better than a single global threshold.
    thresholded = cv2.adaptiveThreshold(
        contrasted, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
    )
    return thresholded
