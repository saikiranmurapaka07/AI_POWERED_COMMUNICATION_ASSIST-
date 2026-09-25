// Simple in-memory TTS cache & prefetch manager.
// Caches ArrayBuffer audio by language and normalized text: `${lang}:${normalizedText}`.
// Prevents duplicate simultaneous requests by storing in-flight Promises.
// English audio cache is strictly isolated from Hindi, Telugu, and other languages.

import { synthesizeSpeech } from "../api/backend.js";

function normalize(text) {
  return (text || "").trim().replace(/\s+/g, " ");
}

function getLanguage(opts) {
  if (typeof opts === "string") return opts;
  return opts?.language || "en";
}

function makeKey(text, opts = {}) {
  const norm = normalize(text);
  if (!norm) return "";
  const lang = getLanguage(opts);
  // Include speaker, pace and temperature in cache key so different
  // voice settings cache separately.
  const speaker = typeof opts === "object" ? opts.speaker || "default" : "default";
  const pace = typeof opts === "object" ? String(opts.pace ?? "1.0") : "1.0";
  const temperature = typeof opts === "object" ? String(opts.temperature ?? "0.5") : "0.5";
  return `${lang}:${speaker}:p${pace}:t${temperature}:${norm}`;
}

const cache = new Map(); // key -> { arrayBuffer?: ArrayBuffer, promise?: Promise<ArrayBuffer> }

export function hasAudio(text, opts = {}) {
  const key = makeKey(text, opts);
  if (!key) return false;
  const rec = cache.get(key);
  if (rec && rec.arrayBuffer) {
    console.debug("ttsCache: cache hit", key);
    return true;
  }
  return false;
}

export function isPending(text, opts = {}) {
  const key = makeKey(text, opts);
  if (!key) return false;
  const rec = cache.get(key);
  return Boolean(rec && rec.promise && !rec.arrayBuffer);
}

/**
 * Prefetch TTS for normalized `text` and specified `language`.
 * Strictly ensures one in-flight promise per `${language}:${text}` key.
 * Successful responses are cached by language. Failures are never cached.
 */
export function prefetch(text, opts = {}) {
  const norm = normalize(text);
  if (!norm) return Promise.reject(new Error("Empty text"));

  const key = makeKey(norm, opts);
  const lang = getLanguage(opts);
  const synthOpts = typeof opts === "object" ? { ...opts, language: lang } : { language: lang };

  const existing = cache.get(key);
  if (existing) {
    if (existing.arrayBuffer) {
      console.debug("ttsCache: returning cached audio for", key);
      return Promise.resolve(existing.arrayBuffer);
    }
    if (existing.promise) {
      console.debug("ttsCache: reusing in-flight request for", key);
      return existing.promise;
    }
  }

  console.debug("ttsCache: prefetch started for", key);

  const maxAttempts = 5;
  const delays = [500, 1000, 2000, 3000]; // ms, between retries

  const p = (async () => {
    // store placeholder so concurrent callers reuse this promise
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const ts = new Date().toISOString();
        console.debug(`${ts} ttsCache: TTS attempt ${attempt} for ${key}`);
        try {
          console.debug(`${ts} ttsCache: fetch start for ${key}`);
          const buf = await synthesizeSpeech(norm, synthOpts);
          const ts2 = new Date().toISOString();
          console.debug(`${ts2} ttsCache: TTS succeeded for ${key} bytes=${buf?.byteLength || 0}`);
          // store the ArrayBuffer
          cache.set(key, { arrayBuffer: buf });
          return buf;
        } catch (err) {
          const now = new Date().toISOString();
          // Determine retryability
          const isNetwork = err && (err.code === "network" || err.name === "TypeError");
          const status = err && err.status ? Number(err.status) : null;

          if (isNetwork) {
            console.warn(`${now} ttsCache: network error on attempt ${attempt} for ${key}:`, err.message || err);
          } else if (status && status >= 500) {
            console.warn(`${now} ttsCache: server 5xx on attempt ${attempt} for ${key}: status=${status}`);
          } else {
            // Non-retryable: 4xx or other non-transient errors.
            console.error(`${now} ttsCache: non-retryable TTS error for ${key}:`, err);
            // Clean up
            const rec = cache.get(key);
            if (rec && rec.promise) cache.delete(key);
            throw err;
          }

          // If we reach here, it's retryable (network or 5xx)
          if (attempt < maxAttempts) {
            const delayMs = delays[Math.min(attempt - 1, delays.length - 1)];
            console.debug(`${new Date().toISOString()} ttsCache: retrying attempt ${attempt + 1} for ${key} after ${delayMs}ms`);
            await new Promise((r) => setTimeout(r, delayMs));
            // continue to next attempt
            continue;
          } else {
            // final failure after retries
            console.error(`${new Date().toISOString()} ttsCache: all retries failed for ${key}`);
            const rec = cache.get(key);
            if (rec && rec.promise) cache.delete(key);
            const userErr = new Error("Voice service temporarily unavailable. Please try again.");
            userErr.code = "unavailable";
            throw userErr;
          }
        }
      }
      // Should not reach here
      throw new Error("Unexpected TTS flow");
    } catch (finalErr) {
      // Ensure we don't cache failures
      const rec = cache.get(key);
      if (rec && rec.promise) cache.delete(key);
      throw finalErr;
    }
  })();

  // store the in-flight promise immediately
  cache.set(key, { promise: p });
  return p;
}

export async function getAudio(text, opts = {}) {
  const norm = normalize(text);
  if (!norm) throw new Error("Empty text");

  const key = makeKey(norm, opts);
  const rec = cache.get(key);
  if (rec) {
    if (rec.arrayBuffer) return rec.arrayBuffer;
    if (rec.promise) {
      console.debug("ttsCache: awaiting existing in-flight promise for", key);
      return await rec.promise;
    }
  }

  // No cache entry — start a request and return it.
  return await prefetch(norm, opts);
}

export function clearCache() {
  cache.clear();
}

export default {
  normalize,
  makeKey,
  hasAudio,
  isPending,
  prefetch,
  getAudio,
  clearCache,
};
