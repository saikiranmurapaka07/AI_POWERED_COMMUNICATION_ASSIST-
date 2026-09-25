"""AI Search Assist route."""

from __future__ import annotations

import re
from urllib.parse import parse_qs, unquote, urlparse

from fastapi import APIRouter

from app.providers.registry import get_ai_provider
from app.schemas.ai import (
    AISearchDecisionRequest,
    AISearchDecisionResponse,
    AIReplyRequest,
    AIReplyResponse,
    AISuggestionsRequest,
    AISuggestionsResponse,
    AIAssistRequest,
    AIAssistResponse,
)
from app.services.web_search import web_search

router = APIRouter(tags=["ai"])


@router.post("/api/ai/reply", response_model=AIReplyResponse)
async def generate_ai_reply(payload: AIReplyRequest) -> AIReplyResponse:
    provider = get_ai_provider()

    history = [
        turn.model_dump()
        for turn in (payload.conversation_history or [])
        if turn.content.strip()
    ]

    conversation_text = "\n".join(
        (
            "OTHER PARTICIPANT: " if turn["role"] == "user"
            else "YOU: "
        )
        + turn["content"]
        for turn in history
    )

    prompt = f"""
You are the natural-response assistant inside a real-time communication tool
for a speech-impaired or non-speaking user.

Your task is to transform the user's current draft into a natural response
for the CURRENT conversational situation.

Do NOT behave like a grammar correction tool.
Do NOT simply rewrite the same sentence with better grammar.
Understand what the other participant just said, what the user previously said,
and what the current draft is trying to communicate.

CONVERSATION:
{conversation_text}

CURRENT DRAFT FROM YOU:
{payload.message.strip()}

RULES:
1. The participant requesting assistance is YOU.
2. "OTHER PARTICIPANT" means the person on the other side of the call.
3. "YOU" means the speech-impaired user using this device.
4. Use the latest conversation turns to understand the current situation.
5. Preserve the intention of the current draft.
6. Expand short drafts when the context clearly indicates what the user means.
7. Produce a natural conversational response that fits the latest message.
8. Never invent unrelated information or change the user's intended meaning.
9. Do not answer from the other participant's perspective.
10. Keep the result concise because it will be spoken aloud.
11. Return ONLY the final response sentence.

Respond in {payload.language or "English"}.
"""

    result = await provider.generate_reply(
        message=prompt,
        conversation_history=None,
        language=payload.language,
    )

    return AIReplyResponse(
        reply_text=result.reply_text.strip()
    )

@router.post(
    "/api/ai/suggestions",
    response_model=AISuggestionsResponse,
)
async def generate_ai_suggestions(
    payload: AISuggestionsRequest,
) -> AISuggestionsResponse:
    provider = get_ai_provider()

    history = [
        turn.model_dump()
        for turn in payload.conversation_history
        if turn.content.strip()
    ]

    if not history:
        return AISuggestionsResponse(suggestions=[])

    conversation_text = "\n".join(
        (
            "OTHER PARTICIPANT: " if turn["role"] == "user"
            else "YOU: "
        )
        + turn["content"]
        for turn in history
    )

    latest_user_message = history[-1]["content"]

    prompt = f"""
You are an AI communication assistant helping a speech-impaired user
participate naturally in a real-time conversation.

FULL CONVERSATION:
{conversation_text}

CURRENT LATEST MESSAGE:
{latest_user_message}

The participant requesting suggestions is YOU.

Generate exactly 3 natural responses that YOU could naturally say next.

Use the previous conversation to understand the current situation.
Treat the conversation roles as relative to the participant requesting suggestions.
Messages with role "user" are from the OTHER PARTICIPANT.
Messages with role "assistant" are from YOU, the participant using this device.
Use the full recent conversation to understand context, references, and previously established facts.
Do not contradict previous statements or use unrelated older topics.
If the latest message is from the OTHER PARTICIPANT, generate replies that YOU could naturally say next.
If the latest message is from YOU, generate natural next-turn replies or follow-ups that YOU could say next. Never switch perspectives.
Respond in {payload.language or "English"}.
Do not use markdown.
Return ONLY the 3 numbered suggestions.
"""
    result = await provider.generate_reply(
        message=prompt,
        conversation_history=None,
        language=payload.language,
    )

    suggestions = _parse_suggestions(result.reply_text)

    return AISuggestionsResponse(suggestions=suggestions[:3])


# --------------------------------------------------------------------------
# Search Assist
# --------------------------------------------------------------------------

