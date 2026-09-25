"""Sarvam AI chat-completion provider."""
from __future__ import annotations

import httpx

from app.config import settings
from app.providers.base import AIProvider, AIReplyResult
from app.providers.exceptions import (
    InvalidCredentialsError,
    MalformedResponseError,
    MissingCredentialsError,
    ProviderTimeoutError,
    ProviderUnavailableError,
    RateLimitError,
)

_PROVIDER_NAME = "sarvam_ai"
_ENDPOINT = "https://api.sarvam.ai/v1/chat/completions"
_MODEL = "sarvam-105b-conversations"

_BASE_INSTRUCTIONS = (
    "You are an accessible communication assistant helping a user who may "
    "have limited mobility or speech participate naturally in a live voice "
    "call with another person. Keep replies short, natural, and conversational. "
    "The reply will be spoken aloud, so do not use markdown, bullet lists, "
    "emojis, or unnecessary explanations."
)


class SarvamAIProvider(AIProvider):
    def __init__(self) -> None:
        if not settings.sarvam_api_key:
            raise MissingCredentialsError(
                "SARVAM_API_KEY is not set.",
                provider=_PROVIDER_NAME,
            )

        self._api_key = settings.sarvam_api_key

    async def generate_reply(
        self,
        message: str,
        conversation_history: list[dict] | None = None,
        language: str | None = None,
    ) -> AIReplyResult:
        if not message or not message.strip():
            raise MalformedResponseError(
                "Cannot generate a reply to empty input.",
                provider=_PROVIDER_NAME,
            )

        messages = [
            {
                "role": "system",
                "content": _BASE_INSTRUCTIONS
                + (f" Respond in {language}." if language else ""),
            }
        ]

        for turn in conversation_history or []:
            role = turn.get("role", "user")
            content = turn.get("content", "")

            if content and role in ("user", "assistant"):
                messages.append(
                    {
                        "role": role,
                        "content": content,
                    }
                )

        messages.append(
            {
                "role": "user",
                "content": message,
            }
        )

        payload = {
            "model": _MODEL,
            "messages": messages,
            "temperature": 0.5,
            "max_tokens": 150,
        }

        headers = {
            "api-subscription-key": self._api_key,
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    _ENDPOINT,
                    json=payload,
                    headers=headers,
                )
        except httpx.TimeoutException as exc:
            raise ProviderTimeoutError(
                f"Sarvam AI request timed out: {exc}",
                provider=_PROVIDER_NAME,
            ) from exc
        except httpx.RequestError as exc:
            raise ProviderUnavailableError(
                f"Could not reach Sarvam AI: {exc}",
                provider=_PROVIDER_NAME,
            ) from exc

        if response.status_code in (401, 403):
            raise InvalidCredentialsError(
                "Sarvam AI rejected the API key.",
                provider=_PROVIDER_NAME,
            )

        if response.status_code == 429:
            raise RateLimitError(
                "Sarvam AI rate limit exceeded.",
                provider=_PROVIDER_NAME,
            )

        if response.status_code >= 500:
            raise ProviderUnavailableError(
                f"Sarvam AI server error: {response.status_code}",
                provider=_PROVIDER_NAME,
            )

        if response.status_code >= 400:
            raise MalformedResponseError(
                f"Sarvam AI returned {response.status_code}: "
                f"{response.text[:500]}",
                provider=_PROVIDER_NAME,
            )

        try:
            data = response.json()
            text = data["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise MalformedResponseError(
                f"Unexpected Sarvam AI response: {response.text[:1000]}",
                provider=_PROVIDER_NAME,
            ) from exc

        if not isinstance(text, str) or not text.strip():
            raise MalformedResponseError(
                "Sarvam AI returned an empty response.",
                provider=_PROVIDER_NAME,
            )

        return AIReplyResult(reply_text=text.strip())
