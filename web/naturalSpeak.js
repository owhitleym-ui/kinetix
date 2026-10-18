/**
 * Neural TTS only (OpenAI via voice-feedback proxy). Female voice. No browser speechSynthesis.
 * Lines are queued so they never overlap. Playback is gain-boosted for louder coach audio.
 */
const TTS_BASE = (typeof window !== "undefined" && window.FORM_CHECK_TTS)
  || "http://127.0.0.1:3002";

/** OpenAI female-presenting voice */
const FEMALE_VOICE = "nova";

/** Playback loudness multiplier (1 = normal; 2–2.5 feels much clearer on laptop speakers). */
const PLAYBACK_GAIN = 2.35;

let currentAudio = null;
let objectUrl = null;
let queue = Promise.resolve();
let speakGeneration = 0;
let audioCtx = null;
let gainNode = null;

function revoke() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function killBrowserSpeech() {
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}

function ensureAudioGraph() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) {
    audioCtx = new AC();
    gainNode = audioCtx.createGain();
    gainNode.gain.value = PLAYBACK_GAIN;
    gainNode.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return { audioCtx, gainNode };
}

export function stopNatural() {
  speakGeneration++;
  queue = Promise.resolve();
  if (currentAudio) {
    try { currentAudio.pause(); } catch { /* ignore */ }
    currentAudio.onended = null;
    currentAudio.src = "";
    currentAudio = null;
  }
  revoke();
  killBrowserSpeech();
}

function playBlob(blob) {
  return new Promise((resolve, reject) => {
    revoke();
    objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    audio.volume = 1; // max element volume; extra loudness via Web Audio gain
    currentAudio = audio;

    const graph = ensureAudioGraph();
    let cleaned = false;
    const finish = (err) => {
      if (cleaned) return;
      cleaned = true;
      if (currentAudio === audio) currentAudio = null;
      if (err) reject(err);
      else resolve();
    };

    audio.onended = () => finish();
    audio.onerror = () => finish(new Error("audio_play_failed"));

    const start = async () => {
      try {
        if (graph?.audioCtx && graph?.gainNode) {
          const src = graph.audioCtx.createMediaElementSource(audio);
          src.connect(graph.gainNode);
        }
        await audio.play();
      } catch (e) {
        finish(e);
      }
    };
    start();
  });
}

async function fetchAndPlay(text, voice) {
  killBrowserSpeech();
  const r = await fetch(`${TTS_BASE}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: voice || FEMALE_VOICE }),
  });
  if (!r.ok) throw new Error(`tts ${r.status}`);
  await playBlob(await r.blob());
  return { ok: true, source: "openai-tts" };
}

/**
 * @param {string} text
 * @param {{ voice?: string, interrupt?: boolean }} [opts]
 */
export function speakNatural(text, { voice = FEMALE_VOICE, interrupt = false } = {}) {
  const line = String(text || "").trim();
  if (!line) return Promise.resolve({ ok: false, reason: "empty" });

  if (interrupt) stopNatural();

  const gen = speakGeneration;
  const job = async () => {
    if (gen !== speakGeneration) return { ok: false, reason: "cancelled" };
    try {
      return await fetchAndPlay(line, voice);
    } catch (e) {
      console.warn("[naturalSpeak]", e.message || e);
      return { ok: false, reason: String(e.message || e) };
    }
  };

  queue = queue.then(job, job);
  return queue;
}

export async function ttsHealth() {
  try {
    const r = await fetch(`${TTS_BASE}/health`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export { TTS_BASE, FEMALE_VOICE, PLAYBACK_GAIN };
