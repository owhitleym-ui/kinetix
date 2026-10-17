/** Browser speech-to-text for Ask coach (Web Speech API). */

export function supported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Ask for mic permission explicitly — SpeechRecognition alone often never prompts. */
export async function ensureMicPermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("no-media-devices");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  });
  stream.getTracks().forEach((t) => t.stop());
}

/**
 * Start recognition after mic permission is granted.
 * Returns { stop() }.
 *
 * Uses continuous mode until the first final phrase — one-shot mode often
 * ends before the user finishes speaking, especially right after TTS.
 */
export function listen({ onResult, onError, onEnd, onInterim, lang = "en-US" } = {}) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) {
    onError?.("unsupported");
    return null;
  }

  try {
    window.speechSynthesis?.cancel();
  } catch { /* ignore */ }

  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = true;

  let finalText = "";
  let interimText = "";
  let settled = false;
  let started = false;

  const finish = (text) => {
    if (settled) return;
    settled = true;
    const t = (text || "").trim();
    try { rec.stop(); } catch { /* ignore */ }
    if (t) onResult?.(t);
    else onError?.("no-speech");
  };

  rec.onstart = () => { started = true; };

  rec.onresult = (e) => {
    interimText = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const piece = e.results[i][0]?.transcript || "";
      if (e.results[i].isFinal) {
        finalText += `${piece} `;
        // First complete phrase → done (push-to-talk style).
        finish(finalText);
        return;
      }
      interimText += piece;
    }
    if (interimText) onInterim?.(interimText);
  };

  rec.onerror = (e) => {
    const code = e.error || "recognition-error";
    // "aborted" is normal when we call stop() after a final result.
    if (settled && code === "aborted") return;
    if (!settled) {
      settled = true;
      onError?.(code);
    }
  };

  rec.onend = () => {
    if (!settled) finish(finalText || interimText || "");
    onEnd?.();
  };

  // Start after a short pause so cancel()'d TTS releases the audio device.
  const startTimer = setTimeout(() => {
    try {
      rec.start();
    } catch (err) {
      if (!settled) {
        settled = true;
        onError?.(String(err?.message || err));
        onEnd?.();
      }
    }
  }, 150);

  // Safety: if nothing arrives in 8s, stop and report.
  const watchdog = setTimeout(() => {
    if (!settled) finish(finalText || interimText || "");
  }, 8000);

  return {
    stop() {
      clearTimeout(startTimer);
      clearTimeout(watchdog);
      if (settled) return;
      settled = true;
      try { rec.stop(); } catch { /* ignore */ }
      onEnd?.();
    },
  };
}

export { sleep };
