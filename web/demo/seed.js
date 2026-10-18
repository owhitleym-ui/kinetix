// Demo seed: one PT (Dr. Maya Lee) and a caseload of 8 fictional patients. Every date is relative to "now",
// so the demo never looks stale. Plans only use the 8 exercises that have a model (see catalog.js).
import { CLINICAL } from "../exerciseText.js";
import { findExercise } from "../catalog.js";

const DAY = 864e5;
const PT_ID = "pt-lee";

function rng(seed) {   // mulberry32: same seed, same demo every time
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;
const iso = (now, daysAgo, hour = 18, min = 10) => {
  const d = new Date(now - daysAgo * DAY); d.setHours(hour, min, 0, 0); return d.toISOString();
};
function nextWeekday(now, dow, hour = 10) {   // next given weekday (0 = Sunday), never today
  const d = new Date(now); d.setHours(hour, 0, 0, 0);
  do d.setDate(d.getDate() + 1); while (d.getDay() !== dow);
  return d.toISOString();
}
const item = (ex, sets, reps, extra = {}) => ({ ex, sets, reps, tempo: "normal", cue: "", ...extra });

// Each patient: the plan, then how their sessions went (good-rep share drifting from -> to, pain per session,
// and which mistakes their "to fix" reps were, as weights).
const PATIENTS = [
  {
    id: "p-sam", name: "Sam Rivera", email: "sam.rivera@example.com", seed: 11,
    condition: "Rotator cuff repair (right)", program: "Rotator cuff repair", week: 3, totalWeeks: 8, nextVisitDow: 2,
    plan: [item("squat", 3, 12), item("arm_abduction", 3, 10), item("shoulder_extension", 3, 10)],
    previous: [item("squat", 3, 10), item("arm_abduction", 3, 10), item("shoulder_extension", 3, 10)],
    planMessage: "Nice steady squats — I’ve added 2 reps. Keep shoulder extension smooth, and stop if it’s sore.",
    planAgo: 21,
    days: [20, 18, 16, 15, 14, 12, 10, 8, 7, 5, 3, 1],
    pain: [2, 2, 2, 2, 2, 2, 2, 3, 3, 4, 5, 5],
    effort: ["just_right"],
    notes: { 7: "Tight on last set", 9: "Felt fine", 11: "Tight on last set" },
    form: { squat: [94, 96], arm_abduction: [86, 89], shoulder_extension: [88, 70] },
    mistakes: {
      squat: { ERR_KNEES_INSIDE: 0.4, ERR_LIFTED_HEELS: 0.3, ERR_SHALLOW_SQUAT: 0.3 },
      arm_abduction: { ERR_TRUNK_LEAN: 0.85, ERR_LOW_ABDUCTION: 0.15 },
      shoulder_extension: { ERR_ELEVATED_SHOULDER: 0.55, TOO_FAST: 0.3, ERR_BENT_ARM: 0.15 },
    },
    profile: {
      deficits: [
        { label: "Shoulder flexion (ROM)", value: "120° of 160°", pct: 75 },
        { label: "External rotation strength", value: "3+/5 of 5/5", pct: 65 },
      ],
      functionNote: "can’t reach overhead shelf; trouble sleeping on right side",
      precautions: ["No lifting over 5 lb", "No behind-back reach until week 6"],
      visitAgo: 6,
    },
  },
  {
    id: "p-priya", name: "Priya Shah", email: "priya.shah@example.com", seed: 21,
    condition: "Frozen shoulder (left)", program: "Frozen-shoulder rehab", week: 6, totalWeeks: 10, nextVisitDow: 4,
    plan: [item("shoulder_abduction_full", 3, 10), item("shoulder_external_rotation", 3, 10)], planAgo: 14,
    planMessage: "Your range is opening up nicely. Same plan this week — smooth and steady.",
    days: [13, 12, 10, 9, 7, 6, 5, 3, 2, 0.4],
    pain: [2, 2, 2, 1, 1, 1, 2, 1, 1, 1], effort: ["just_right", "too_easy"],
    notes: { 8: "Felt easier today" },
    form: { shoulder_abduction_full: [86, 93], shoulder_external_rotation: [87, 92] },
    mistakes: { shoulder_abduction_full: { ERR_LOW_RAISE: 0.35, ERR_BENT_ELBOW: 0.35, ERR_TRUNK_LEAN: 0.3 },
      shoulder_external_rotation: { ERR_LOW_ROTATION: 0.35, ERR_ELBOW_DROP: 0.35, ERR_ELBOW_ANGLE: 0.3 } },
    profile: { deficits: [{ label: "Shoulder abduction (ROM)", value: "135° of 170°", pct: 79 }, { label: "External rotation (ROM)", value: "45° of 80°", pct: 56 }],
      functionNote: "can’t fasten bra behind back; reaching overhead improving", precautions: ["Stay below sharp pain"], visitAgo: 9 },
  },
  {
    id: "p-marcus", name: "Marcus Chen", email: "marcus.chen@example.com", seed: 31,
    condition: "Post-op knee (left ACL)", program: "Post-op knee", week: 2, totalWeeks: 12, nextVisitDow: 1,
    plan: [item("squat", 2, 8)], planAgo: 12,
    planMessage: "Small, controlled squats only. Ice after if it swells.",
    days: [11, 9, 7, 5], pain: [3, 3, 3, 3], effort: ["just_right", "too_hard"], notes: { 2: "Knee a bit swollen" },
    form: { squat: [78, 81] }, mistakes: { squat: { ERR_SHALLOW_SQUAT: 0.4, ERR_KNEES_INSIDE: 0.3, ERR_LIFTED_HEELS: 0.3 } },
    profile: { deficits: [{ label: "Knee flexion (ROM)", value: "95° of 135°", pct: 70 }, { label: "Quad strength", value: "3/5 of 5/5", pct: 60 }],
      functionNote: "stairs one at a time", precautions: ["Brace for walking outdoors", "No deep squats past 90°"], visitAgo: 8 },
  },
  {
    id: "p-elena", name: "Elena Torres", email: "elena.torres@example.com", seed: 41,
    condition: "Hip osteoarthritis (right)", program: "Hip osteoarthritis", week: 8, totalWeeks: 12, nextVisitDow: 3,
    plan: [item("squat", 3, 10)], planAgo: 14,
    planMessage: "Keep sitting back into the squat, nice and slow.",
    days: [13, 11, 10, 8, 6, 4, 3, 1], pain: [2, 2, 3, 2, 3, 3, 2, 3], effort: ["just_right"], notes: {},
    form: { squat: [85, 66] }, mistakes: { squat: { ERR_SHALLOW_SQUAT: 0.55, ERR_TORSO_TO_SIDE: 0.35, ERR_KNEES_FORWARD: 0.1 } },
    profile: { deficits: [{ label: "Hip flexion (ROM)", value: "100° of 120°", pct: 83 }, { label: "Hip abductor strength", value: "4-/5 of 5/5", pct: 75 }],
      functionNote: "getting up from low chairs is hard", precautions: ["Avoid long walks on hills"], visitAgo: 12 },
  },
  {
    id: "p-jordan", name: "Jordan Blake", email: "jordan.blake@example.com", seed: 51,
    condition: "Shoulder impingement (right)", program: "Shoulder impingement", week: 4, totalWeeks: 8, nextVisitDow: 5,
    plan: [item("arm_abduction", 3, 10), item("shoulder_internal_rotation", 3, 10)], planAgo: 10,
    planMessage: "Good progress. Stay pain-free through the lift.",
    days: [9, 8, 6, 5, 3, 2, 1], pain: [3, 2, 2, 2, 2, 2, 2], effort: ["just_right"], notes: {},
    form: { arm_abduction: [80, 83], shoulder_internal_rotation: [81, 82] },
    mistakes: { arm_abduction: { ERR_ARM_FORWARD: 0.3, ERR_ELEVATED_SHOULDER: 0.3, ERR_LOW_ABDUCTION: 0.2, ERR_BENT_ARM: 0.2 },
      shoulder_internal_rotation: { ERR_LOW_ROTATION: 0.35, ERR_ELBOW_DROP: 0.35, ERR_TRUNK_LEAN: 0.3 } },
    profile: { deficits: [{ label: "Painful arc", value: "70°–110°", pct: 60 }, { label: "Internal rotation (ROM)", value: "50° of 70°", pct: 71 }],
      functionNote: "reaching to high cupboards", precautions: ["No overhead lifting"], visitAgo: 5 },
  },
  {
    id: "p-aisha", name: "Aisha Nwosu", email: "aisha.nwosu@example.com", seed: 61,
    condition: "Rotator cuff tendinopathy (right)", program: "Rotator cuff tendinopathy", week: 5, totalWeeks: 8, nextVisitDow: 2,
    plan: [item("shoulder_external_rotation", 3, 10), item("arm_circles", 2, 10)], planAgo: 13,
    planMessage: "Lovely control. Keep the elbow still on rotations.",
    days: [12, 11, 9, 8, 6, 5, 4, 2, 1], pain: [2, 2, 1, 1, 2, 1, 1, 1, 1], effort: ["just_right"], notes: {},
    form: { shoulder_external_rotation: [87, 92], arm_circles: [88, 94] },
    mistakes: { shoulder_external_rotation: { ERR_ELBOW_DROP: 0.35, ERR_LOW_ROTATION: 0.35, ERR_ELBOW_ANGLE: 0.3 }, arm_circles: { ERR_SMALL_CIRCLE: 0.4, ERR_BENT_ELBOW: 0.3, ERR_TRUNK_LEAN: 0.3 } },
    profile: { deficits: [{ label: "External rotation strength", value: "4/5 of 5/5", pct: 80 }], functionNote: "swimming paused", precautions: ["No painful overhead loading"], visitAgo: 7 },
  },
  {
    id: "p-tom", name: "Tom Okafor", email: "tom.okafor@example.com", seed: 71,
    condition: "ACL reconstruction (right)", program: "ACL rehab", week: 10, totalWeeks: 16, nextVisitDow: 4,
    plan: [item("squat", 3, 15)], planAgo: 9,
    planMessage: "Strong week. Keep the depth even on both sides.",
    days: [8, 7, 5, 4, 2], pain: [1, 1, 2, 1, 1], effort: ["just_right"], notes: {},
    form: { squat: [82, 83] }, mistakes: { squat: { ERR_KNEES_INSIDE: 0.3, ERR_TORSO_TO_SIDE: 0.25, ERR_SHALLOW_SQUAT: 0.25, ERR_LIFTED_HEELS: 0.2 } },
    profile: { deficits: [{ label: "Single-leg squat depth", value: "70% of other side", pct: 70 }], functionNote: "no running yet", precautions: ["No pivoting sports until cleared"], visitAgo: 10 },
  },
  {
    id: "p-lily", name: "Lily Park", email: "lily.park@example.com", seed: 81,
    condition: "Shoulder stiffness (left)", program: "Shoulder stiffness", week: 1, totalWeeks: 6, nextVisitDow: 1,
    plan: [item("arm_circles", 2, 10), item("shoulder_adduction", 2, 10)], planAgo: 4,
    planMessage: "Welcome! Gentle circles to start — no forcing it.",
    days: [3, 1], pain: [2, 2], effort: ["just_right"], notes: { 0: "First time, felt okay" },
    form: { arm_circles: [80, 84], shoulder_adduction: [78, 82] },
    mistakes: { arm_circles: { ERR_SMALL_CIRCLE: 0.5, ERR_BENT_ELBOW: 0.5 }, shoulder_adduction: { ERR_NOT_ACROSS: 0.5, ERR_TRUNK_LEAN: 0.5 } },
    profile: { deficits: [{ label: "Shoulder flexion (ROM)", value: "140° of 170°", pct: 82 }], functionNote: "stiff in the mornings", precautions: [], visitAgo: 4 },
  },
];

function allocate(n, weights, r) {   // split n "to fix" reps between mistake codes by weight
  const codes = Object.keys(weights); const out = {};
  let left = n;
  codes.forEach((c, i) => {
    const k = i === codes.length - 1 ? left : Math.min(left, Math.round(n * weights[c] + (r() - 0.5) * 0.8));
    if (k > 0) out[c] = k; left -= Math.max(0, k);
  });
  return out;
}

function buildSessions(p, now) {
  const r = rng(p.seed);
  const n = p.days.length;
  return p.days.map((ago, i) => {
    const t = n > 1 ? i / (n - 1) : 1;
    const exercises = p.plan.map((it) => {
      const [a, b] = p.form[it.ex];
      const pct = Math.max(40, Math.min(99, lerp(a, b, t) + (r() - 0.5) * 3)) / 100;
      const target = it.sets * it.reps;
      const done = Math.max(target - (r() < 0.25 ? 1 : 0), 0);
      const good = Math.round(done * pct), bad = done - good;
      const counts = allocate(bad, p.mistakes[it.ex] || {}, r);
      const mistakes = Object.entries(counts).map(([code, k]) => ({ code, title: CLINICAL[code] || code, n: k }));
      return { ex: it.ex, name: findExercise(it.ex).item.name, sets: it.sets, reps: it.reps, target, done, good, bad, skip: r() < 0.3 ? 1 : 0, mistakes };
    });
    const minutes = Math.round(14 + exercises.reduce((s, e) => s + e.done, 0) / 12 + r() * 3);
    return {
      id: `${p.id}-s${i + 1}`, patientId: p.id, startedAt: iso(now, ago, 17 + Math.floor(r() * 3), Math.floor(r() * 50)),
      durationMin: minutes, fromPlan: true, exercises,
      checkin: { pain: p.pain[i], effort: p.effort[i % p.effort.length], note: p.notes[i] || "" },
      videoChoice: i % 3 === 0 ? "local" : "share", sharedWith: [PT_ID], seeded: true,
    };
  });
}

export function buildSeed(now = Date.now()) {
  const users = {
    [PT_ID]: { id: PT_ID, role: "pt", name: "Dr. Maya Lee, DPT", short: "Dr. Lee", first: "Maya", email: "maya.lee@riverside-pt.example",
      clinic: "Riverside Physical Therapy", clinicAddress: "[Clinic address]" },
  };
  const careTeam = {}, profiles = {}, plans = {}, settings = {};
  let sessions = [];
  for (const p of PATIENTS) {
    users[p.id] = { id: p.id, role: "patient", name: p.name, first: p.name.split(" ")[0], email: p.email };
    careTeam[p.id] = { ptId: PT_ID, inviteCode: `4F7-${p.id.slice(2, 5).toUpperCase()}`, linkedAt: iso(now, p.week * 7) };
    profiles[p.id] = {
      condition: p.condition, program: p.program, week: p.week, totalWeeks: p.totalWeeks,
      nextVisit: nextWeekday(now, p.nextVisitDow), visitDate: iso(now, p.profile.visitAgo, 10, 0),
      deficits: p.profile.deficits, functionNote: p.profile.functionNote, precautions: p.profile.precautions,
    };
    const v = [];
    if (p.previous) v.push({ version: 1, status: "superseded", createdAt: iso(now, p.planAgo + 7, 9), items: p.previous, message: null });
    v.push({ version: v.length + 1, status: "active", createdAt: iso(now, p.planAgo + 0.6, 9), items: p.plan,
      message: { from: PT_ID, text: p.planMessage, at: iso(now, p.planAgo + 0.6, 9) } });
    plans[p.id] = v;
    settings[p.id] = defaultPatientSettings();
    sessions = sessions.concat(buildSessions(p, now));
  }
  settings[PT_ID] = defaultPtSettings();
  sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const messages = buildMessages(now);
  return { version: 1, seededAt: new Date(now).toISOString(), users, careTeam, profiles, plans, sessions, settings, drafts: {}, messages };
}

/** A few care-team threads so the Messages inbox isn’t empty in the demo. */
function buildMessages(now) {
  const msg = (id, patientId, from, text, daysAgo, hour, min, readDaysAgo = null) => ({
    id, patientId, ptId: PT_ID, from, text,
    at: iso(now, daysAgo, hour, min),
    readAt: readDaysAgo == null ? null : iso(now, readDaysAgo, hour, min + 5),
  });
  return [
    // Sam ↔ Dr. Lee — pain concern; latest from Sam still unread for the PT
    msg("msg-sam-1", "p-sam", PT_ID, "Sam, I saw your last two check-ins — pain at 5. How is the shoulder feeling today?", 2, 10, 15, 2),
    msg("msg-sam-2", "p-sam", "p-sam", "Still sore after extension. Squats feel okay though.", 2, 11, 40, 2),
    msg("msg-sam-3", "p-sam", PT_ID, "Thanks for telling me. Skip the last set of extension if it climbs above a 4, and ice after.", 2, 14, 5, 1),
    msg("msg-sam-4", "p-sam", "p-sam", "Will do. Should I still come in Tuesday if it’s still at a 5?", 0.3, 19, 20, null),
    // Jordan ↔ Dr. Lee — short on-track exchange, all read
    msg("msg-jor-1", "p-jordan", "p-jordan", "Hi Dr. Lee — abduction felt smoother this week. Any reason not to keep the same plan?", 4, 16, 0, 4),
    msg("msg-jor-2", "p-jordan", PT_ID, "That’s great to hear. Stay with this plan through your next visit — keep the lift pain-free.", 3, 9, 30, 3),
    // Priya ↔ Dr. Lee — quick check-in
    msg("msg-pri-1", "p-priya", PT_ID, "Priya, your range looks better on the last few sessions. Keep the slow, smooth reps.", 5, 11, 0, 5),
    msg("msg-pri-2", "p-priya", "p-priya", "Thank you! Reaching the top shelf is getting easier.", 4, 18, 45, 4),
  ];
}

export function defaultPatientSettings() {
  return { videoChoice: "share", rememberChoice: false, askEachSession: true, reminders: { on: true, time: "18:00", days: [1, 1, 1, 1, 1, 0, 0] },
    textSize: 0, spokenCues: true, autoShare: true };
}
export function defaultPtSettings() {
  return { aiOn: true, cadence: "weekly", painLimit: 4, weeklyCap: "+2 reps or +1 set", alerts: { pain: true, missed: true, form: true },
    missedDays: 3, formBelow: 75, warmupDefault: true, askVideo: true, twoStep: true, autoSignout: 15 };
}

export const DEMO_PATIENT = "p-sam";
export const DEMO_PT = PT_ID;
