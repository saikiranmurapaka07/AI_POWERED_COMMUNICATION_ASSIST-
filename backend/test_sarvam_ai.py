import asyncio
import httpx
from app.config import settings

async def test():
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            "https://api.sarvam.ai/v1/chat/completions",
            headers={
                "api-subscription-key": settings.sarvam_api_key,
                "Content-Type": "application/json",
            },
            json={
                "model": "sarvam-105b-conversations",
                "messages": [
                    {"role": "system", "content": "Reply briefly and naturally."},
                    {"role": "user", "content": "Hello, how are you?"},
                ],
                "temperature": 0.5,
                "max_tokens": 100,
            },
        )

        print("STATUS:", r.status_code)

        try:
            data = r.json()
            if r.status_code == 200:
                print("RESPONSE:", data["choices"][0]["message"]["content"])
            else:
                print("ERROR:", data.get("message") or data.get("error") or str(data))
        except Exception:
            print("RESPONSE:", r.text[:1000])

asyncio.run(test())
