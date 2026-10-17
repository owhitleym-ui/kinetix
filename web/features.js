// Shared exercise-feature definition (v1), used live in the browser and in Node tests.
// Python mirror for training: ../rehab_features.py. Keep the two identical; parity_test.mjs checks them.
//
// Input per frame: MediaPipe Pose *world* landmarks, 33 points [x, y, z] in meters, hip-centered,
// y pointing down. Everything below is a ratio or an angle, so body size and camera distance cancel out.

export const FEATURE_VERSION = 1;
export const N_RESAMPLE = 16;

const UP = [0, -1, 0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / (norm(a) + 1e-9));
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const clip = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const DEG = 180 / Math.PI;

function angleBetween(u, v) {
  return Math.acos(clip(dot(u, v) / (norm(u) * norm(v) + 1e-9), -1, 1)) * DEG;
}
const angleAt = (a, b, c) => angleBetween(sub(a, b), sub(c, b));

export const SIGNAL_NAMES = [
  "knee_l", "knee_r", "hip_l", "hip_r", "elbow_l", "elbow_r", "shoulder_l", "shoulder_r",
  "rarm_side", "rarm_up", "rarm_fwd", "larm_side", "larm_up", "larm_fwd",
  "spine_side", "spine_fwd", "ear_shoulder_l", "ear_shoulder_r", "head_tilt",
  "knee_ankle_width", "ankle_hip_width", "heel_lift_l", "heel_lift_r", "knee_fwd_l", "knee_fwd_r",
  "torso_rotation",
];

// One frame -> 26 numbers. P: array of 33 [x, y, z] (MediaPipe indices).
export function frameSignals(P) {
  const hip = sub(P[23], P[24]);                       // left hip - right hip
  const L = unit(sub(hip, scale(UP, dot(hip, UP))));   // body's left, horizontal
  const F = cross(UP, L);                              // body's forward/back axis, horizontal
  const body = (v) => [dot(v, L), dot(v, UP), dot(v, F)];
  const sw = norm(sub(P[11], P[12])) + 1e-9;           // shoulder width
  const legLen = (norm(sub(P[23], P[25])) + norm(sub(P[25], P[27])) +
                  norm(sub(P[24], P[26])) + norm(sub(P[26], P[28]))) / 2 + 1e-9;
  const spine = unit(sub(mid(P[11], P[12]), mid(P[23], P[24])));
  const sl = sub(P[11], P[12]);
  const slh = unit(sub(sl, scale(UP, dot(sl, UP))));
  const rot = Math.atan2(dot(cross(L, slh), UP), dot(L, slh)) * DEG;
  return [
    angleAt(P[23], P[25], P[27]) / 180, angleAt(P[24], P[26], P[28]) / 180,   // knees
    angleAt(P[11], P[23], P[25]) / 180, angleAt(P[12], P[24], P[26]) / 180,   // hips
    angleAt(P[11], P[13], P[15]) / 180, angleAt(P[12], P[14], P[16]) / 180,   // elbows
    angleAt(P[23], P[11], P[13]) / 180, angleAt(P[24], P[12], P[14]) / 180,   // shoulders (trunk-arm)
    ...body(unit(sub(P[16], P[12]))),                                          // right arm direction
    ...body(unit(sub(P[15], P[11]))),                                          // left arm direction
    dot(spine, L), dot(spine, F),                                              // torso lean side / fwd
    norm(sub(P[7], P[11])) / sw, norm(sub(P[8], P[12])) / sw,                  // shrug (ear to shoulder)
    angleBetween(sub(P[7], P[8]), sl) / 90,                                    // head tilt vs shoulders
    clip(norm(sub(P[25], P[26])) / (norm(sub(P[27], P[28])) + 1e-9), 0, 5),   // knees vs ankles
    clip(norm(sub(P[27], P[28])) / (norm(sub(P[23], P[24])) + 1e-9), 0, 5),   // stance vs hips
    dot(sub(P[29], P[31]), UP) / legLen, dot(sub(P[30], P[32]), UP) / legLen,  // heel lift
    dot(sub(P[25], P[31]), F) / legLen, dot(sub(P[26], P[32]), F) / legLen,    // knee past toes
    rot / 90,                                                                  // shoulders vs hips
  ];
}

