/** Structured session log for GenAI coach context (no video / landmarks). */

const EX_TITLES = {
  squat: "Bodyweight Squat",
  arm_abduction: "Shoulder Abduction",
  shoulder_extension: "Shoulder Extension",
};

let state = empty();

function empty() {
  return {
    exercise: null,
    exercise_title: null,
    reps_target: 0,
    started_at: null,
    reps: [],
    skips: [],
    tallies: { good: 0, bad: 0, skip: 0 },
  };
}

export function reset() {
  state = empty();
}

export function start({ exercise, target }) {
  state = empty();
  state.exercise = exercise;
  state.exercise_title = EX_TITLES[exercise] || exercise;
  state.reps_target = Number(target) || 0;
  state.started_at = Date.now();
}

export function pushRep(rep) {
  const entry = {
    rep: rep.rep,
    label: rep.label,
    title: rep.title || rep.label,
    short: rep.short || "",
    cue: rep.cue || "",
    good: !!rep.good,
    duration_s: rep.duration_s ?? null,
    top_probs: rep.top_probs || null,
    at: Date.now(),
  };
  state.reps.push(entry);
  if (entry.good) state.tallies.good++;
  else state.tallies.bad++;
  return entry;
}

export function pushSkip({ reason, short }) {
  const entry = { reason: reason || "", short: short || "", at: Date.now() };
  state.skips.push(entry);
  state.tallies.skip++;
  return entry;
}

export function context() {
  const reps_done = state.reps.length;
  const last = state.reps.length ? state.reps[state.reps.length - 1] : null;
  return {
    exercise: state.exercise,
    exercise_title: state.exercise_title,
    reps_target: state.reps_target,
    reps_done,
    reps_left: Math.max(0, state.reps_target - reps_done),
    tallies: { ...state.tallies },
    last_rep: last,
    reps: state.reps.slice(-20),
    recent_skips: state.skips.slice(-5),
  };
}

export function getState() {
  return state;
}
