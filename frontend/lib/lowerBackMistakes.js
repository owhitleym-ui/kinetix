/**
 * Live mistake detection for bird dog + side plank.
 * Uses trained mistake_weights.json when available, else MediaPipe heuristics
 * matched to synthetic_lowerback_3D.pickle labels.
 */

import { LM } from "./jointAngles";
import { mediapipeFeatures } from "./exerciseClassifier";

export const BIRD_DOG_MISTAKES = [
  "leg_too_high",
  "lumbar_hyperextension",
  "trunk_rotation",
  "lateral_hip_shift",
  "head_lifting",
];

export const SIDE_PLANK_MISTAKES = [
  "hip_sag",
  "pelvic_rotation",
  "shoulder_collapse",
  "head_tilt",
];

const HIGHLIGHTS = {
  leg_too_high: ["left_hip", "right_hip", "left_knee", "right_knee"],
  lumbar_hyperextension: ["left_shoulder", "right_shoulder", "left_hip", "right_hip"],
  trunk_rotation: ["left_shoulder", "right_shoulder", "left_hip", "right_hip"],
  lateral_hip_shift: ["left_hip", "right_hip"],
  head_lifting: ["left_shoulder", "right_shoulder"],
  hip_sag: ["left_hip", "right_hip"],
  pelvic_rotation: ["left_hip", "right_hip"],
  shoulder_collapse: ["left_shoulder", "right_shoulder"],
  head_tilt: ["left_shoulder", "right_shoulder"],
};

let mistakeWeights = null;
let loadPromise = null;

export function loadMistakeWeights() {
  if (mistakeWeights) return Promise.resolve(mistakeWeights);
  if (loadPromise) return loadPromise;
  if (typeof fetch === "undefined") return Promise.resolve(null);
  loadPromise = fetch("/models/mistake_weights.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      mistakeWeights = j;
      return j;
    })
    .catch(() => {
      mistakeWeights = null;
      return null;
    });
  return loadPromise;
}

/**
 * @returns {{ errorType: string|null, tone: 'good'|'bad', confidence: number, highlightJoints: string[], source: string }}
 */
export function evaluateLowerBackMistake(exercise, landmarks, metrics) {
  if (exercise !== "bird_dog" && exercise !== "side_plank") {
    return {
      errorType: null,
      tone: "good",
      confidence: 0,
      highlightJoints: [],
      source: "none",
    };
  }

  if (mistakeWeights) {
    const scored = scoreWithWeights(landmarks, metrics, mistakeWeights, exercise);
    if (scored) return scored;
  }

  return scoreWithHeuristics(exercise, landmarks, metrics);
}

function scoreWithWeights(landmarks, metrics, weights, exercise) {
  const raw = mediapipeFeatures(landmarks, metrics);
  if (!raw) return null;

  const { mean, scale, coef, intercept, classes } = weights;
  const x = raw.map((v, i) => (v - mean[i]) / (scale[i] || 1));
  const logits = coef.map(
    (row, ci) => row.reduce((s, w, j) => s + w * x[j], 0) + intercept[ci]
  );
  const maxLogit = Math.max(...logits);
  const exps = logits.map((z) => Math.exp(z - maxLogit));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const probs = exps.map((e) => e / sum);

  const allowed =
    exercise === "bird_dog"
      ? new Set(["correct", ...BIRD_DOG_MISTAKES])
      : new Set(["correct", ...SIDE_PLANK_MISTAKES]);

  let best = "correct";
  let bestP = -1;
  classes.forEach((c, i) => {
    if (!allowed.has(c)) return;
    if (probs[i] > bestP) {
      bestP = probs[i];
      best = c;
    }
  });

  if (best === "correct" || bestP < 0.28) {
    return {
      errorType: null,
      tone: "good",
      confidence: bestP,
      highlightJoints: [],
      source: "mistake_weights",
    };
  }

  return {
    errorType: best,
    tone: "bad",
    confidence: bestP,
    highlightJoints: HIGHLIGHTS[best] || ["left_hip", "right_hip"],
    source: "mistake_weights",
  };
}

function scoreWithHeuristics(exercise, landmarks, metrics) {
  const nose = landmarks[LM.NOSE];
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];
  const lk = landmarks[LM.LEFT_KNEE];
  const rk = landmarks[LM.RIGHT_KNEE];
  const la = landmarks[LM.LEFT_ANKLE];
  const ra = landmarks[LM.RIGHT_ANKLE];

  const shoulderMid = mid(ls, rs);
  const hipMid = mid(lh, rh);
  const backTilt = metrics.backTilt ?? 0;

  if (exercise === "bird_dog") {
    // Head lifting: nose much higher than shoulders (smaller y in MediaPipe = higher)
    if (vis(nose) && shoulderMid && nose.y < shoulderMid.y - 0.08) {
      return bad("head_lifting", 0.7);
    }
    // Lumbar hyperextension: large back tilt while "flat" pose expected
    if (backTilt > 38 && hipMid && shoulderMid && Math.abs(hipMid.y - shoulderMid.y) < 0.15) {
      return bad("lumbar_hyperextension", 0.65);
    }
    // Lateral hip shift: hips far from shoulder midline in x
    if (hipMid && shoulderMid && Math.abs(hipMid.x - shoulderMid.x) > 0.1) {
      return bad("lateral_hip_shift", 0.62);
    }
    // Trunk rotation: large shoulder y delta on all-fours
    if (vis(ls) && vis(rs) && Math.abs(ls.y - rs.y) > 0.09) {
      return bad("trunk_rotation", 0.6);
    }
    // Leg too high: one ankle much higher (smaller y) than hips
    if (hipMid && vis(la) && vis(ra)) {
      const raised = Math.min(la.y, ra.y);
      if (raised < hipMid.y - 0.18) return bad("leg_too_high", 0.68);
    }
    return good(0.55);
  }

  // side_plank
  if (vis(ls) && vis(rs) && Math.abs(ls.y - rs.y) < 0.04) {
    // not really in side plank orientation — don't spam mistakes
    return good(0.4);
  }
  // Hip sag: hips much lower than shoulders (larger y)
  if (hipMid && shoulderMid && hipMid.y > shoulderMid.y + 0.12) {
    return bad("hip_sag", 0.72);
  }
  // Shoulder collapse: support shoulder much lower / collapsed toward hip
  if (hipMid && shoulderMid && Math.abs(hipMid.y - shoulderMid.y) < 0.04) {
    return bad("shoulder_collapse", 0.6);
  }
  // Pelvic rotation: large hip y mismatch
  if (vis(lh) && vis(rh) && Math.abs(lh.y - rh.y) > 0.1) {
    return bad("pelvic_rotation", 0.65);
  }
  // Head tilt: nose far from shoulder line
  if (vis(nose) && shoulderMid && Math.abs(nose.x - shoulderMid.x) > 0.14) {
    return bad("head_tilt", 0.6);
  }
  return good(0.55);
}

function bad(errorType, confidence) {
  return {
    errorType,
    tone: "bad",
    confidence,
    highlightJoints: HIGHLIGHTS[errorType] || [],
    source: "heuristic",
  };
}

function good(confidence) {
  return {
    errorType: null,
    tone: "good",
    confidence,
    highlightJoints: [],
    source: "heuristic",
  };
}

function mid(a, b) {
  if (!vis(a) || !vis(b)) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function vis(p, min = 0.4) {
  return p && (p.visibility ?? 1) >= min;
}
