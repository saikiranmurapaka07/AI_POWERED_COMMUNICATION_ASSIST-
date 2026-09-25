from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import asyncio
import time
from typing import Tuple

from app.config import settings
from app.providers.exceptions import ProviderError

import logging

logger = logging.getLogger("app.services.tts")

# Semaphore to limit concurrent Piper jobs (process-wide). Keep at 1 for
# Render Free instance to avoid CPU overload.
_piper_semaphore = asyncio.Semaphore(1)


class PiperNotFoundError(ProviderError):
    status_code = 500


class PiperModelMissingError(ProviderError):
    status_code = 500


def _resolve_executable(path: str) -> str | None:
    """Resolve an executable path. If `path` is absolute, verify it exists.
    If `path` is a bare name, try to find it on PATH.
    Returns the resolved path or None if not found."""

    if os.path.isabs(path) or os.path.dirname(path):
        # Absolute or relative path provided
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
        return None

    # Bare executable name; try PATH.
    found = shutil.which(path)
    return found


def _validate_model_path(model_path: str) -> str | None:
    """Validate the model path. Accepts either a model directory or a
    single model file (e.g. *.onnx). Returns the path to pass to Piper or
    None if missing."""

    if not model_path:
        return None

    # If it's a single file (onnx), accept it.
    if os.path.isfile(model_path):
        return model_path

    # If it's a directory, ensure it contains at least one .onnx file
    if os.path.isdir(model_path):
        for name in os.listdir(model_path):
            if name.lower().endswith(".onnx"):
                return model_path
        return None

    return None


