/**
 * Client for OCI-backed FastAPI backend.
 * Keypoints only — never video.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function logSession(payload) {
  const res = await fetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Session log failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Score a completed rep via OCI Model Deployment (through FastAPI).
 */
export async function scoreRep(repPayload) {
  try {
    const res = await fetch(`${API_BASE}/score-rep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(repPayload),
    });
    if (!res.ok) throw new Error(`score-rep ${res.status}`);
    return res.json();
  } catch (err) {
    // Offline-first: local heuristic fallback when OCI unreachable
    return localScoreFallback(repPayload);
  }
}

/**
 * Ask OCI GenAI for a plain-language cue (falls back to local cue).
 */
export async function generateCue({ errorType, baseline, current, language }) {
  try {
    const res = await fetch(`${API_BASE}/generate-cue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error_type: errorType, baseline, current, language }),
    });
    if (!res.ok) throw new Error(`generate-cue ${res.status}`);
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchSessions(patientId) {
  const q = patientId ? `?patient_id=${encodeURIComponent(patientId)}` : "";
  const res = await fetch(`${API_BASE}/sessions${q}`);
  if (!res.ok) throw new Error(`fetch sessions ${res.status}`);
  return res.json();
}

function localScoreFallback(repPayload) {
  const frames = repPayload?.frames || [];
  if (!frames.length) {
    return { quality: "incorrect", error_type: "shallow", confidence: 0.4, source: "local" };
  }
  // Heuristic: if any frame flagged error in payload, mark incorrect
  const errors = frames.filter((f) => f.errorType).map((f) => f.errorType);
  if (errors.length > frames.length * 0.2) {
    const counts = {};
    errors.forEach((e) => {
      counts[e] = (counts[e] || 0) + 1;
    });
    const error_type = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    return { quality: "incorrect", error_type, confidence: 0.65, source: "local" };
  }
  return { quality: "correct", error_type: null, confidence: 0.7, source: "local" };
}