// One rep (array of frames) -> fixed-length vector: each signal resampled to 16 points + min, max, mean.
// set = "abs" (absolute values), "delta" (change from the rep's own start pose, so no per-user calibration is
// needed), or "abs+delta".
export function repFeatures(frames, set = "abs") {
  const S = frames.map(frameSignals);
  if (set === "abs+delta") return [...summarize(S), ...summarize(deltas(S))];
  return summarize(set === "delta" ? deltas(S) : S);
}

function deltas(S) {
  const n = Math.min(3, S.length), start = S[0].map((_, j) => S.slice(0, n).reduce((a, r) => a + r[j], 0) / n);
  return S.map((r) => r.map((v, j) => v - start[j]));
}

function summarize(S) {
  const T = S.length;
  const out = [];
  for (let j = 0; j < SIGNAL_NAMES.length; j++) {
    const s = S.map((r) => r[j]);
    for (let k = 0; k < N_RESAMPLE; k++) {
      const t = (k * (T - 1)) / (N_RESAMPLE - 1);
      const i = Math.floor(t), f = t - i;
      out.push(i + 1 < T ? s[i] * (1 - f) + s[i + 1] * f : s[T - 1]);
    }
    let lo = Infinity, hi = -Infinity, sum = 0;
    for (const v of s) { lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; }
    out.push(lo, hi, sum / T);
  }
  return out;
}

// Per-user calibration: features are judged relative to the median of the user's own previous reps.
export class Calibrator {
  constructor({ reps, window }) { this.need = reps; this.window = window; this.past = []; }
  get ready() { return this.past.length >= this.need; }
  get count() { return this.past.length; }
  center() {
    const n = this.past.length, d = this.past[0].length, out = new Array(d);
    for (let i = 0; i < d; i++) {
      const col = this.past.map((x) => x[i]).sort((a, b) => a - b);
      out[i] = n % 2 ? col[n >> 1] : (col[n / 2 - 1] + col[n / 2]) / 2;
    }
    return out;
  }
  add(x) { this.past.push(x); if (this.past.length > this.window) this.past.shift(); }
}

// Multinomial logistic regression exported by train_rehab26.py. `center` = Calibrator.center().
export function classify(model, frames, center = null, x = repFeatures(frames, model.feature_set)) {
  const c = center ?? x.map(() => 0);
  const z = x.map((v, i) => (v - c[i] - model.mean[i]) / model.std[i]);
  const logits = model.coef.map((row, c) => row.reduce((a, w, i) => a + w * z[i], model.intercept[c]));
  const m = Math.max(...logits);
  const e = logits.map((l) => Math.exp(l - m));
  const s = e.reduce((a, b) => a + b, 0);
  const probs = e.map((v) => v / s);
  const best = probs.indexOf(Math.max(...probs));
  return { label: model.classes[best], prob: probs[best], probs: Object.fromEntries(model.classes.map((c, i) => [c, probs[i]])) };
}

// Sensitive decision: name the most likely mistake whenever P(correct) < model.tau.
export function decide(model, out) {
  if ((out.probs.CORRECT ?? 0) >= model.tau) return { ...out, label: "CORRECT", prob: out.probs.CORRECT };
  const [label, prob] = Object.entries(out.probs).filter(([c]) => c !== "CORRECT").sort((a, b) => b[1] - a[1])[0];
  return { ...out, label, prob };
}

// Live rep detection on one "primary" signal: a rep starts when it moves away from the resting value
// and ends when it comes back. Returns the rep's frames when a rep completes, else null.
export function primarySignal(kind, P) {
  if (kind === "knees") return (angleAt(P[23], P[25], P[27]) + angleAt(P[24], P[26], P[28])) / 2;
  if (kind === "right_shoulder") return angleAt(P[24], P[12], P[14]);
  if (kind === "shoulder_height") {  // shoulders above ankles, % of leg length (drops as you squat)
    const leg = (norm(sub(P[23], P[25])) + norm(sub(P[25], P[27])) + norm(sub(P[24], P[26])) + norm(sub(P[26], P[28]))) / 2 + 1e-9;
    return (dot(sub(mid(P[11], P[12]), mid(P[27], P[28])), UP) * 100) / leg;
  }
  throw new Error("unknown primary " + kind);
}

