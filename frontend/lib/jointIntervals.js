/**
 * Port of Data/Data-test-2/joint_intervals.py
 * Correct / incorrect judged by metric intervals [lo, hi] during HOLD.
 */

export const RULES = {
  bird_dog: [
    {
      metric: "moving_knee_deg",
      kind: "interior",
      lo: 165,
      hi: 180,
      low: { label: "leg_not_extended", cue: "Straighten your back leg." },
      high: null,
    },
    {
      metric: "support_knee_deg",
      kind: "interior",
      lo: 80,
      hi: 100,
      low: { label: "support_knee_too_closed", cue: "Bring your support knee under your hip." },
      high: { label: "support_knee_too_open", cue: "Bring your support knee under your hip." },
    },
    {
      metric: "leg_vs_trunk_deg",
      kind: "signed",
      lo: -10,
      hi: 10,
      low: { label: "leg_too_low", cue: "Lift your leg up to trunk height." },
      high: { label: "leg_too_high", cue: "Lower your leg to trunk height." },
    },
    {
      metric: "arm_flexion_deg",
      kind: "interior",
      lo: 85,
      hi: 115,
      low: { label: "arm_too_low", cue: "Reach your arm out to shoulder height." },
      high: { label: "arm_too_high", cue: "Lower your arm to shoulder height." },
    },
    {
      metric: "spine_sag_ratio",
      kind: "linear",
      lo: -0.04,
      hi: 0.04,
      low: { label: "lumbar_rounding", cue: "Don't round your back; keep it flat." },
      high: {
        label: "lumbar_hyperextension",
        cue: "Brace your core, don't let your belly sag.",
      },
    },
    {
      metric: "trunk_rotation_deg",
      kind: "signed",
      lo: -8,
      hi: 8,
      low: { label: "trunk_rotation", cue: "Keep your shoulders square to the floor." },
      high: { label: "trunk_rotation", cue: "Keep your shoulders square to the floor." },
    },
    {
      metric: "pelvis_lateral_shift_m",
      kind: "linear",
      lo: -0.03,
      hi: 0.03,
      low: { label: "lateral_hip_shift", cue: "Keep your hips centred, don't shift sideways." },
      high: { label: "lateral_hip_shift", cue: "Keep your hips centred, don't shift sideways." },
    },
    {
      metric: "head_vs_trunk_deg",
      kind: "signed",
      lo: -25,
      hi: 5,
      low: { label: "head_dropped", cue: "Lift your gaze slightly; keep your neck long." },
      high: { label: "head_lifting", cue: "Look at the floor, keep your neck neutral." },
    },
  ],
  side_plank: [
    {
      metric: "hip_line_dev_deg",
      kind: "signed",
      lo: -10,
      hi: 10,
      low: {
        label: "hip_sag",
        cue: "Lift your hips up in line with your shoulders and knees.",
      },
      high: {
        label: "hip_pike",
        cue: "Lower your hips a little to make a straight line.",
      },
    },
    {
      metric: "knee_flex_deg",
      kind: "interior",
      lo: 80,
      hi: 100,
      low: { label: "knees_too_closed", cue: "Open your knees to about 90 degrees." },
      high: { label: "knees_too_open", cue: "Bend your knees to about 90 degrees." },
    },
    {
      metric: "elbow_deg",
      kind: "interior",
      lo: 80,
      hi: 100,
      low: {
        label: "shoulder_collapse",
        cue: "Push the floor away; lift out of your shoulder.",
      },
      high: { label: "elbow_too_far", cue: "Stack your elbow under your shoulder." },
    },
    {
      metric: "pelvic_rotation_deg",
      kind: "signed",
      lo: -10,
      hi: 10,
      low: { label: "pelvic_rotation", cue: "Stack your hips, don't roll forward or back." },
      high: { label: "pelvic_rotation", cue: "Stack your hips, don't roll forward or back." },
    },
    {
      metric: "head_drop_deg",
      kind: "interior",
      lo: 0,
      hi: 11,
      low: null,
      high: { label: "head_tilt", cue: "Keep your head in line with your spine." },
    },
  ],
};

export function wrap180(x) {
  return ((((x + 180) % 360) + 360) % 360) - 180;
}

/** @returns {{ state: number, fix: number }} state -1 LOW, 0 CORRECT, +1 HIGH */
export function classify(value, kind, lo, hi) {
  const v = Number(value);
  if (!Number.isFinite(v)) return { state: 0, fix: 0 };
  if (kind === "signed") {
    const mid = (lo + hi) / 2;
    const half = (hi - lo) / 2;
    const err = wrap180(v - mid);
    let state = 0;
    if (err < -half) state = -1;
    else if (err > half) state = 1;
    const fix =
      state === -1 ? -half - err : state === 1 ? half - err : 0;
    return { state, fix };
  }
  let state = 0;
  if (v < lo) state = -1;
  else if (v > hi) state = 1;
  const fix = state === -1 ? lo - v : state === 1 ? hi - v : 0;
  return { state, fix };
}

/**
 * Real-time wrapper: EMA + hysteresis so cues don't flicker.
 */
export class StreamJudge {
  constructor(exercise, alpha = 0.4, hyst = 0.15, rules = RULES) {
    this.rules = rules[exercise] || [];
    this.alpha = alpha;
    this.hyst = hyst;
    this.ema = {};
    this.state = {};
    this.rules.forEach((r) => {
      this.state[r.metric] = 0;
    });
  }

  reset() {
    this.ema = {};
    this.rules.forEach((r) => {
      this.state[r.metric] = 0;
    });
  }

  step(metrics) {
    const cues = [];
    for (const r of this.rules) {
      const m = r.metric;
      if (metrics[m] == null || Number.isNaN(metrics[m])) continue;
      const v = Number(metrics[m]);
      this.ema[m] =
        this.ema[m] == null ? v : this.alpha * v + (1 - this.alpha) * this.ema[m];
      const width = (r.hi - r.lo) * this.hyst;
      const cur = this.state[m];
      const tlo = cur !== 0 ? r.lo + width : r.lo;
      const thi = cur !== 0 ? r.hi - width : r.hi;
      const { state, fix } = classify(this.ema[m], r.kind, tlo, thi);
      this.state[m] = state;
      const spec = state === -1 ? r.low : state === 1 ? r.high : null;
      if (spec) {
        cues.push({
          metric: m,
          label: spec.label,
          cue: spec.cue,
          fix,
        });
      }
    }
    return cues;
  }
}
