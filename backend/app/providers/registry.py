"""
Provider selection.

Reads STT_PROVIDER / TTS_PROVIDER / TRANSLATION_PROVIDER / AI_PROVIDER
from settings and returns the matching concrete implementation.
"""

from __future__ import annotations

from functools import lru_cache

from app.config import settings
from app.providers.base import (
    AIProvider,
    STTProvider,
    TranslationProvider,
    TTSProvider,
)


@lru_cache
def get_stt_provider() -> STTProvider:
    if settings.stt_provider == "sarvam":
        from app.providers.sarvam_stt import SarvamSTTProvider

        return SarvamSTTProvider()

    if settings.stt_provider == "openai":
        from app.providers.openai_stt import OpenAISTTProvider

        return OpenAISTTProvider()

    raise ValueError(
        f"Unknown STT_PROVIDER: '{settings.stt_provider}'"
    )


@lru_cache
def get_tts_provider() -> TTSProvider:
    if settings.tts_provider == "sarvam":
        # Sarvam TTS is implemented through the existing TTS service.
        from app.providers.sarvam_tts import SarvamTTSProvider

        return SarvamTTSProvider()

    if settings.tts_provider == "openai":
        from app.providers.openai_tts import OpenAITTSProvider

        return OpenAITTSProvider()

    if settings.tts_provider == "piper":
        from app.providers.piper_tts import PiperTTSProvider

        return PiperTTSProvider()

    raise ValueError(
        f"Unknown TTS_PROVIDER: '{settings.tts_provider}'"
    )


@lru_cache
def get_translation_provider() -> TranslationProvider:
    if settings.translation_provider == "sarvam":
        from app.providers.sarvam_translation import SarvamTranslationProvider

        return SarvamTranslationProvider()

    if settings.translation_provider == "google":
        from app.providers.google_translation import GoogleTranslationProvider

        return GoogleTranslationProvider()

    if settings.translation_provider == "libretranslate":
        from app.providers.libretranslate import LibreTranslateProvider

        return LibreTranslateProvider()

    if settings.translation_provider == "mymemory":
        from app.providers.mymemory_translation import MyMemoryTranslationProvider

        return MyMemoryTranslationProvider()

    raise ValueError(
        f"Unknown TRANSLATION_PROVIDER: '{settings.translation_provider}'"
    )


@lru_cache
def get_ai_provider() -> AIProvider:
    if settings.ai_provider == "sarvam":
        from app.providers.sarvam_ai import SarvamAIProvider

        return SarvamAIProvider()

    if settings.ai_provider == "openai":
        from app.providers.openai_ai import OpenAIProvider

        return OpenAIProvider()

    raise ValueError(
        f"Unknown AI_PROVIDER: '{settings.ai_provider}'"
    )