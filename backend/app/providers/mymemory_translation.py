"""MyMemory translation provider (public, no billing required).

This provider uses the MyMemory free API (https://mymemory.translated.net)
and supports the project's language pairs. It is tolerant of unexpected
responses and maps errors to the provider exception classes used by the app.
"""
from __future__ import annotations

import httpx
from urllib.parse import urlencode

from app.providers.base import TranslationProvider, TranslationResult
from app.providers.exceptions import (
    MalformedResponseError,
    ProviderTimeoutError,
    ProviderUnavailableError,
    UnsupportedLanguageError,
)

_PROVIDER_NAME = "mymemory"


class MyMemoryTranslationProvider(TranslationProvider):
    BASE_URL = "https://api.mymemory.translated.net/get"

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

        params = {"q": text, "langpair": f"{source_language}|{target_language}"}
        url = f"{self.BASE_URL}?{urlencode(params)}"

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(url)
        except httpx.TimeoutException as exc:
            raise ProviderTimeoutError(f"MyMemory request timed out: {exc}", provider=_PROVIDER_NAME) from exc
        except httpx.RequestError as exc:
            raise ProviderUnavailableError(f"Could not reach MyMemory service: {exc}", provider=_PROVIDER_NAME) from exc

        if resp.status_code >= 500:
            raise ProviderUnavailableError(f"MyMemory service error (status {resp.status_code}).", provider=_PROVIDER_NAME)

        if resp.status_code != 200:
            raise MalformedResponseError(f"MyMemory returned unexpected status {resp.status_code}: {resp.text[:300]}", provider=_PROVIDER_NAME)

        try:
            data = resp.json()
            translated = data.get("responseData", {}).get("translatedText")
            if not translated:
                raise ValueError("missing translatedText")
        except (ValueError, KeyError) as exc:
            raise MalformedResponseError(f"Could not parse MyMemory response: {exc} - raw: {resp.text[:500]}", provider=_PROVIDER_NAME) from exc

        return TranslationResult(translated_text=translated, source_language=source_language, target_language=target_language)
