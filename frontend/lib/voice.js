/**
 * Web Speech API voice cues — throttled to once every 3 seconds.
 */

let lastSpokenAt = 0;
const THROTTLE_MS = 3000;

export function speakCue(text, language = "en") {
  if (typeof window === "undefined" || !window.speechSynthesis) return false;
  const now = Date.now();
  if (now - lastSpokenAt < THROTTLE_MS) return false;
  if (!text) return false;

  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = language === "es" ? "es-ES" : "en-US";
  utter.rate = 1.0;
  utter.pitch = 1.0;
  lastSpokenAt = now;
  window.speechSynthesis.speak(utter);
  return true;
}

export function resetVoiceThrottle() {
  lastSpokenAt = 0;
}

/**
 * Speak immediately, interrupting any current cue (no throttle).
 * REHAB26 coaching gives one cue per rep and must not drop the tempo "Back" beat.
 */
export function speakNow(text, language = "en") {
  if (typeof window === "undefined" || !window.speechSynthesis || !text) return false;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = language === "es" ? "es-ES" : "en-US";
  utter.rate = 1.05;
  lastSpokenAt = Date.now();
  window.speechSynthesis.speak(utter);
  return true;
}