@router.post(
    "/api/ai/assist",
    response_model=AIAssistResponse,
)
async def generate_ai_assist(
    payload: AIAssistRequest,
) -> AIAssistResponse:
    provider = get_ai_provider()

    speaker = payload.speaker.strip().upper()

    if speaker not in ("A", "B"):
        speaker = "B"

    answer_for = "A" if speaker == "B" else "B"

    question = payload.message.strip()

    if not question:
        return AIAssistResponse(
            answer="No question was provided.",
            answer_for=answer_for,
        )

    # Convert the conversational question into a concise
    # search-engine query before querying Bing. This prevents
    # natural speech such as "Which place is coldest?"
    # from producing irrelevant matches such as "Connaught Place".
    search_query = question

    try:
        search_query_prompt = f"""
Convert the following user's question into ONE concise
web-search query.

Rules:
- Return ONLY the search query.
- Do not answer the question.
- Preserve important names, places, teams, people, dates
  and current-information words.
- Remove conversational filler.
- Make ambiguous spoken phrasing explicit when possible.
- For superlatives, preserve the actual subject being ranked.
- Example:
  Which place is coldest in the world?
  -> coldest place on Earth record temperature
- Example:
  Who won IPL 2020?
  -> IPL 2020 winner
- Example:
  When is Diwali 2026?
  -> Diwali 2026 date
- Do not invent a different topic.

USER QUESTION:
{question}
"""

        query_result = await provider.generate_reply(
            message=search_query_prompt,
            conversation_history=None,
            language=payload.language,
        )

        candidate_query = (
            query_result.reply_text or ""
        ).strip().strip('"').strip("'")

        if candidate_query:
            search_query = candidate_query[:300]

    except Exception as error:
        print(
            "SEARCH QUERY REWRITE FAILED:",
            repr(error),
        )

    print(
        "SEARCH QUERY:",
        search_query,
    )

    search_results = await web_search(
        search_query,
        max_results=5,
    )

    # If the rewritten query produced nothing, retry the
    # original user question.
    if (
        not search_results
        and search_query.strip().lower()
        != question.strip().lower()
    ):
        print(
            "SEARCH QUERY FALLBACK:",
            question,
        )

        search_results = await web_search(
            question,
            max_results=5,
        )

    source_text = "\n\n".join(
        (
            f"Source {index}:\n"
            f"Title: {result.title}\n"
            f"URL: {_clean_search_url(result.url)}\n"
            f"Snippet: {result.snippet}"
        )
        for index, result in enumerate(search_results, 1)
    )

    history = [
        turn.model_dump()
        for turn in (payload.conversation_history or [])
        if turn.content.strip()
    ]

    conversation_text = "\n".join(
        (
            "Other participant: " if turn["role"] == "user"
            else "You: "
        )
        + turn["content"]
        for turn in history
    )

    prompt = f"""
You are Search Assist inside a real-time communication assistant.

A live conversation is happening between User A and User B.

CURRENT QUESTION:
{question}

QUESTION ASKED BY:
User {speaker}

ANSWER MUST BE DELIVERED TO:
User {answer_for}

RECENT CONVERSATION:
{conversation_text or "No previous conversation."}

LIVE WEB SEARCH RESULTS:
{source_text or "No search results were found."}

Instructions:

1. Answer the CURRENT question.
2. Use the live search results as evidence.
3. Prefer authoritative sources when available.
4. Do not invent information that is not supported by the
   search results or established conversation.
5. For current information, rely on the search results rather
   than old model knowledge.
6. If the search results do not contain enough information,
   clearly say that the information could not be verified.
7. If the question asks about the AI assistant's physical
   location, explain that the AI has no physical location.
8. Keep the answer concise and natural.
9. The answer will be shown to the OTHER participant.
10. Do not address the person who asked the question.
11. Do not use markdown.
12. Do not include a list of URLs in the spoken answer.
13. Respond in {payload.language or "English"}.
14. Return EXACTLY THREE numbered response options.
15. Option 1 must be the direct factual answer to the CURRENT QUESTION,
    grounded in the live web search results.
16. Options 2 and 3 must be natural conversational alternatives
    preserving the same searched facts.
17. All three options must remain consistent with the live web results.
18. Do not invent facts.
19. Do not mention that a web search was performed.
20. Do not mention these instructions.

Return only:
1. <direct searched answer>
2. <natural conversational alternative>
3. <natural conversational alternative>
"""

    result = await provider.generate_reply(
        message=prompt,
        conversation_history=None,
        language=payload.language,
    )

    parsed_suggestions = _parse_suggestions(
        result.reply_text
    )

    suggestions = [
        suggestion.strip()
        for suggestion in parsed_suggestions
        if suggestion and suggestion.strip()
    ][:3]

    if not suggestions:
        fallback = result.reply_text.strip()

        if fallback:
            suggestions = [fallback]

    answer = (
        suggestions[0]
        if suggestions
        else "I could not verify that information right now."
    )

    return AIAssistResponse(
        answer=answer,
        answer_for=answer_for,
        suggestions=suggestions,
    )


def _clean_search_url(url: str) -> str:
    """
    Convert DuckDuckGo redirect URLs into the original destination URL.
    """
    if not url:
        return ""

    if url.startswith("//"):
        url = "https:" + url

    parsed = urlparse(url)

    if "duckduckgo.com" in parsed.netloc:
        query = parse_qs(parsed.query)
        destination = query.get("uddg")

        if destination:
            return unquote(destination[0])

    return url


