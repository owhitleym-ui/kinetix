/**
 * Drop-in natural voice speaker — call speakNatural(text) instead of speechSynthesis.
 *
 * Usage from Form Check (later):
 *   import { speakNatural } from "../voice-feedback/browser/naturalSpeak.js";
 *   // in speak(): await speakNatural(text);
 */
const TTS_BASE = (typeof window !== "undefined" && window.FORM_CHECK_TTS)
  || "http://127.0.0.1:3002";

let currentAudio = null;
let objectUrl = null;

function revoke() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

/** Stop any in-flight neural cue (barge-in / new rep). */
export function stopNatural() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  revoke();
}

/**
 * Speak text with OpenAI neural TTS via the local proxy.
 * Falls back to browser speechSynthesis if the proxy is down.
 */
export async function speakNatural(text, { voice, fallback = true } = {}) {
  const line = String(text || "").trim();
  if (!line) return { ok: false, reason: "empty" };

  stopNatural();

  try {
    const r = await fetch(`${TTS_BASE}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: line, voice }),
    });
    if (!r.ok) throw new Error(`tts ${r.status}`);
    const blob = await r.blob();
    objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    currentAudio = audio;
    await audio.play();
    return { ok: true, source: "openai-tts" };
  } catch (e) {
    console.warn("[naturalSpeak] proxy failed", e.message || e);
    if (!fallback || !("speechSynthesis" in window)) {
      return { ok: false, reason: String(e.message || e) };
    }
    const u = new SpeechSynthesisUtterance(line);
    u.lang = "en-US";
    u.rate = 1.05;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return { ok: true, source: "browser-fallback" };
  }
}

export { TTS_BASE };
