// Thin fetch wrappers around the FastAPI backend. This is the ONLY place
// the frontend talks to the backend, and the backend is the ONLY place
// provider API keys are used — nothing here ever touches OpenAI/Google
// directly or sees a secret.

import { BACKEND_URL } from "../config.js";

async function throwForErrorResponse(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    // body wasn't JSON (or was empty) — fall through to a generic message
  }
  const message = body?.message || `Request failed with status ${res.status}`;
  const err = new Error(message);
  err.status = res.status;
  err.providerErrorType = body?.error || null;
  err.provider = body?.provider || null;
  throw err;
}

export async function fetchHealth() {
  const res = await fetch(`${BACKEND_URL}/api/health`);
  if (!res.ok) await throwForErrorResponse(res);
  return res.json();
}

/**
 * Synthesize speech for `text`. Returns a real audio ArrayBuffer (MP3) —
 * caller is expected to decode it with the Web Audio API and feed it into
 * the shared AudioMixer, never play it with browser speechSynthesis.
 */
export async function synthesizeSpeech(text, { voice, language, speaker, pace, temperature } = {}) {
  let res;
  try {
    res = await fetch(`${BACKEND_URL}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, language, speaker, pace, temperature }),
    });
  } catch (err) {
    const e = new Error(`Network error while fetching TTS: ${err.message}`);
    e.code = "network";
    throw e;
  }

  if (!res.ok) await throwForErrorResponse(res);

  try {
    return await res.arrayBuffer();
  } catch (err) {
    const e = new Error(`Failed to read TTS response body: ${err.message}`);
    e.code = "body-read";
    throw e;
  }
}

export async function transcribeAudio(blob, { language, filename = "audio.webm" } = {}) {
  const form = new FormData();
  form.append("file", blob, filename);
  if (language) form.append("language", language);
  const res = await fetch(`${BACKEND_URL}/api/stt`, { method: "POST", body: form });
  if (!res.ok) await throwForErrorResponse(res);
  return res.json();
}

export async function translateText(text, sourceLanguage, targetLanguage) {
  const res = await fetch(`${BACKEND_URL}/api/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      source_language: sourceLanguage,
      target_language: targetLanguage,
    }),
  });
  if (!res.ok) await throwForErrorResponse(res);
  return res.json();
}

export async function generateAIReply(message, { conversationHistory, language } = {}) {
  const res = await fetch(`${BACKEND_URL}/api/ai/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      conversation_history: conversationHistory,
      language,
    }),
  });
  if (!res.ok) await throwForErrorResponse(res);
  return res.json();
}

export async function searchAssist({
  speaker,
  message,
  conversationHistory = [],
  language = "English",
}) {
  const response = await fetch(
    `${BACKEND_URL}/api/ai/assist`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        speaker,
        message,
        conversation_history: conversationHistory,
        language,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Search Assist failed (${response.status}): ${errorText}`
    );
  }

  return response.json();
}


export async function needsSearch({
  message,
  language = "English",
}) {
  const response = await fetch(
    `${BACKEND_URL}/api/ai/needs-search`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        language,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Search decision failed (${response.status}): ${errorText}`
    );
  }

  return response.json();
}
