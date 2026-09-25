from pathlib import Path

from pathlib import Path
from dotenv import load_dotenv

# Always load the backend .env regardless of the current working directory.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
"""FastAPI application entrypoint.

Run locally with:
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
(from inside backend/, with backend/.env populated — see .env.example at
the repo root).
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import ai, health, stt, translate, tts
from app.config import settings
from app.errors import register_error_handlers

app = FastAPI(
    title="AI Accessible Communication Assistant — Backend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
    
        "https://ai-powered-communication-assist.vercel.app",
],
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)

app.include_router(health.router)
app.include_router(stt.router)
app.include_router(tts.router)
app.include_router(translate.router)
app.include_router(ai.router)

