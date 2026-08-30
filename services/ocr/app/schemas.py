from typing import List, Literal

from pydantic import BaseModel


class ExtractedField(BaseModel):
    name: str
    value: str
    confidence: float  # 0.0-1.0


class ExtractionResponse(BaseModel):
    rawText: str
    fields: List[ExtractedField]
    overallConfidence: float


DocumentType = Literal["PASSPORT", "BIRTH_CERTIFICATE"]
