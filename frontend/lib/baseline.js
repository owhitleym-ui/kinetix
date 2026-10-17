/**
 * Personal movement baseline from calibration reps.
 * Stores mean + std for each joint metric at each squat phase.
 */

import { METRIC_KEYS } from "./jointAngles";

export const PHASES = ["descent", "bottom", "ascent"];

/**
 * @typedef {{ mean: number, std: number, n: number }} Stat
 * @typedef {Record<string, Record<string, Stat>>} Baseline
 */

export function createEmptyBaseline() {
  /** @type {Baseline} */
  const baseline = {};
  for (const phase of PHASES) {
    baseline[phase] = {};
    for (const key of METRIC_KEYS) {
      baseline[phase][key] = { mean: 0, std: 0, n: 0, _sum: 0, _sumSq: 0 };
    }
  }
  return baseline;
}

/**
 * Add a frame's metrics into the running baseline for a given phase.
 */
export function accumulateFrame(baseline, phase, metrics) {
  if (!baseline[phase] || !metrics) return;
  for (const key of METRIC_KEYS) {
    const v = metrics[key];
    if (v == null || Number.isNaN(v)) continue;
    const s = baseline[phase][key];
    s._sum += v;
    s._sumSq += v * v;
    s.n += 1;
  }
}

/**
 * Finalize means and standard deviations after calibration.
 */
export function finalizeBaseline(baseline) {
  for (const phase of PHASES) {
    for (const key of METRIC_KEYS) {
      const s = baseline[phase][key];
      if (s.n === 0) {
        s.mean = 0;
        s.std = 1; // avoid div-by-zero; treat as loose
        continue;
      }
      s.mean = s._sum / s.n;
      const variance = Math.max(0, s._sumSq / s.n - s.mean ** 2);
      s.std = Math.sqrt(variance);
      // Floor std so tiny sample noise doesn't fire false positives
      if (s.std < 2) s.std = 2;
      delete s._sum;
      delete s._sumSq;
    }
  }
  return baseline;
}

/**
 * Z-score of a metric vs baseline for a phase.
 * Returns null if no baseline data.
 */
export function zScore(baseline, phase, key, value) {
  if (value == null || !baseline?.[phase]?.[key]) return null;
  const { mean, std, n } = baseline[phase][key];
  if (!n || !std) return null;
  return (value - mean) / std;
}

/**
 * Serialize baseline for session storage / OCI upload.
 */
export function serializeBaseline(baseline) {
  const out = {};
  for (const phase of PHASES) {
    out[phase] = {};
    for (const key of METRIC_KEYS) {
      const { mean, std, n } = baseline[phase][key];
      out[phase][key] = { mean, std, n };
    }
  }
  return out;
}
