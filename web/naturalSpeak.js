/**
 * Neural TTS only (OpenAI via voice-feedback proxy). Female voice. No browser speechSynthesis.
 * Lines are queued so they never overlap. Playback is gain-boosted for louder coach audio.
 * Short cues are cached so repeats skip the network round-trip.
 */
const TTS_BASE = (typeof window !== "undefined" && window.FORM_CHECK_TTS)
  || "http://127.0.0.1:3002";

/** OpenAI female-presenting voice */
const FEMALE_VOICE = "nova";

/** Playback loudness multiplier (1 = normal; 2-2.5 feels much clearer on laptop speakers). */
const PLAYBACK_GAIN = 2.35;

const CACHE_MAX = 80;

let currentAudio = null;
let objectUrl = null;
let queue = Promise.resolve();
let speakGeneration = 0;
let audioCtx = null;
let gainNode = null;
/** Accepted speak jobs not yet finished (queued or in flight). */
let active = 0;
/** Abort in-flight TTS fetch when interrupted. */
let fetchAbort = null;
/** voice\\0text → Blob */
const blobCache = new Map();

function revoke() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function killBrowserSpeech() {
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}

function cacheKey(text, voice) {
  return `${voice || FEMALE_VOICE}\0${text}`;
}

function rememberBlob(key, blob) {
  if (blobCache.has(key)) blobCache.delete(key);
  blobCache.set(key, blob);
  while (blobCache.size > CACHE_MAX) {
    const oldest = blobCache.keys().next().value;
    blobCache.delete(oldest);
  }
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
  active = 0;
  if (fetchAbort) {
    try { fetchAbort.abort(); } catch { /* ignore */ }
    fetchAbort = null;
  }
  if (currentAudio) {
    try { currentAudio.pause(); } catch { /* ignore */ }
    currentAudio.onended = null;
    currentAudio.src = "";
    currentAudio = null;
  }
  revoke();
  killBrowserSpeech();
}

export function isSpeakBusy() {
  return active > 0;
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

async function getBlob(text, voice, signal) {
  const key = cacheKey(text, voice);
  const hit = blobCache.get(key);
  if (hit) return hit;

  const r = await fetch(`${TTS_BASE}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: voice || FEMALE_VOICE }),
    signal,
  });
  if (!r.ok) throw new Error(`tts ${r.status}`);
  const blob = await r.blob();
  rememberBlob(key, blob);
  return blob;
}

async function fetchAndPlay(text, voice) {
  killBrowserSpeech();
  const ac = new AbortController();
  fetchAbort = ac;
  try {
    const blob = await getBlob(text, voice, ac.signal);
    if (ac.signal.aborted) return { ok: false, reason: "cancelled" };
    await playBlob(blob);
    return { ok: true, source: "openai-tts" };
  } finally {
    if (fetchAbort === ac) fetchAbort = null;
  }
}

/**
 * Prefetch short cues into the blob cache (no playback). Call after a user gesture.
 * @param {string[]} phrases
 * @param {{ voice?: string }} [opts]
 */
export async function warmPhrases(phrases, { voice = FEMALE_VOICE } = {}) {
  const list = [...new Set((phrases || []).map((p) => String(p || "").trim()).filter(Boolean))];
  await Promise.allSettled(list.map(async (text) => {
    const key = cacheKey(text, voice);
    if (blobCache.has(key)) return;
    try {
      const r = await fetch(`${TTS_BASE}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });
      if (!r.ok) return;
      rememberBlob(key, await r.blob());
    } catch { /* ignore warm failures */ }
  }));
}

/**
 * @param {string} text
 * @param {{ voice?: string, interrupt?: boolean, dropIfBusy?: boolean }} [opts]
 */
export function speakNatural(text, { voice = FEMALE_VOICE, interrupt = false, dropIfBusy = false } = {}) {
  const line = String(text || "").trim();
  if (!line) return Promise.resolve({ ok: false, reason: "empty" });

  if (interrupt) stopNatural();
  else if (dropIfBusy && active > 0) return Promise.resolve({ ok: false, reason: "busy" });

  const gen = speakGeneration;
  active++;
  const job = async () => {
    if (gen !== speakGeneration) return { ok: false, reason: "cancelled" };
    try {
      return await fetchAndPlay(line, voice);
    } catch (e) {
      if (e?.name === "AbortError") return { ok: false, reason: "cancelled" };
      console.warn("[naturalSpeak]", e.message || e);
      return { ok: false, reason: String(e.message || e) };
    } finally {
      // stopNatural already zeroed active for cancelled generations
      if (gen === speakGeneration) active = Math.max(0, active - 1);
    }
  };

  queue = queue.then(job, job);
  return queue;
}

export async function ttsHealth() {
  // Local TTS (:3002) exposes /health; OCI/Vercel uses FastAPI /tts/health proxy.
  const paths = String(TTS_BASE).includes(":3002")
    ? ["/health"]
    : ["/tts/health", "/health"];
  for (const path of paths) {
    try {
      const r = await fetch(`${TTS_BASE}${path}`);
      if (!r.ok) continue;
      const data = await r.json();
      if (data?.service === "voice-feedback-tts" || data?.keyConfigured != null) return data;
    } catch { /* try next */ }
  }
  return null;
}

export { TTS_BASE, FEMALE_VOICE, PLAYBACK_GAIN };
