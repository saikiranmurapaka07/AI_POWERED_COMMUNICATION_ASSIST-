"""Sarvam translation provider.

POST https://api.sarvam.ai/translate
Auth header: api-subscription-key: <SARVAM_API_KEY>

Maps internal language codes to Sarvam locale codes and preserves the
project TranslationProvider interface and TranslationResult shape.
"""
from __future__ import annotations

import httpx

from app.config import settings
import logging
from app.providers.base import TranslationProvider, TranslationResult
from app.providers.exceptions import (
    MissingCredentialsError,
    InvalidCredentialsError,
    ProviderUnavailableError,
    ProviderTimeoutError,
    RateLimitError,
    MalformedResponseError,
    UnsupportedLanguageError,
)

_PROVIDER_NAME = "sarvam"
_ENDPOINT = "https://api.sarvam.ai/translate"
_CHAR_LIMIT = 2000

# Mapping from internal short codes to Sarvam locale codes
_LANG_MAP = {
    "en": "en-IN",
    "hi": "hi-IN",
    "bn": "bn-IN",
    "ta": "ta-IN",
    "te": "te-IN",
    "gu": "gu-IN",
    "kn": "kn-IN",
    "ml": "ml-IN",
    "mr": "mr-IN",
    "pa": "pa-IN",
    "or": "od-IN",
}


class SarvamTranslationProvider(TranslationProvider):
    SUPPORTED_LANGUAGES = {
    "en", "hi", "bn", "ta", "te",
    "gu", "kn", "ml", "mr", "pa", "or"
}
    def __init__(self) -> None:
        if not settings.sarvam_api_key:
            raise MissingCredentialsError(
                "SARVAM_API_KEY is not set. Set it in backend/.env to use Sarvam.",
                provider=_PROVIDER_NAME,
            )
        self._api_key = settings.sarvam_api_key

    async def translate(self, text: str, source_language: str, target_language: str) -> TranslationResult:
        if not text or not text.strip():
            raise MalformedResponseError("Cannot translate empty text.", provider=_PROVIDER_NAME)

        if (
            source_language not in self.SUPPORTED_LANGUAGES
            or target_language not in self.SUPPORTED_LANGUAGES
        ):
            raise UnsupportedLanguageError(
                f"Unsupported language pair '{source_language}' -> '{target_language}'. Supported languages: {sorted(self.SUPPORTED_LANGUAGES)}.",
                provider=_PROVIDER_NAME,
            )

        if source_language == target_language:
            return TranslationResult(translated_text=text, source_language=source_language, target_language=target_language)

        if len(text) > _CHAR_LIMIT:
            raise MalformedResponseError(
                f"Text length {len(text)} exceeds Sarvam limit of {_CHAR_LIMIT} characters.", provider=_PROVIDER_NAME
            )

        sarvam_source = _LANG_MAP.get(source_language)
        sarvam_target = _LANG_MAP.get(target_language)

        # Sarvam API expects a flat string in `input` and explicit language code keys.
        # Use the current model explicitly as required.
        payload = {
            "input": text,
            "source_language_code": sarvam_source,
            "target_language_code": sarvam_target,
            "model": "sarvam-translate:v1",
        }

        headers = {"api-subscription-key": self._api_key, "Content-Type": "application/json"}

        logger = logging.getLogger("app.providers.sarvam")
        resp = None
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(_ENDPOINT, json=payload, headers=headers, follow_redirects=True)
        except httpx.TimeoutException as exc:
            # Safe debug log before raising
            try:
                logger.debug(
                    "sarvam-request: source=%s target=%s input_len=%d http_status=%s",
                    source_language,
                    target_language,
                    len(text) if text is not None else 0,
                    None,
                )
            except Exception:
                pass
            raise ProviderTimeoutError(f"Sarvam request timed out: {exc}", provider=_PROVIDER_NAME) from exc
        except httpx.RequestError as exc:
            try:
                logger.debug(
                    "sarvam-request: source=%s target=%s input_len=%d http_status=%s",
                    source_language,
                    target_language,
                    len(text) if text is not None else 0,
                    None,
                )
            except Exception:
                pass
            raise ProviderUnavailableError(f"Could not reach Sarvam service: {exc}", provider=_PROVIDER_NAME) from exc

        # Safe debug log after a response is available
        try:
            status = resp.status_code if resp is not None else None
        except Exception:
            status = None
        try:
            logger.debug(
                "sarvam-request: source=%s target=%s input_len=%d http_status=%s",
                source_language,
                target_language,
                len(text) if text is not None else 0,
                status,
            )
        except Exception:
            pass

        # Authentication
        if resp.status_code in (401, 403):
            raise InvalidCredentialsError(
                f"Sarvam rejected the API key (status {resp.status_code}): {resp.text[:300]}", provider=_PROVIDER_NAME
            )

        if resp.status_code == 429:
            raise RateLimitError("Sarvam rate limit exceeded.", provider=_PROVIDER_NAME)

        if 400 <= resp.status_code < 500:
            # Client errors (bad request, unsupported languages, etc.)
            raise MalformedResponseError(
                f"Sarvam returned {resp.status_code}: {resp.text[:500]}", provider=_PROVIDER_NAME
            )

        if resp.status_code >= 500:
            raise ProviderUnavailableError(
                f"Sarvam service error (status {resp.status_code}).", provider=_PROVIDER_NAME
            )

        try:
            data = resp.json()
        except ValueError as exc:
            raise MalformedResponseError(
                f"Could not parse Sarvam JSON response: {exc} - raw: {resp.text[:500]}", provider=_PROVIDER_NAME
            ) from exc

        # Try several common response shapes
        translated_text = None
        # 1) { "translatedText": "..." }
        if isinstance(data, dict):
            translated_text = data.get("translatedText") or data.get("translation") or data.get("translated_text")
            # 2) Some APIs return { "data": { "translations": [ { "translatedText": "..." } ] } }
            if not translated_text:
                try:
                    translated_text = data["data"]["translations"][0]["translatedText"]
                except Exception:
                    translated_text = None

        if not translated_text:
            # Fallback: if body is a plain string
            body_text = resp.text.strip()
            if body_text:
                translated_text = body_text

        if not translated_text:
            raise MalformedResponseError(
                f"Sarvam returned an unexpected response shape: {str(data)[:1000]}", provider=_PROVIDER_NAME
            )

        return TranslationResult(translated_text=translated_text, source_language=source_language, target_language=target_language)
