// Rule checks with clinical thresholds (the approach of Adarsh & Francis, NCECA 2026: measure joint angles, compare
// them with the range that defines correct form, name the mistake when an angle leaves it). Thresholds come from
// textbook range-of-motion norms and common compensation limits, set in training/clinical_rules.py.
// Mirror of training/angle_rules.py; tests/rules_test.mjs checks the two agree.
//
// Angles are measured in the image plane, because these exercises move across the camera's view while the person
// faces it and MediaPipe's depth is its weakest axis. Image x is scaled by the frame's aspect ratio (width / height)
// so angles are true. Right-arm exercises.

export const FOREARM_TO_UPPER_ARM = 0.78;   // segment length ratio (Winter): turns how tall the forearm looks into an angle
const DEG = 180 / Math.PI;
const angle2 = (u, v) => Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) + 1e-9)))) * DEG;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];

// One frame -> named signals. img: 33 x [x, y, ...] normalized; facing = +1 / -1 (which way is the person's left).
export function frameRuleSignals(img, aspect, facing = 1) {
  const p = (i) => [img[i][0] * aspect, img[i][1]];
  const shR = p(12), shL = p(11), el = p(14), wr = p(16);
  const midSh = [(shL[0] + shR[0]) / 2, (shL[1] + shR[1]) / 2];
  const sw = Math.hypot(...sub(shL, shR)) + 1e-9;
  const left = [(shL[0] - shR[0]) / sw, (shL[1] - shR[1]) / sw];
  const upper = Math.hypot(...sub(el, shR)) + 1e-9;
  const side = sub(shL, p(23));
  const h = sub(wr, midSh);
  return {
    arm_raise: angle2(sub(p(24), shR), sub(el, shR)),                       // 0 = arm down, 180 = overhead
    elbow: angle2(sub(shR, el), sub(wr, el)),                               // 180 = straight
    trunk_lean: Math.atan2(side[0] * facing, -side[1]) * DEG,               // non-working side, from vertical
    hand_across: (h[0] * left[0] + h[1] * left[1]) / sw,                    // 0 = midline, 0.5 = other shoulder
    rotation: Math.asin(Math.max(-1, Math.min(1, (el[1] - wr[1]) / upper / FOREARM_TO_UPPER_ARM))) * DEG,  // +90 up, -90 down
  };
}

// Primary signal for live rep detection ("img:<name>" in the segmenter config); needs P.img and P.aspect.
export const imgSignal = (name, P) => frameRuleSignals(P.img, P.aspect ?? 16 / 9)[name];

const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };

// One rep (frames with .img and .aspect) -> {checkId: value}.
export function ruleValues(model, frames) {
  const aspect = frames[0].aspect ?? 16 / 9;
  const facing = Math.sign(median(frames.map((f) => f.img[11][0] - f.img[12][0]))) || 1;
  const S = frames.map((f) => frameRuleSignals(f.img, aspect, facing));
  const prim = S.map((s) => s[model.primary]);
  const peak = prim.indexOf(model.segmenter.restIs === "min" ? Math.max(...prim) : Math.min(...prim));
  const out = {};
  for (const c of model.checks) {
    const sig = S.map((s) => s[c.signal]);
    const start = sig.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, sig.length);
    out[c.id] = c.stat === "peak" ? sig[peak] : c.stat === "max" ? Math.max(...sig) : c.stat === "min" ? Math.min(...sig)
      : Math.max(...sig.map((v) => Math.abs(v - start)));   // "drift": largest change from the start position
  }
  return out;
}

// Mobility setting: range-of-motion limits move toward the resting value (ampScale), compensation limits loosen.
export function limitsFor(c, mob) {
  let lo = c.min, hi = c.max;
  if (mob && c.kind === "rom") {
    if (lo != null) lo = c.rest + (lo - c.rest) * mob.ampScale;
    if (hi != null) hi = c.rest + (hi - c.rest) * mob.ampScale;
  }
  if (mob && c.kind === "comp" && hi != null) hi = hi * (mob.compSlack ?? 1);
  return [lo, hi];
}

// Most severe failed check -> {label, gap, rows}; rows = every check with its value and limits (for the UI).
export function judgeRules(model, values, mob = null) {
  let label = "CORRECT", gap = 0;
  const rows = model.checks.map((c) => {
    const [lo, hi] = limitsFor(c, mob), v = values[c.id];
    let code = null, g = 0;
    if (lo != null && v < lo) { code = c.code_low; g = (lo - v) / c.scale; }
    if (hi != null && v > hi && (v - hi) / c.scale > g) { code = c.code_high; g = (v - hi) / c.scale; }
    if (code && g > gap) { label = code; gap = g; }
    return { id: c.id, label: c.label, unit: c.unit, value: v, lo, hi, ok: !code };
  });
  return { label, gap, rows };
}
