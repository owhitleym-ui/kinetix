// The session in progress ("run"): which plan exercises, where we are, and what has been counted so far.
// Kept in sessionStorage so a reload mid-session doesn't lose the plan.
const KEY = "kinetix.run";

export function getRun() { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } }
export function saveRun(run) { try { sessionStorage.setItem(KEY, JSON.stringify(run)); } catch { /* storage blocked */ } return run; }
export function clearRun() { try { sessionStorage.removeItem(KEY); } catch { /* storage blocked */ } }

/** Start from Today's plan: warm-up → recording choice → the plan's exercises. */
export function beginPlanRun(patientId, plan) {
  const items = (plan?.items || []).map(({ ex, name, sets, reps, tempo, cue }) => ({ ex, name, sets, reps, tempo, cue }));
  return saveRun({ patientId, planVersion: plan?.version, fromPlan: true, items, i: 0, set: 1, results: items.map(newResult), startedAt: null });
}
/** A single exercise from the library. */
export function beginLibraryRun(patientId, ex, name, reps) {
  const item = { ex, name, sets: 1, reps, tempo: "normal", cue: "" };
  return saveRun({ patientId, fromPlan: false, items: [item], i: 0, set: 1, results: [newResult(item)], startedAt: null });
}
export function newResult(it) {
  return { ex: it.ex, name: it.name, sets: it.sets, reps: it.reps, target: it.sets * it.reps, done: 0, good: 0, bad: 0, skip: 0, mistakes: [] };
}
