"""POST /api/tts — synthesize speech and return real audio bytes.

The response body IS the audio (audio/mpeg), not JSON. The frontend fetches
this, decodes it with the Web Audio API (AudioContext.decodeAudioData), and
feeds the resulting buffer into the shared mixer that feeds the outgoing
WebRTC track — the same path used for typed, translated, gaze, and AI TTS.
"""
from __future__ import annotations

from fastapi import APIRouter, Response, Request, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
import os
import logging

from app.schemas.tts import TTSRequest
from app.services.tts_service import (
    generate_speech_wav,
    generate_speech_wav_async,
    PiperNotFoundError,
    PiperModelMissingError,
)

router = APIRouter(tags=["tts"])

logger = logging.getLogger("app.api.tts")


@router.post("/api/tts")
async def synthesize_speech(request: Request, payload: TTSRequest) -> Response:
    # Log request origin and headers to aid debugging when preflight fails
    origin = request.headers.get("origin")
    logger.info("TTS request from origin=%s path=%s", origin, request.url.path)

    try:
        # Offload blocking TTS work to a thread and serialize via a
        # semaphore to avoid spawning concurrent heavy TTS processes.
        # Forward the optional `language` from the frontend so providers
        # (e.g. Sarvam) can select the correct locale mapping.
        wav_path, content_type = await generate_speech_wav_async(
            payload.text,
            voice=payload.voice,
            language=payload.language,
            speaker=payload.speaker,
            pace=payload.pace,
            temperature=payload.temperature,
        )
    except PiperNotFoundError as exc:
        logger.error("Piper not found: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
    except PiperModelMissingError as exc:
        logger.error("Piper model missing: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.exception("TTS generation failed: %s", exc)
        raise HTTPException(status_code=502, detail="TTS generation failed")

    # Stream the file without loading it fully into memory and delete the
    # temporary file after the response has been sent.
    def _cleanup(path: str) -> None:
        try:
            if os.path.exists(path):
                os.remove(path)
                logger.info("Temporary WAV cleaned up: %s", path)
        except OSError:
            logger.warning("Failed to remove temporary WAV: %s", path)

    return FileResponse(path=wav_path, media_type=content_type, background=BackgroundTask(_cleanup, wav_path))
