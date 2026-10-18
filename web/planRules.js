// AI plan rules (deterministic) + caseload flags. Same rules the FastAPI /coach/plan-suggestions endpoint is meant
// to run; this client-side copy means the provider views always have content, even with no backend.
import { API_BASE } from "./coach.js";
import { clinicalName, exName, plainCue } from "./exerciseText.js";

const DAY = 864e5;
const RECENT = 3;   // "this week" window for mistake counts

export const alertAt = (s) => (s?.painLimit ?? 4) + 1;   // pain at or above this alerts the PT
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const pct = (good, done) => (done ? good / done : 0);
export const sessionGood = (s) => pct(sum(s.exercises, (e) => e.good), sum(s.exercises, (e) => e.done));
export const exGood = (s, ex) => { const e = s.exercises.find((x) => x.ex === ex); return e && e.done ? e.good / e.done : null; };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const daysSince = (isoDate, now = Date.now()) => Math.floor((new Date(new Date(now).toDateString()) - new Date(new Date(isoDate).toDateString())) / DAY);

/** Mistake counts per exercise over the last `n` sessions: [{code, title, ex, n}] sorted by count. */
export function recentMistakes(sessions, n = RECENT) {
  const out = {};
  for (const s of sessions.slice(-n)) for (const e of s.exercises) for (const m of e.mistakes || []) {
    const k = `${e.ex}|${m.code}`;
    out[k] = out[k] || { code: m.code, title: clinicalName(m.code, m.title), ex: e.ex, n: 0 };
    out[k].n += m.n;
  }
  return Object.values(out).sort((a, b) => b.n - a.n);
}

/** Patient-facing progress from finished sessions. Same input shape for demo and ATP sessions:
 *  { startedAt, exercises: [{ ex, done, good, mistakes: [{ code, n }] }], checkin?: { pain } }. */