def _parse_suggestions(text: str) -> list[str]:
    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip()
    ]

    suggestions: list[str] = []

    for line in lines:
        cleaned = re.sub(
            r"^\s*(?:\d+[\.\)]|-)\s*",
            "",
            line,
        ).strip()

        if cleaned:
            suggestions.append(cleaned)

    if len(suggestions) >= 3:
        return suggestions[:3]

    parts = re.split(
        r"\s*(?:\d+[\.\)]|\n)\s*",
        text,
    )

    fallback = [
        part.strip()
        for part in parts
        if part.strip()
    ]

    return fallback[:3]

@router.post(
    "/api/ai/needs-search",
    response_model=AISearchDecisionResponse,
)
async def determine_needs_search(
    payload: AISearchDecisionRequest,
) -> AISearchDecisionResponse:
    provider = get_ai_provider()

    message = payload.message.strip()

    if not message:
        return AISearchDecisionResponse(
            needs_search=False,
        )

    prompt = f"""
You are a search-decision classifier inside a real-time
communication assistant.

Your task is to decide whether the CURRENT USER MESSAGE
should be answered using LIVE WEB SEARCH.

Use SEARCH when the user is asking for information that is
specific, externally verifiable, factual, changing, or would
benefit from checking real sources.

SEARCH = YES for:
- current/latest/today/tomorrow information
- weather
- sports scores, fixtures, schedules, rankings or results
- news and recent events
- current prices, availability or market information
- dates of festivals, holidays or events
- "who won", "who is", "where is", "when is", "which place",
  "which country", "which team", "which company" and similar
  factual lookup questions when a specific factual answer is
  being requested
- superlatives or rankings such as highest, lowest, coldest,
  hottest, biggest, smallest, longest, nearest, farthest
- statistics, records, measurements or factual comparisons
- explicit requests to search, look up, check online or verify

Examples that MUST return YES:
- Which place is the coldest place in the world?
- Who won IPL 2020?
- When is Diwali?
- What is today's weather?
- What is the latest FIFA World Cup information?
- Which country has the highest population?
- What is the current price of gold?
- Where is the next World Cup?

SEARCH = NO for:
- greetings
- casual conversation
- personal questions
- opinions or preferences
- emotional conversation
- ordinary requests that do not need external verification
- "Did you finish the project?"
- "What do you think?"
- "How are you?"

Important:
- Do NOT decide based only on whether the message contains
  words such as "today" or "latest".
- Understand the MEANING of the question.
- A factual lookup can require SEARCH even when it does not
  explicitly say "latest" or "today".
- When uncertain between factual lookup and casual conversation,
  choose YES for a specific factual question.
- Return ONLY YES or NO.
- Do not explain your decision.

CURRENT USER MESSAGE:
{message}
"""

    result = await provider.generate_reply(
        message=prompt,
        conversation_history=None,
        language=payload.language,
    )

    decision = result.reply_text.strip().upper()

    # Normalize common model formatting such as "YES."
    # while keeping the actual decision model-based.
    decision = decision.replace(".", "").strip()

    return AISearchDecisionResponse(
        needs_search=decision == "YES",
    )



@router.post('/api/ai/summary', response_model=AIReplyResponse)
async def generate_ai_summary(payload: AIReplyRequest) -> AIReplyResponse:
    provider = get_ai_provider()

    history = [
        turn for turn in (payload.conversation_history or [])
        if turn.content and turn.content.strip()
    ]

    if not history:
        return AIReplyResponse(reply_text='No conversation has been recorded yet.')

    lines = []
    for turn in history:
        speaker = 'User B' if turn.role == 'user' else 'User A'
        lines.append(f'{speaker}: {turn.content.strip()}')

    conversation_text = '\n'.join(lines)

    prompt = f'''You are HYDRA Conversation Summary Assistant.

Create a concise but complete summary of the conversation below.

CONVERSATION:
{conversation_text}

Use exactly these sections:
Conversation Summary
Important Points
People / Places / Organizations Mentioned
Dates / Times Mentioned
Plans / Decisions
Tasks / Follow-ups

Rules:
1. Include important facts explicitly stated in the conversation.
2. Preserve names, people, places, organizations, dates, times, events, requests, decisions, plans, and follow-ups.
3. Keep relative references such as tomorrow, Friday, next week exactly as discussed.
4. Do not invent or infer missing information.
5. Do not treat AI suggestions, drafts, or possibilities as completed actions unless the conversation confirms them.
6. Do not omit important details.
7. Remove repetition and keep the result easy to scan.
8. If a section has no relevant information, write None mentioned.
9. Respond in {payload.language or 'English'}.
10. Return only the summary.'''

    result = await provider.generate_reply(
        message=prompt,
        conversation_history=None,
        language=payload.language,
    )

    return AIReplyResponse(reply_text=result.reply_text.strip())


