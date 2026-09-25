"""LibreTranslate provider implementation.

Uses a configurable base URL (TRANSLATION_BASE_URL) and the standard
LibreTranslate `/translate` endpoint. Does not require any billing or
Google credentials. Translates only the project's supported languages
(en, hi, te) and maps HTTP/timeout errors to the provider exception
hierarchy.
"""
from __future__ import annotations

import httpx

from app.config import settings
from app.providers.base import TranslationProvider, TranslationResult
from app.providers.exceptions import (
    MalformedResponseError,
    ProviderTimeoutError,
    ProviderUnavailableError,
    RateLimitError,
    UnsupportedLanguageError,
)

_PROVIDER_NAME = "libretranslate"


class LibreTranslateProvider(TranslationProvider):
    def __init__(self) -> None:
        # Use a default public instance if the env var isn't set.
        self.base_url = (settings.translation_base_url or "https://libretranslate.de").rstrip("/")

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
            return TranslationResult(
                translated_text=text, source_language=source_language, target_language=target_language
            )

        endpoint = f"{self.base_url}/translate"
        payload = {
            "q": text,
            "source": source_language,
            "target": target_language,
            "format": "text",
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                # Some public instances issue redirects for POST endpoints;
                # allow following redirects so the request succeeds.
                resp = await client.post(endpoint, json=payload, follow_redirects=True)
        except httpx.TimeoutException as exc:
            raise ProviderTimeoutError(f"LibreTranslate request timed out: {exc}", provider=_PROVIDER_NAME) from exc
        except httpx.RequestError as exc:
            raise ProviderUnavailableError(f"Could not reach LibreTranslate service: {exc}", provider=_PROVIDER_NAME) from exc

        if resp.status_code == 429:
            raise RateLimitError("LibreTranslate rate limit exceeded.", provider=_PROVIDER_NAME)

        if resp.status_code >= 500:
            raise ProviderUnavailableError(
                f"LibreTranslate service error (status {resp.status_code}).", provider=_PROVIDER_NAME
            )

        if resp.status_code != 200:
            # Attempt to surface any useful error message returned by the service.
            text_snippet = resp.text[:500]
            raise MalformedResponseError(
                f"LibreTranslate returned unexpected status {resp.status_code}: {text_snippet}", provider=_PROVIDER_NAME
            )

        try:
            data = resp.json()
            # LibreTranslate returns { "translatedText": "..." }
            translated_text = data.get("translatedText") or data.get("translated_text")
            if not translated_text:
                # Some instances return a plain string or different shape — fall back to raw text.
                raise ValueError("missing translatedText")
        except (ValueError, KeyError) as exc:
            raise MalformedResponseError(
                f"Could not parse LibreTranslate response: {exc} - raw: {resp.text[:500]}", provider=_PROVIDER_NAME
            ) from exc

        return TranslationResult(
            translated_text=translated_text, source_language=source_language, target_language=target_language
        )
