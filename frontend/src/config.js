// Central place for build-time config pulled from Vite env vars
// (see .env.example at the repo root — VITE_-prefixed vars only,
// never a secret: those stay backend-only).

// In dev, prefer a relative backend URL so the Vite dev server can proxy
// `/api` to the backend. This avoids mixed-content HTTPS vs HTTP issues when
// the dev server is served over HTTPS but the backend is plain HTTP.
const defaultBackend = "";
const env = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {};
export const BACKEND_URL = env.VITE_BACKEND_URL || defaultBackend;
export const STUN_URLS = env.VITE_STUN_URLS || "stun:stun.l.google.com:19302";
export const TURN_URL = env.VITE_TURN_URL || "";
export const TURN_USERNAME = env.VITE_TURN_USERNAME || "";
export const TURN_CREDENTIAL = env.VITE_TURN_CREDENTIAL || "";

export function buildIceServers() {
  const servers = [];
  const stunUrls = STUN_URLS.split(",").map((s) => s.trim()).filter(Boolean);
  if (stunUrls.length) {
    servers.push({ urls: stunUrls });
  }
  if (TURN_URL) {
    servers.push({
      urls: TURN_URL,
      username: TURN_USERNAME || undefined,
      credential: TURN_CREDENTIAL || undefined,
    });
  }
  return servers;
}
