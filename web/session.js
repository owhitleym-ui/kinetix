// Session rules on top of the rep detector: nothing counts until the whole body is in frame and the user is
// set up, and a detected movement only counts (and gets assessed) if it is a complete, deliberate rep.
// Each frame object passed around is the world-landmark array P with extra fields:
//   P.img = 33 x [x, y, visibility] (normalized image coords), P.t = time in ms, P.ok = whole body in frame.

import { primarySignal } from "./features.js";

// Whole body, head to feet: nose, shoulders, elbows, wrists, hips, knees, ankles, heels, toes.
const PARTS = {
  head: [0], shoulders: [11, 12], elbows: [13, 14], hands: [15, 16], hips: [23, 24], knees: [25, 26],
  feet: [27, 28, 29, 30, 31, 32],
};
const MARGIN = 0.01, MIN_VIS = 0.5;

export function framing(img) {
  const missing = Object.entries(PARTS)
    .filter(([, idx]) => idx.some((i) => {
      const [x, y, v] = img[i];
      return v < MIN_VIS || x < MARGIN || x > 1 - MARGIN || y < MARGIN || y > 1 - MARGIN;
    }))
    .map(([name]) => name);
  return { ok: missing.length === 0, missing };
}

const angleAt = (a, b, c) => {
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const d = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v) + 1e-9);
  return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
};
const knees = (P) => (angleAt(P[23], P[25], P[27]) + angleAt(P[24], P[26], P[28])) / 2;
const rightShoulder = (P) => angleAt(P[24], P[12], P[14]);
const leftShoulder = (P) => angleAt(P[23], P[11], P[13]);

// Per-exercise rules. minAmp is in the detector's units (squat: % of leg length, arms: degrees).
export const RULES = {
  squat: {
    restPose: (P) => knees(P) > 150, restHint: "Stand tall with your feet hip-width apart",
    minAmp: 8, shallowHint: "Too shallow to count: sit down and back further", shallowShort: "Not deep enough",
    minSec: 0.8, maxSec: 8, maxHipShift: 0.12, maxFootShift: 0.06,
  },
  arm_abduction: {
    restPose: (P) => rightShoulder(P) < 35, restHint: "Let your right arm hang by your side",
    minAmp: 60, shallowHint: "Raise your arm higher for it to count", shallowShort: "Not high enough",
    minSec: 1.0, maxSec: 8, maxHipShift: 0.08, maxFootShift: 0.06, otherArm: "left",
  },
  shoulder_extension: {
    restPose: (P) => rightShoulder(P) < 35, restHint: "Let your right arm hang by your side",
    minSec: 0, maxSec: 99, maxHipShift: 0.08, maxFootShift: 0.06,
  },
};

// Mobility setting: how much to relax what counts as a good rep, for people whose mobility keeps them from the
// full textbook movement. Measured with tests/mobility_test.mjs on held-out people.
//  slight:   ~15% less range needed to count; range-of-motion mistakes need ~1.7x the evidence, typical
//            compensations ~1.25x, everything else slightly more
//  moderate: ~25% less range; range-of-motion mistakes ~3x the evidence, compensations ~1.7x
// Range-of-motion / compensation feedback uses gentle wording in both.
const GENTLE_CUES = {
  ERR_SHALLOW_SQUAT: "If it's comfortable, try to go a little lower. Only as far as feels okay.",
  ERR_LOW_ABDUCTION: "If it's comfortable, try to lift your arm a little higher. Only as far as feels okay.",
  ERR_LIFTED_HEELS: "Try to keep your heels down. A slightly smaller squat is fine.",
  ERR_ELEVATED_SHOULDER: "Try to keep your shoulder relaxed. It's fine to lift a little lower.",
  ERR_TORSO_FORWARD: "Try to stay upright. It's fine to move your arm back a little less.",
};
const relaxed = (rom, comp) => ({
  ERR_SHALLOW_SQUAT: rom, ERR_LOW_ABDUCTION: rom,                                        // range of motion
  ERR_LIFTED_HEELS: comp, ERR_ELEVATED_SHOULDER: comp, ERR_TORSO_FORWARD: comp,          // typical compensations
});
export const MOBILITY = {
  standard: { label: "None", tauScale: 1, downweight: {}, ampScale: 1, extraSec: 0, restSlack: 0, cues: {} },
  slight: { label: "Slight", tauScale: 0.88, downweight: relaxed(0.6, 0.8), ampScale: 0.85, extraSec: 2, restSlack: 5, cues: GENTLE_CUES },
  moderate: { label: "Moderate", tauScale: 0.75, downweight: relaxed(0.35, 0.6), ampScale: 0.75, extraSec: 4, restSlack: 10, cues: GENTLE_CUES },
};
MOBILITY.limited = MOBILITY.moderate;   // older names
MOBILITY.small = MOBILITY.slight;

