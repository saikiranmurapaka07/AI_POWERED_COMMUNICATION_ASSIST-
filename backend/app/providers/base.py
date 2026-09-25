"""Abstract provider interfaces.

Every route and every piece of application logic depends on these
interfaces — never on a concrete SDK (openai, google-cloud-translate, etc.)
directly. Swapping providers means writing a new class that implements one
of these and wiring it into `app/providers/registry.py`; nothing else
changes.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


# --------------------------------------------------------------------------
# Speech-to-text
# --------------------------------------------------------------------------
@dataclass
class TranscriptionResult:
    text: str
    language: str | None = None


class STTProvider(ABC):
    @abstractmethod
    async def transcribe(
        self,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        language: str | None = None,
    ) -> TranscriptionResult:
        """Transcribe raw audio bytes into text."""
        raise NotImplementedError


# --------------------------------------------------------------------------
# Text-to-speech
# --------------------------------------------------------------------------
@dataclass
class SpeechResult:
    audio_bytes: bytes
    content_type: str  # e.g. "audio/mpeg"


class TTSProvider(ABC):
    @abstractmethod
    async def synthesize(
        self,
        text: str,
        voice: str | None = None,
        language: str | None = None,
    ) -> SpeechResult:
        """Synthesize speech audio for text.

        Must return real, decodable audio bytes (e.g. MP3) — this is what
        gets fetched by the frontend, decoded with the Web Audio API, and
        fed into the outgoing WebRTC audio track. It is never played via
        browser speechSynthesis.
        """
        raise NotImplementedError


# --------------------------------------------------------------------------
# Translation
# --------------------------------------------------------------------------
@dataclass
class TranslationResult:
    translated_text: str
    source_language: str
    target_language: str


class TranslationProvider(ABC):
    # Expand supported languages to include the 11 requested Indian languages.
    SUPPORTED_LANGUAGES = {"en", "hi", "bn", "ta", "te", "gu", "kn", "ml", "mr", "pa", "or"}

    @abstractmethod
    async def translate(
        self,
        text: str,
        source_language: str,
        target_language: str,
    ) -> TranslationResult:
        raise NotImplementedError


# --------------------------------------------------------------------------
# AI replies
# --------------------------------------------------------------------------
@dataclass
class AIReplyResult:
    reply_text: str


class AIProvider(ABC):
    @abstractmethod
    async def generate_reply(
        self,
        message: str,
        conversation_history: list[dict] | None = None,
        language: str | None = None,
    ) -> AIReplyResult:
        """Generate a context-aware reply. Callers pass the result through
        TTSProvider.synthesize() before it reaches the audio mixer."""
        raise NotImplementedError
