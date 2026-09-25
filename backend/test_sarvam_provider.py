import asyncio
from app.providers.sarvam_ai import SarvamAIProvider

async def test():
    provider = SarvamAIProvider()
    result = await provider.generate_reply(
        "I am feeling nervous about my presentation.",
        [
            {"role": "user", "content": "I have a presentation tomorrow."}
        ],
        "English",
    )
    print("AI REPLY:", result.reply_text)

asyncio.run(test())
