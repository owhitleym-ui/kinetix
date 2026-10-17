/** Client for Form Check coach API (OCI GenAI via FastAPI). */

const API_BASE = (typeof window !== "undefined" && window.FORM_CHECK_API)
  || "http://127.0.0.1:8000";

const CUE_TIMEOUT_MS = 1500;
const CHAT_TIMEOUT_MS = 12000;
const SUMMARY_TIMEOUT_MS = 15000;

async function post(path, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCue(payload) {
  try {
    const data = await post("/coach/cue", payload, CUE_TIMEOUT_MS);
    return { text: (data.text || "").trim(), source: data.source || "oci", ok: true };
  } catch {
    const fallback = payload.good ? "Good form. Keep going." : (payload.short || "Fix your form");
    return { text: fallback, source: "local", ok: false };
  }
}

export async function fetchChat({ message, history, session_context }) {
  try {
    const data = await post("/coach/chat", { message, history, session_context }, CHAT_TIMEOUT_MS);
    return { reply: (data.reply || "").trim(), source: data.source || "oci", ok: true };
  } catch (e) {
    return { reply: "Coach is unavailable right now. Try again in a moment.", source: "error", ok: false, error: String(e) };
  }
}

export async function fetchSummary(session_context) {
  try {
    const data = await post("/coach/summary", { session_context }, SUMMARY_TIMEOUT_MS);
    return {
      summary: data.summary || "",
      tips: Array.isArray(data.tips) ? data.tips : [],
      source: data.source || "oci",
      ok: true,
    };
  } catch {
    return {
      summary: "Session complete. Review your rep log for what to practice.",
      tips: ["Keep facing the camera.", "Finish each rep fully.", "Reset to the start position between reps."],
      source: "local",
      ok: false,
    };
  }
}

export { API_BASE };