def generate_speech_wav(
    text: str,
    voice: str | None = None,
    max_chars: int = 5000,
    language: str | None = None,
    speaker: str | None = None,
    pace: float | None = None,
    temperature: float | None = None,
) -> Tuple[bytes, str]:
    """Generate WAV audio.

    By default this used Piper. To minimize changes, keep the same
    function signature and behavior, but if `settings.tts_provider` is
    set to "sarvam" call the Sarvam Bulbul v3 TTS HTTP API and write
    the returned audio to a temporary WAV file for the existing
    streaming/cleanup path to remain unchanged.
    """

    if not text or not text.strip():
        raise ProviderError("Empty text is not allowed for TTS.", provider="tts")

    if max_chars and len(text) > max_chars:
        raise ProviderError(f"Text exceeds maximum length of {max_chars} characters.", provider="tts")

    # If configured to use Sarvam for TTS, call its text-to-speech endpoint.
    if getattr(settings, "tts_provider", "piper") == "sarvam":
        # Local import to avoid adding global dependency unless used.
        import httpx
        import base64

        # Map short language codes to Sarvam locales for the supported 11 languages.
        LANG_MAP = {
            "en": "en-IN",
            "hi": "hi-IN",
            "bn": "bn-IN",
            "ta": "ta-IN",
            "te": "te-IN",
            "kn": "kn-IN",
            "ml": "ml-IN",
            "mr": "mr-IN",
            "gu": "gu-IN",
            "pa": "pa-IN",
            "or": "or-IN",
        }

        # Prefer explicit language parameter if provided (two-letter code)
        cand = None
        if language and len(language) == 2:
            cand = language
        elif voice and len(voice) == 2:
            cand = voice
        if not cand:
            cand = "en"

        locale = LANG_MAP.get(cand, "en-IN")

        api_key = settings.sarvam_api_key
        if not api_key:
            raise PiperNotFoundError("SARVAM_API_KEY is not configured in backend/.env", provider="sarvam")

        # Sarvam TTS JSON endpoint: returns {"request_id":..., "audios": ["<base64>"]}
        # Use the 'text' field (Sarvam expects 'text' or 'inputs').
        # Map frontend speaker identifiers to Sarvam Bulbul v3 speaker names.
        SPEAKER_MAP = {
            "default": "aditya",
            "bulbul_male": "aditya",
            "bulbul_female": "neha",
            "bulbul_neutral": "manan",
        }
        sarvam_speaker = SPEAKER_MAP.get((speaker or "default").lower(), speaker or "aditya")

        payload = {
            "text": text,
            "language_code": locale,
            "model": "bulbul:v3",
            "speaker": sarvam_speaker,
        }
        # Add optional numeric params if provided and valid
        if pace is not None:
            payload["pace"] = float(pace)
        if temperature is not None:
            payload["temperature"] = float(temperature)
        headers = {
            "api-subscription-key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        logger.debug("Sarvam TTS request: locale=%s input_len=%d", locale, len(text))

        try:
            with httpx.Client(timeout=60.0) as client:
                resp = client.post("https://api.sarvam.ai/text-to-speech", json=payload, headers=headers)
        except httpx.RequestError as exc:
            raise ProviderError(f"Sarvam TTS request failed: {exc}", provider="sarvam") from exc

        if resp.status_code in (401, 403):
            raise ProviderError("Sarvam TTS rejected API key.", provider="sarvam")
        if resp.status_code >= 500:
            raise ProviderError(f"Sarvam TTS service error {resp.status_code}", provider="sarvam")
        if resp.status_code >= 400:
            # Client errors (bad request, unsupported language, etc.)
            raise ProviderError(f"Sarvam TTS error {resp.status_code}: {resp.text[:300]}", provider="sarvam")

        try:
            data = resp.json()
        except ValueError as exc:
            raise ProviderError(f"Could not parse Sarvam JSON response: {exc}", provider="sarvam") from exc

        audios = data.get("audios") if isinstance(data, dict) else None
        if not audios or not isinstance(audios, list) or not audios[0]:
            raise ProviderError("Sarvam TTS returned no audio entries.", provider="sarvam")

        # Decode the first base64 audio string. Do NOT log the base64 data.
        try:
            audio_bytes = base64.b64decode(audios[0])
        except Exception as exc:
            raise ProviderError(f"Failed to decode Sarvam audio: {exc}", provider="sarvam") from exc

        if not audio_bytes:
            raise ProviderError("Sarvam TTS returned empty audio bytes.", provider="sarvam")

        # Write to temporary WAV file so existing FileResponse cleanup works.
        fd, out_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            with open(out_path, "wb") as f:
                f.write(audio_bytes)

            # Quick header validation (RIFF/WAVE)
            header_ok = False
            try:
                with open(out_path, "rb") as audio_file:
                    hdr = audio_file.read(12)
                    if len(hdr) >= 12 and hdr[0:4] == b"RIFF" and hdr[8:12] == b"WAVE":
                        header_ok = True
            except OSError:
                header_ok = False

            if not header_ok:
                # Cleanup and raise
                try:
                    if os.path.exists(out_path):
                        os.remove(out_path)
                except OSError:
                    pass
                raise ProviderError("Sarvam TTS returned non-WAV audio.", provider="sarvam")

            return out_path, "audio/wav"
        except Exception:
            # Cleanup on error
            try:
                if os.path.exists(out_path):
                    os.remove(out_path)
            except OSError:
                pass
            raise

    # Fallback to original Piper behavior (unchanged)
    # Existing implementation expects Piper binary, so call into it.
    # Keep original behavior by delegating to previously implemented logic.
    # Reuse current piper_exe_conf and model resolution below.
    if not text or not text.strip():
        raise ProviderError("Empty text is not allowed for TTS.", provider="piper")

    if max_chars and len(text) > max_chars:
        raise ProviderError(f"Text exceeds maximum length of {max_chars} characters.", provider="piper")

    piper_exe_conf = settings.piper_executable
    model_path_conf = settings.piper_model_path

    if not piper_exe_conf:
        raise PiperNotFoundError("Piper executable path is not configured.", provider="piper")

    piper_resolved = _resolve_executable(piper_exe_conf)
    if not piper_resolved:
        raise PiperNotFoundError(f"Piper executable not found: {piper_exe_conf}", provider="piper")

    model_resolved = _validate_model_path(model_path_conf)
    if not model_resolved:
        raise PiperModelMissingError(f"Piper model not found: {model_path_conf}", provider="piper")

    # Piper writes directly to this WAV file.
    fd, out_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)

    try:
        cmd = [
            piper_resolved,
            "--model",
            model_resolved,
            "--output_file",
            out_path,
        ]

        # Allow an optional voice override
        voice_to_use = voice or settings.piper_voice
        if voice_to_use:
            cmd.extend(["--voice", voice_to_use])

        timeout_seconds = int(os.getenv("PIPER_TIMEOUT", "60"))

        # Time the Piper subprocess separately from WAV processing
        piper_start = time.time()
        result = subprocess.run(
            cmd,
            input=text + "\n",
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        piper_end = time.time()
        piper_ms = int((piper_end - piper_start) * 1000)

        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            stdout = (result.stdout or "").strip()
            details = stderr or stdout or "Unknown Piper error."
            raise ProviderError(
                f"Piper CLI failed with exit code {result.returncode}: {details}",
                provider="piper",
            )

        if not os.path.isfile(out_path):
            raise ProviderError("Piper completed but did not create a WAV file.", provider="piper")

        # Validate WAV header by reading only the first 12 bytes to avoid
        # loading the entire file into memory.
        wav_start = time.time()
        header_ok = False
        try:
            with open(out_path, "rb") as audio_file:
                hdr = audio_file.read(12)
                if len(hdr) >= 12 and hdr[0:4] == b"RIFF" and hdr[8:12] == b"WAVE":
                    header_ok = True
        except OSError:
            header_ok = False
        wav_end = time.time()
        wav_ms = int((wav_end - wav_start) * 1000)

        if not header_ok:
            # Attempt to clean up the file before raising
            try:
                if os.path.exists(out_path):
                    os.remove(out_path)
            except OSError:
                pass
            raise ProviderError("Piper output is not a valid WAV file.", provider="piper")

        total_ms = int((time.time() - piper_start) * 1000)
        logger.info("TTS timings: piper=%dms wav_read=%dms total=%dms", piper_ms, wav_ms, total_ms)

        # Return the path to the WAV file instead of loading bytes into memory.
        return out_path, "audio/wav"

    except subprocess.TimeoutExpired as exc:
        # Ensure temp file cleanup on timeout
        try:
            if os.path.exists(out_path):
                os.remove(out_path)
        except OSError:
            pass
        raise ProviderError(f"Piper TTS timed out after {timeout_seconds} seconds.", provider="piper") from exc

    except FileNotFoundError as exc:
        # Cleanup any temp file
        try:
            if os.path.exists(out_path):
                os.remove(out_path)
        except OSError:
            pass
        raise PiperNotFoundError(f"Piper executable could not be started: {piper_resolved}", provider="piper") from exc
    finally:
        # Note: do not remove out_path here on success because the caller
        # (route) is responsible for streaming and deleting the file.
        # On failure paths above we already attempted cleanup.
        pass


async def generate_speech_wav_async(
    text: str,
    voice: str | None = None,
    max_chars: int = 5000,
    language: str | None = None,
    speaker: str | None = None,
    pace: float | None = None,
    temperature: float | None = None,
) -> Tuple[bytes, str]:
    """Async wrapper that serializes Piper jobs via a semaphore and runs
    the blocking work in a threadpool so the FastAPI event loop isn't
    blocked. Returns the same (audio_bytes, content_type) tuple as the
    synchronous function.
    """
    start_total = time.time()
    wait_start = time.time()
    # Acquire semaphore to serialize Piper work
    await _piper_semaphore.acquire()
    wait_ms = int((time.time() - wait_start) * 1000)
    logger.info("TTS queue wait: %dms", wait_ms)
    try:
        # Log a clear start marker (do not log user text)
        logger.info("TTS started (queue_wait=%dms)", wait_ms)

        run_start = time.time()
        # Run the blocking generator in a separate thread to avoid blocking
        # the event loop. This reuses the synchronous implementation which
        # already handles timeouts and cleanup.
        result = await asyncio.to_thread(
    generate_speech_wav,
    text,
    voice,
    max_chars,
    language,
    speaker,
    pace,
    temperature
)
        run_ms = int((time.time() - run_start) * 1000)
        total_ms = int((time.time() - start_total) * 1000)
        # Log synthesis and total timings at INFO so they appear in Render logs
        logger.info("Piper synthesis: %dms", run_ms)
        logger.info("Total TTS: %dms", total_ms)
        # Clear finish marker
        logger.info("TTS finished (total=%dms)", total_ms)
        return result
    finally:
        _piper_semaphore.release()