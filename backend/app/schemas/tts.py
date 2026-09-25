from __future__ import annotations

from pydantic import BaseModel


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None
    language: str | None = None
    speaker: str | None = None
    pace: float | None = None
    temperature: float | None = None