export class RepSegmenter {
  constructor(cfg) {
    // {primary, restIs: "min"|"max", start, end, rest, minFrames, maxFrames, pad, calibFrames, history}
    this.cfg = cfg;
    this.reset();
  }
  reset() {
    this.buf = []; this.hist = []; this.base = null; this.inRep = false; this.startIdx = 0;
  }
  get ready() { return this.hist.length >= this.cfg.calibFrames; }
  get value() { return this.buf.length ? this.buf[this.buf.length - 1].v : null; }
  // distance from rest in the direction the exercise moves (positive = away from rest)
  away(v) { return this.cfg.restIs === "max" ? this.base - v : v - this.base; }
  push(P) {
    const c = this.cfg;
    const v = primarySignal(c.primary, P);
    this.buf.push({ P, v });
    if (!this.inRep) {
      // Resting = the low end (arm down) or high end (standing tall) of the last few seconds outside reps.
      // Robust to people who start moving straight away, and follows slow drift.
      this.hist.push(v);
      if (this.hist.length > c.history) this.hist.shift();
      const s = [...this.hist].sort((a, b) => a - b);
      this.base = c.restIs === "max" ? s[Math.floor(0.9 * (s.length - 1))] : s[Math.ceil(0.1 * (s.length - 1))];
      if (!this.ready) { if (this.buf.length > c.pad) this.buf.shift(); return null; }
    }
    const d = this.away(v);
    if (!this.inRep) {
      if (d > c.start) {
        let i = this.buf.length - 1;
        while (i > 0 && this.away(this.buf[i - 1].v) > c.rest) i--;
        this.startIdx = Math.max(0, i - c.pad);
        this.inRep = true;
      } else if (this.buf.length > 4 * c.pad) {
        this.buf.splice(0, this.buf.length - 2 * c.pad);
      }
      return null;
    }
    const len = this.buf.length - this.startIdx;
    if (d < c.end && len >= c.minFrames) {
      const frames = this.buf.slice(this.startIdx).map((b) => b.P);
      this.buf = this.buf.slice(-c.pad); this.inRep = false;
      return frames;
    }
    if (len > c.maxFrames) { this.buf = this.buf.slice(-c.pad); this.inRep = false; }  // abandon
    return null;
  }
}

// Guided tempo, for movements a front camera can't see well enough to detect on its own (e.g. shoulder
// extension, which moves along the camera's depth axis). The app cues "Back" on a beat; each beat's
// window of frames is one rep. push(P, tMs) returns the frames when a window completes.
export class TempoSegmenter {
  constructor(cfg) { this.cfg = cfg; this.reset(); }   // {mode: "tempo", window, gap, firstCue} in ms
  reset() { this.nextCue = null; this.collecting = false; this.frames = []; this.cueFired = false; this.lastT = 0; }
  get inRep() { return this.collecting; }
  get ready() { return true; }
  get value() { return this.nextCue === null ? null : Math.max(0, (this.nextCue - this.lastT) / 1000); }
  takeCue() { const c = this.cueFired; this.cueFired = false; return c; }   // true once per beat
  push(P, t) {
    this.lastT = t;
    if (this.nextCue === null) this.nextCue = t + this.cfg.firstCue;
    if (!this.collecting && t >= this.nextCue) { this.collecting = true; this.start = t; this.frames = []; this.cueFired = true; }
    if (!this.collecting) return null;
    this.frames.push(P);
    if (t - this.start < this.cfg.window) return null;
    this.collecting = false; this.nextCue = t + this.cfg.gap;
    return this.frames;
  }
}

export const makeSegmenter = (cfg) => (cfg.mode === "tempo" ? new TempoSegmenter(cfg) : new RepSegmenter(cfg));
