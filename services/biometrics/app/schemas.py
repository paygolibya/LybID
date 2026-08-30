from typing import Literal, Optional

from pydantic import BaseModel

LivenessVerdict = Literal["LIVE", "SPOOF", "UNKNOWN"]
FaceMatchVerdict = Literal["MATCH", "NO_MATCH", "UNKNOWN"]


class FaceMatchResult(BaseModel):
    score: Optional[float] = None  # Euclidean distance — lower is more similar
    verdict: FaceMatchVerdict
    reason: Optional[str] = None  # set when verdict is UNKNOWN, e.g. "no_face_detected"


class LivenessResult(BaseModel):
    score: Optional[float] = None  # anti-spoofing confidence — higher is more likely live
    verdict: LivenessVerdict
    reason: Optional[str] = None


class VerifyResponse(BaseModel):
    faceMatch: FaceMatchResult
    liveness: LivenessResult
    engine: str
    rawResult: dict