// Rules for an exercise at a mobility level.
export function rulesFor(ex, mobility = "standard") {
  const r = RULES[ex], m = MOBILITY[mobility] ?? MOBILITY.standard;
  if (m === MOBILITY.standard) return r;
  return {
    ...r,
    minAmp: r.minAmp === undefined ? undefined : r.minAmp * m.ampScale,
    maxSec: r.maxSec + m.extraSec,
    restPose: ex === "squat" ? (P) => knees(P) > 150 - m.restSlack : (P) => rightShoulder(P) < 35 + m.restSlack,
    shallowHint: ex === "squat" ? "Not counted yet: lower a little more if it's comfortable"
      : "Not counted yet: raise your arm a little higher if it's comfortable",
  };
}

const range = (a) => Math.max(...a) - Math.min(...a);

// Before counting: whole body in frame, facing the camera, in the start position, holding still for holdMs.
export class SetupGate {
  constructor(rules, { holdMs = 500, still = 0.025 } = {}) { this.rules = rules; this.holdMs = holdMs; this.still = still; this.reset(); }
  reset() { this.recent = []; this.holdStart = null; }
  push(P, facingDeg) {
    const f = framing(P.img);
    this.recent.push(P); if (this.recent.length > 8) this.recent.shift();
    const fail = (title, sub) => { this.holdStart = null; return { ready: false, title, sub, progress: 0 }; };
    if (!f.ok) return fail("Show your whole body", `Step back until the camera sees your ${f.missing.join(", ")}.`);
    if (facingDeg > 30) return fail("Face the camera", "Turn so your chest faces the screen.");
    if (!this.rules.restPose(P)) return fail("Get into the start position", this.rules.restHint + ".");
    const pts = [11, 12, 15, 16, 23, 24, 27, 28];
    const moving = this.recent.length < 8 || pts.some((i) =>
      range(this.recent.map((q) => q.img[i][0])) > this.still || range(this.recent.map((q) => q.img[i][1])) > this.still);
    if (moving) { this.holdStart = null; return { ready: false, title: "Hold still", sub: "Getting your start position…", progress: 0 }; }
    this.holdStart ??= P.t;
    const progress = Math.min(1, (P.t - this.holdStart) / this.holdMs);
    return { ready: progress >= 1, title: "Hold still", sub: "Getting your start position…", progress };
  }
}

// Is this detected movement a complete, deliberate rep? Returns {ok, reason, amp}.
export function validateRep(frames, seg, rules) {
  const n = frames.length;
  const secs = (frames[n - 1].t - frames[0].t) / 1000;
  const hasImg = !!frames[0].img;   // replay tests have world landmarks only
  // reason = spoken / shown in full; short = label for the rep log
  if (hasImg && frames.filter((f) => f.ok).length / n < 0.9)
    return { ok: false, reason: "Keep your whole body in the frame during the rep", short: "Out of frame" };
  if (secs < rules.minSec) return { ok: false, reason: "Too quick to count: move slowly and with control", short: "Too fast" };
  if (secs > rules.maxSec) return { ok: false, reason: "That took too long to count as one rep", short: "Too slow" };
  if (hasImg) {
    const hipX = frames.map((f) => (f.img[23][0] + f.img[24][0]) / 2);
    const footX = frames.map((f) => (f.img[27][0] + f.img[28][0]) / 2);
    if (range(hipX) > rules.maxHipShift || range(footX) > rules.maxFootShift)
      return { ok: false, reason: "Stay in one spot while you do the rep", short: "Moved position" };
  }
  let amp = null;
  if (seg.cfg.mode !== "tempo") {
    const d = frames.map((f) => seg.away(primarySignal(seg.cfg.primary, f)));
    amp = Math.max(...d);
    if (amp < rules.minAmp) return { ok: false, reason: rules.shallowHint, short: rules.shallowShort, amp };
    const peak = d.indexOf(amp) / (n - 1);
    if (peak < 0.1 || peak > 0.9) return { ok: false, reason: "Finish the rep: return to the start position", short: "Incomplete rep", amp };
    if (rules.otherArm === "left") {
      const r = range(frames.map(rightShoulder)), l = range(frames.map(leftShoulder));
      if (l > 0.6 * r) return { ok: false, reason: "Use only your right arm", short: "Wrong arm", amp };
    }
  }
  return { ok: true, amp };
}
