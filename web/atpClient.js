/** Persist workout sessions/reps to the ATP API when a patient is logged in. */
import { api, getUser, isLoggedIn } from "./auth.js";

let activeSessionId = null;

export function currentAtpSessionId() {
  return activeSessionId;
}

export async function startAtpSession(exercise) {
  activeSessionId = null;
  if (!isLoggedIn()) return null;
  const user = getUser();
  if (user?.role !== "patient" || !user.patientId) return null;
  try {
    const data = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ exercise }),
    });
    activeSessionId = data.sessionId;
    return activeSessionId;
  } catch (e) {
    console.warn("ATP start session failed:", e.message);
    return null;
  }
}

export async function logAtpRep({
  repNumber,
  counted,
  verdict,
  mistake,
  cue,
  exercise,
}) {
  if (!activeSessionId || !isLoggedIn()) return null;
  const user = getUser();
  if (user?.role !== "patient") return null;
  try {
    return await api("/api/reps", {
      method: "POST",
      body: JSON.stringify({
        sessionId: activeSessionId,
        patientId: user.patientId,
        exercise,
        repNumber,
        counted: !!counted,
        verdict: verdict || null,
        mistake: mistake || null,
        cue: cue || null,
      }),
    });
  } catch (e) {
    console.warn("ATP log rep failed:", e.message);
    return null;
  }
}

export async function endAtpSession() {
  if (!activeSessionId || !isLoggedIn()) {
    activeSessionId = null;
    return;
  }
  const user = getUser();
  if (user?.role !== "patient") {
    activeSessionId = null;
    return;
  }
  const id = activeSessionId;
  activeSessionId = null;
  try {
    await api(`/api/sessions/${encodeURIComponent(id)}/end`, { method: "POST" });
  } catch (e) {
    console.warn("ATP end session failed:", e.message);
  }
}
