from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class ConversationTurn(BaseModel):
    role: str  # "user" = User B, "assistant" = User A
    content: str


class AIReplyRequest(BaseModel):
    message: str
    conversation_history: Optional[List[ConversationTurn]] = None
    language: Optional[str] = None


class AIReplyResponse(BaseModel):
    reply_text: str


class AISuggestionsRequest(BaseModel):
    conversation_history: List[ConversationTurn]
    language: Optional[str] = None


class AISuggestionsResponse(BaseModel):
    suggestions: List[str] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Search Assist
# --------------------------------------------------------------------------

class AIAssistRequest(BaseModel):
    speaker: str  # "A" or "B"
    message: str
    conversation_history: Optional[List[ConversationTurn]] = None
    language: Optional[str] = None


class AIAssistResponse(BaseModel):
    answer: str
    answer_for: str  # The participant who should receive the answer
    suggestions: list[str] = Field(default_factory=list)


class AISearchDecisionRequest(BaseModel):
    message: str
    language: Optional[str] = None


class AISearchDecisionResponse(BaseModel):
    needs_search: bool
