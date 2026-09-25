"""Application configuration.

Loaded from environment variables (and a local `.env` file if present in the
backend/ working directory — copy `.env.example` from the repo root to
`backend/.env` and fill in real values). No secrets ever live in source
control or in frontend code; the frontend only ever talks to this backend.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- Server ---
    environment: str = "development"
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    # Development default (Vite dev server) plus the production Vercel origin
    cors_origins: str = "http://localhost:5173,https://ai-voicecall-communicating-assist.vercel.app"

    # A sensible default regex that matches localhost, 127.0.0.1, and
    # common private LAN ranges (10.x.x.x, 192.168.x.x, 172.16-31.x.x).
    # This allows preflight requests from the dev server when accessed
    # via a LAN IP without requiring the developer to update .env.
    cors_origin_regex: str = r"^https?://(localhost|127\\.0\\.0\\.1|10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3}|172\\.(1[6-9]|2[0-9]|3[0-1])\\.\\d{1,3}\\.\\d{1,3})(:\\d+)?$"

    # --- Provider selection ---

    stt_provider: str = "sarvam"
    tts_provider: str = "sarvam"
    translation_provider: str = "sarvam"
    ai_provider: str = "openai"

    # --- OpenAI (STT, TTS, AI) ---
    openai_api_key: str | None = None
    openai_stt_model: str = "gpt-4o-mini-transcribe"
    openai_tts_model: str = "gpt-4o-mini-tts"
    openai_tts_voice: str = "alloy"
    openai_ai_model: str = "gpt-4o-mini"

    # --- Local Piper TTS ---
    # Path to the Piper CLI executable (or just "piper" if on PATH)
    piper_executable: str = "piper"
    # Path to the Piper model file or model directory. Default assumes
    # models are placed under backend/models/piper/<model>.
    piper_model_path: str = "models/piper/en_US-lessac-medium"
    # Preferred voice/model id
    piper_voice: str = "en_US-lessac-medium"

    # --- TTS provider selection ---
    # Set to 'piper' (default) or 'sarvam' to use Sarvam Bulbul v3.
   

    # --- Google Cloud Translation ---
    google_translate_api_key: str | None = None
    # Base URL for translation provider (LibreTranslate-compatible).
    translation_base_url: str | None = None
    # Sarvam API key
    sarvam_api_key: str | None = None

    # --- WebRTC ---
    stun_urls: str = "stun:stun.l.google.com:19302"
    turn_url: str | None = None
    turn_username: str | None = None
    turn_credential: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
