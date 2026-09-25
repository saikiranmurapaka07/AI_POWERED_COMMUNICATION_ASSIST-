from app.config import settings
from app.providers.registry import get_ai_provider

provider = get_ai_provider()

print("AI_PROVIDER:", settings.ai_provider)
print("AI_CLASS:", type(provider).__name__)