export function summarizeProgress(sessions, now = Date.now()) {
  const list = [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const perSession = list.map((s) => ({ at: s.startedAt, good: sessionGood(s), pain: s.checkin?.pain ?? null, reps: sum(s.exercises, (e) => e.done) }));
  const pains = perSession.filter((p) => p.pain != null);
  const exercises = [...new Set(list.flatMap((s) => s.exercises.map((e) => e.ex)))].map((ex) => {
    const vals = list.map((s) => exGood(s, ex)).filter((v) => v != null);
    return { ex, sessions: vals.length, then: avg(vals.slice(0, 3)), now: avg(vals.slice(-3)) };
  });
  return {
    count: list.length, since: list[0]?.startedAt || null, totalReps: sum(perSession, (p) => p.reps),
    thisWeek: list.filter((s) => daysSince(s.startedAt, now) < 7).length, perSession, exercises,
    goodThen: avg(perSession.slice(0, 3).map((p) => p.good)), goodNow: avg(perSession.slice(-3).map((p) => p.good)),
    painThen: pains[0]?.pain ?? null, painNow: pains[pains.length - 1]?.pain ?? null,
    focus: recentMistakes(list).slice(0, 3),
  };
}

/** Why a PT should look at this patient today (or null). */
export function patientFlags(sessions, settings, now = Date.now()) {
  const flags = [];
  const al = settings?.alerts || {};
  const last2 = sessions.slice(-2).map((s) => s.checkin?.pain).filter((p) => p != null);
  const A = alertAt(settings);
  if (al.pain !== false && last2.length === 2 && last2.every((p) => p >= A)) {
    const earlier = sessions.slice(0, -2).map((s) => s.checkin?.pain).filter((p) => p != null);
    const was = earlier.length ? Math.min(...earlier.slice(-6)) : last2[0];
    flags.push({ kind: "pain", reason: "Pain went up", detail: `Reported ${Math.max(...last2)}/10 in the last 2 sessions, up from ${was}.`, pain: Math.max(...last2), was });
  }
  if (sessions.length) {
    const last = sessions[sessions.length - 1];
    const missed = daysSince(last.startedAt, now) - 1;
    if (al.missed !== false && missed >= (settings?.missedDays ?? 3))
      flags.push({ kind: "missed", reason: `Missed ${missed} days`, detail: `Last session was ${new Date(last.startedAt).toLocaleDateString(undefined, { weekday: "long" })}. No check-ins since.`, missed });
  }
  if (al.form !== false && sessions.length >= 5) {
    const recent = avg(sessions.slice(-RECENT).map(sessionGood)), before = avg(sessions.slice(0, -RECENT).map(sessionGood));
    if (recent * 100 < (settings?.formBelow ?? 75) && recent < before) {
      const top = recentMistakes(sessions)[0];
      flags.push({ kind: "form", reason: "Form is slipping", detail: top ? `${top.title} is showing up more this week.` : "Fewer good reps this week.", recent });
    }
  }
  return flags;
}

/** Plain status for the All patients table. */
export function patientStatus(sessions, flags, draft) {
  if (flags.length) return { kind: flags[0].kind, text: flags[0].reason };
  if (sessions.length < 4) return { kind: "good", text: "Getting started" };
  if (draft?.suggestions?.some((s) => s.progress)) return { kind: "good", text: "Ready to progress" };
  return { kind: "good", text: "On track" };
}

/** Deterministic plan suggestions from the sessions since the last plan + the PT's settings. */
export function runRules({ plan, sessions, settings, patientFirst = "", now = Date.now() }) {
  const S = settings || {}, L = S.painLimit ?? 4, A = alertAt(S);
  const items = plan?.items || [];
  const since = sessions;
  const pains = since.map((s) => s.checkin?.pain).filter((p) => p != null);
  const last2 = pains.slice(-2);
  const efforts = since.map((s) => s.checkin?.effort).filter(Boolean);
  const suggestions = [];
  const lastAt = since.length ? since[since.length - 1].startedAt : null;
  const missed = lastAt ? daysSince(lastAt, now) - 1 : 99;
  const daysOnPlan = plan?.createdAt ? Math.max(1, (now - new Date(plan.createdAt)) / DAY) : 7;
  const expected = Math.max(since.length, Math.round(daysOnPlan / 7 * 5));
  const sinceLast = {
    sessions: since.length, expected,
    goodPct: Math.round(100 * pct(sum(since, (s) => sum(s.exercises, (e) => e.good)), sum(since, (s) => sum(s.exercises, (e) => e.done)))),
    pain: pains.length ? pains[pains.length - 1] : null, painFrom: pains.length ? Math.min(...pains.slice(0, Math.max(1, pains.length - 2))) : null,
    effort: efforts.length ? efforts[efforts.length - 1] : null,
    checkins: since.filter((s) => s.checkin).length,
  };
  if (!since.length || since.length < 5) return { suggestions, since_last_plan: sinceLast, patient_message: "", source: "local", reason: "not_enough_data" };
  if (missed >= (S.missedDays ?? 3)) {
    return { suggestions, since_last_plan: sinceLast, source: "local", reason: "missed",
      patient_message: `Hi ${patientFirst}, I noticed you haven’t practised for ${missed} days. Is everything okay? Let me know how your body is feeling and we’ll adjust if we need to.` };
  }
  const painHigh = last2.length && Math.max(...last2) > L;
  const painRising = pains.length >= 3 && pains[pains.length - 1] > pains[0] + 1;
  const mistakes = recentMistakes(since);
  const exMistakes = (ex) => mistakes.filter((m) => m.ex === ex);
  const drop = (ex) => {
    const vals = since.map((s) => exGood(s, ex)).filter((v) => v != null);
    if (vals.length < 4) return 0;
    return avg(vals.slice(0, Math.ceil(vals.length / 2))) - avg(vals.slice(-RECENT));
  };
  let painful = null;
  if (painHigh) painful = [...items].sort((a, b) => drop(b.ex) - drop(a.ex) || sum(exMistakes(b.ex), (m) => m.n) - sum(exMistakes(a.ex), (m) => m.n))[0]?.ex;

  for (const it of items) {
    const ms = exMistakes(it.ex), total = sum(ms, (m) => m.n);
    const recentGood = since.slice(-5).map((s) => s.exercises.find((e) => e.ex === it.ex)).filter(Boolean);
    const good5 = pct(sum(recentGood, (e) => e.good), sum(recentGood, (e) => e.done));
    const name = exName(it.ex);
    if (painHigh && it.ex === painful) {
      const to = { ...it, sets: Math.max(1, it.sets - 1), reps: Math.max(5, it.reps - 2), tempo: "slow" };
      const why = [`Pain rose from ${sinceLast.painFrom} to ${sinceLast.pain} over the last ${Math.min(pains.length, 4)} sessions (your limit is ${L}/10).`];
      if (ms.length) why.push(`${ms.slice(0, 2).map((m, i) => `${i ? m.title.toLowerCase() : m.title} on ${m.n} reps`).join(" and ")} in the last ${RECENT} sessions.`);
      const d = drop(it.ex); if (d > 0.05) why.push(`Good reps fell by ${Math.round(d * 100)} points.`);
      suggestions.push({ id: `adj-${it.ex}`, kind: "adjust", ex: it.ex, from: it, to, why });
      continue;
    }
    const dominant = ms[0] && total >= 5 && ms[0].n / total >= 0.45 && ms[0].n >= 5 ? ms[0] : null;
    if (!painHigh && !painRising && good5 >= 0.85 && Math.max(...last2) <= 2 && !efforts.slice(-2).includes("too_hard") && recentGood.length >= 5) {
      const to = it.reps + 2 <= 15 ? { ...it, reps: it.reps + 2 } : { ...it, sets: Math.min(4, it.sets + 1) };
      suggestions.push({ id: `adj-${it.ex}`, kind: "adjust", progress: true, ex: it.ex, from: it, to,
        why: [`${Math.round(good5 * 100)}% good reps over the last 5 sessions.`, `Pain ${Math.max(...last2)}/10 or lower and effort “${(efforts[efforts.length - 1] || "just_right").replace("_", " ")}”.`,
          `Within your weekly cap (${S.weeklyCap || "+2 reps or +1 set"}).`] });
      continue;
    }
    if (dominant && (painHigh || !painRising)) {
      const cue = plainCue(dominant.code);
      if (it.cue === cue) continue;
      suggestions.push({ id: `keep-${it.ex}`, kind: "keep", ex: it.ex, from: it, to: { ...it, cue },
        why: [drop(it.ex) > 0.05 ? `Good reps down to ${Math.round(good5 * 100)}% over the last 5 sessions.` : `Form steady at ${Math.round(good5 * 100)}% good reps.`, `Most common error is ${dominant.title.toLowerCase()} (${dominant.n} reps), so add a cue rather than more load.`] });
    }
  }
  const tight = since.filter((s) => /tight|stiff/i.test(s.checkin?.note || ""));
  if (tight.length >= 2 && !items.some((i) => i.ex === "arm_circles")) {
    suggestions.push({ id: "add-arm_circles", kind: "add", ex: "arm_circles", from: null, warmup: true,
      to: { ex: "arm_circles", sets: 1, reps: 10, tempo: "slow", cue: "Gentle circles to warm up" },
      why: [`Patient noted “${tight[tight.length - 1].checkin.note.toLowerCase()}” ${tight.length} times.`, "Gentle shoulder circles before the main exercises, within the available exercise list."] });
  }
  const ORDER = { adjust: 0, keep: 1, add: 2 };
  suggestions.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  return { suggestions, since_last_plan: sinceLast, patient_message: draftMessage({ suggestions, sinceLast, A, patientFirst }), source: "local" };
}

export function draftMessage({ suggestions, sinceLast, A }) {
  const parts = [sinceLast.sessions >= sinceLast.expected * 0.8 ? "Great consistency this week!" : "Thanks for keeping up with your exercises."];
  for (const s of suggestions) {
    const name = exName(s.ex).toLowerCase();
    if (s.kind === "keep") parts.push(`Your ${name} form looks solid — ${s.to.cue.charAt(0).toLowerCase()}${s.to.cue.slice(1)} as you go.`);
    else if (s.kind === "add") parts.push(`I’ve added ${name} to warm your shoulder up first.`);
    else if (s.progress) parts.push(`You’re ready for a little more on ${name}.`);
    else parts.push(`Let’s slow down ${name} and do fewer reps while it’s sore.`);
  }
  parts.push(`Message me if pain goes above ${A}.`);
  return parts.join(" ");
}

/** Try the FastAPI rules + wording; fall back to the same rules here. */
let apiDownUntil = 0;
export async function planSuggestions(input) {
  const local = runRules(input);
  if (Date.now() < apiDownUntil) return local;   // don't wait on an API we just found missing
  try {
    // GenAI wording can take a few seconds; local rules still return immediately on failure.
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
    const res = await fetch(`${API_BASE}/coach/plan-suggestions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
      body: JSON.stringify({ plan: input.plan, sessions: input.sessions, settings: input.settings, patient_first: input.patientFirst }),
    });
    clearTimeout(t);
    if (!res.ok) { apiDownUntil = Date.now() + 30000; return local; }
    const data = await res.json();
    if (!Array.isArray(data?.suggestions)) return local;
    return { ...local, ...data, since_last_plan: data.since_last_plan || local.since_last_plan, source: data.source || "oci" };
  } catch { apiDownUntil = Date.now() + 30000; return local; }
}
