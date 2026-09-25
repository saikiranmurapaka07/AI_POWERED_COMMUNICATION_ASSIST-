from __future__ import annotations

import httpx

from app.config import settings
from app.providers.base import STTProvider, TranscriptionResult
from app.providers.exceptions import (
    InvalidCredentialsError,
    MalformedResponseError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)

_PROVIDER_NAME = "sarvam_stt"
_SARVAM_URL = "https://api.sarvam.ai/speech-to-text"


class SarvamSTTProvider(STTProvider):
    def __init__(self) -> None:
        if not settings.sarvam_api_key:
            raise InvalidCredentialsError(
                "SARVAM_API_KEY is not configured.",
                provider=_PROVIDER_NAME,
            )

        self._api_key = settings.sarvam_api_key

    async def transcribe(
        self,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        language: str | None = None,
    ) -> TranscriptionResult:

        if not audio_bytes:
            raise MalformedResponseError(
                "No audio data received to transcribe.",
                provider=_PROVIDER_NAME,
            )

        language_code_map = {
            "english": "en-IN",
            "hindi": "hi-IN",
            "telugu": "te-IN",
            "tamil": "ta-IN",
            "kannada": "kn-IN",
            "malayalam": "ml-IN",
            "marathi": "mr-IN",
            "bengali": "bn-IN",
            "gujarati": "gu-IN",
            "punjabi": "pa-IN",
            "odia": "od-IN",
            "assamese": "as-IN",
            "urdu": "ur-IN",
            "nepali": "ne-IN",
            "sanskrit": "sa-IN",
        }

        raw_language = (language or "").strip().lower()

        allowed_codes = {
            "unknown",
            "en-IN",
            "hi-IN",
            "te-IN",
            "ta-IN",
            "kn-IN",
            "ml-IN",
            "mr-IN",
            "bn-IN",
            "gu-IN",
            "pa-IN",
            "od-IN",
            "as-IN",
            "ur-IN",
            "ne-IN",
            "sa-IN",
        }

        language_code = language_code_map.get(
            raw_language,
            raw_language
            if raw_language in allowed_codes
            else "unknown",
        )

        # Sarvam expects the MIME type without codec parameters.
        # Example:
        # audio/webm;codecs=opus -> audio/webm
        clean_content_type = (
            (content_type or "audio/webm")
            .split(";")[0]
            .strip()
        )

        files = {
            "file": (
                filename,
                audio_bytes,
                clean_content_type,
            )
        }

        data = {
            "model": "saaras:v3",
            "mode": "transcribe",
            "language_code": language_code,
        }

        headers = {
            "api-subscription-key": self._api_key,
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    _SARVAM_URL,
                    headers=headers,
                    data=data,
                    files=files,
                )

        except httpx.TimeoutException as exc:
            raise ProviderTimeoutError(
                f"Sarvam STT request timed out: {exc}",
                provider=_PROVIDER_NAME,
            ) from exc

        except httpx.HTTPError as exc:
            raise ProviderUnavailableError(
                f"Could not reach Sarvam STT: {exc}",
                provider=_PROVIDER_NAME,
            ) from exc

        if response.status_code == 403:
            raise InvalidCredentialsError(
                "Sarvam rejected the API key.",
                provider=_PROVIDER_NAME,
            )

        if response.status_code >= 400:
            raise ProviderUnavailableError(
                f"Sarvam STT returned HTTP {response.status_code}: "
                f"{response.text}",
                provider=_PROVIDER_NAME,
            )

        try:
            result = response.json()
        except Exception as exc:
            raise MalformedResponseError(
                "Sarvam STT returned invalid JSON.",
                provider=_PROVIDER_NAME,
            ) from exc

        transcript = result.get("transcript")

        if not isinstance(transcript, str):
            raise MalformedResponseError(
                "Sarvam STT response did not contain 'transcript'.",
                provider=_PROVIDER_NAME,
            )

        return TranscriptionResult(
            text=transcript.strip(),
            language=result.get("language_code") or language,
        )