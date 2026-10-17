/**
 * EC3D exercise classifier: squat | lunge | plank.
 * Prefers trained multinomial logistic weights from /models/exercise_weights.json
 * (trained by model/train_ec3d.py). Falls back to heuristic stub.
 */

import { LM } from "./jointAngles";

export const EXERCISES = ["squat", "lunge", "plank", "unknown"];

export const EXERCISE_LABELS = {
  en: {
    squat: "Squat",
    lunge: "Lunge",
    plank: "Plank",
    unknown: "Waiting",
  },
  es: {
    squat: "Sentadilla",
    lunge: "Zancada",
    plank: "Plancha",
    unknown: "Esperando",
  },
};

const WINDOW = 18;
const MIN_CONFIDENCE = 0.42;

let trainedWeights = null;
let weightsLoadPromise = null;

/** Load trained weights once (browser). */
export function loadExerciseWeights() {
  if (trainedWeights) return Promise.resolve(trainedWeights);
  if (weightsLoadPromise) return weightsLoadPromise;
  if (typeof fetch === "undefined") return Promise.resolve(null);

  weightsLoadPromise = fetch("/models/exercise_weights.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      trainedWeights = json;
      return json;
    })
    .catch(() => {
      trainedWeights = null;
      return null;
    });
  return weightsLoadPromise;
}

export function createExerciseClassifier() {
  // kick off weight load early
  loadExerciseWeights();
  return {
    history: [],
    label: "unknown",
    confidence: 0,
    scores: { squat: 0, lunge: 0, plank: 0, unknown: 1 },
    source: "pending",
  };
}

export function updateExerciseClassifier(state, landmarks, metrics, language = "en") {
  const frameScores = trainedWeights
    ? scoreFrameTrained(landmarks, metrics, trainedWeights)
    : scoreFrameHeuristic(landmarks, metrics);

  state.history.push(frameScores);
  if (state.history.length > WINDOW) state.history.shift();

  const avg = averageScores(state.history);
  const { label, confidence } = pickWinner(avg);

  state.scores = avg;
  state.label = confidence >= MIN_CONFIDENCE ? label : "unknown";
  state.confidence = confidence;
  state.source = trainedWeights ? "ec3d_logistic" : "heuristic_stub";

  const lang = EXERCISE_LABELS[language] ? language : "en";
  return {
    label: state.label,
    confidence: state.confidence,
    scores: state.scores,
    displayName: EXERCISE_LABELS[lang][state.label],
    source: state.source,
  };
}

/** Build feature vector matching model/train_ec3d.py FEATURE_NAMES. */
export function mediapipeFeatures(landmarks, metrics) {
  if (!landmarks || !metrics) return null;

  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];
  const la = landmarks[LM.LEFT_ANKLE];
  const ra = landmarks[LM.RIGHT_ANKLE];

  const leftKnee = metrics.leftKnee ?? 180;
  const rightKnee = metrics.rightKnee ?? 180;
  const leftHip = metrics.leftHip ?? 180;
  const rightHip = metrics.rightHip ?? 180;
  const backTilt = metrics.backTilt ?? 0;
  const kneeAsym = metrics.kneeAsymmetry ?? Math.abs(leftKnee - rightKnee);
  const hipAsym = metrics.hipAsymmetry ?? Math.abs(leftHip - rightHip);

  let ankleYDelta = 0;
  let footSpread = 0;
  let shoulderHipY = 0.3;
  let hipHeight = metrics.hipY ?? 0.5;

  if (vis(la) && vis(ra)) {
    ankleYDelta = Math.abs(la.y - ra.y);
    footSpread = Math.abs(la.x - ra.x);
  }
  if (vis(ls) && vis(rs) && vis(lh) && vis(rh)) {
    const shoulderY = (ls.y + rs.y) / 2;
    const hipY = (lh.y + rh.y) / 2;
    shoulderHipY = Math.abs(shoulderY - hipY);
    hipHeight = hipY;
  }

  // MediaPipe y grows downward; EC3D hip_height used absolute Y.
  // Relative shoulder–hip gap + inverted hip proxy keep signal usable.
  const torsoHoriz = Math.abs(90 - backTilt);

  return [
    leftKnee,
    rightKnee,
    leftHip,
    rightHip,
    backTilt,
    kneeAsym,
    hipAsym,
    ankleYDelta,
    footSpread,
    shoulderHipY,
    0.5 * (leftKnee + rightKnee),
    hipHeight,
    torsoHoriz,
  ];
}

function scoreFrameTrained(landmarks, metrics, weights) {
  const raw = mediapipeFeatures(landmarks, metrics);
  if (!raw) return { squat: 0.1, lunge: 0.1, plank: 0.1, unknown: 0.7 };

  const { mean, scale, coef, intercept, classes } = weights;
  const x = raw.map((v, i) => (v - mean[i]) / (scale[i] || 1));

  const logits = coef.map(
    (row, ci) => row.reduce((s, w, j) => s + w * x[j], 0) + intercept[ci]
  );
  const maxLogit = Math.max(...logits);
  const exps = logits.map((z) => Math.exp(z - maxLogit));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const probs = exps.map((e) => e / sum);

  const scores = { squat: 0.02, lunge: 0.02, plank: 0.02, unknown: 0.05 };
  classes.forEach((c, i) => {
    scores[c] = (scores[c] || 0) + probs[i];
  });

  // Standing → soft unknown (keep badge from flickering while idle)
  const avgKnee = 0.5 * ((metrics.leftKnee ?? 180) + (metrics.rightKnee ?? 180));
  if (avgKnee > 160 && (metrics.kneeAsymmetry ?? 0) < 12) {
    scores.unknown += 0.55;
    scores.squat *= 0.35;
    scores.lunge *= 0.35;
    scores.plank *= 0.35;
  }

  return normalize(scores);
}

/** Legacy heuristic if weights file missing. */
export function scoreFrameHeuristic(landmarks, metrics) {
  const scores = { squat: 0.05, lunge: 0.05, plank: 0.05, unknown: 0.2 };
  if (!landmarks || !metrics) return scores;

  const leftKnee = metrics.leftKnee ?? 180;
  const rightKnee = metrics.rightKnee ?? 180;
  const kneeAsym = metrics.kneeAsymmetry ?? 0;
  const backTilt = metrics.backTilt ?? 0;
  const avgKnee = (leftKnee + rightKnee) / 2;
  const bothBent = avgKnee < 140;

  const la = landmarks[LM.LEFT_ANKLE];
  const ra = landmarks[LM.RIGHT_ANKLE];
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];

  let ankleYDelta = 0;
  let footSpread = 0;
  let shoulderHipYDelta = 0;
  let hipY = metrics.hipY;
  if (vis(la) && vis(ra)) {
    ankleYDelta = Math.abs(la.y - ra.y);
    footSpread = Math.abs(la.x - ra.x);
  }
  if (vis(ls) && vis(rs) && vis(lh) && vis(rh)) {
    const shoulderY = (ls.y + rs.y) / 2;
    const hY = (lh.y + rh.y) / 2;
    shoulderHipYDelta = Math.abs(shoulderY - hY);
    hipY = hY;
  }

  if (backTilt > 50 || shoulderHipYDelta < 0.12) scores.plank += 0.35;
  if (avgKnee > 150 && shoulderHipYDelta < 0.18) scores.plank += 0.4;
  if (hipY != null && hipY > 0.55 && avgKnee > 145) scores.plank += 0.25;

  if (kneeAsym > 25) scores.lunge += 0.45;
  if (ankleYDelta > 0.08 || footSpread > 0.22) scores.lunge += 0.25;
  if (
    (leftKnee < 120 && rightKnee > 145) ||
    (rightKnee < 120 && leftKnee > 145)
  ) {
    scores.lunge += 0.5;
  }

  if (bothBent && kneeAsym < 20) scores.squat += 0.4;
  if (avgKnee < 115 && kneeAsym < 25) scores.squat += 0.35;
  if (backTilt < 45 && bothBent) scores.squat += 0.25;

  if (avgKnee > 155 && kneeAsym < 15 && backTilt < 35 && shoulderHipYDelta > 0.2) {
    scores.unknown += 0.7;
    scores.squat *= 0.3;
    scores.lunge *= 0.3;
    scores.plank *= 0.2;
  }

  return normalize(scores);
}

// keep old name for any imports
export const scoreFrame = scoreFrameHeuristic;

function averageScores(history) {
  const keys = EXERCISES;
  const sum = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const s of history) {
    for (const k of keys) sum[k] += s[k] || 0;
  }
  const n = Math.max(1, history.length);
  return normalize(Object.fromEntries(keys.map((k) => [k, sum[k] / n])));
}

function pickWinner(scores) {
  let label = "unknown";
  let confidence = 0;
  for (const k of ["squat", "lunge", "plank", "unknown"]) {
    if ((scores[k] || 0) > confidence) {
      confidence = scores[k];
      label = k;
    }
  }
  return { label, confidence };
}

function normalize(scores) {
  const keys = Object.keys(scores);
  const total = keys.reduce((a, k) => a + Math.max(0, scores[k]), 0) || 1;
  const out = {};
  for (const k of keys) out[k] = Math.max(0, scores[k]) / total;
  return out;
}

function vis(p, min = 0.4) {
  return p && (p.visibility ?? 1) >= min;
}

export function formatDetectedBadge(label, language = "en") {
  const lang = EXERCISE_LABELS[language] ? language : "en";
  const name = EXERCISE_LABELS[lang][label] || EXERCISE_LABELS.en.unknown;
  if (language === "es") {
    return label === "unknown" ? "Detectado: …" : `Detectado: ${name}`;
  }
  return label === "unknown" ? "Detected: …" : `Detected: ${name}`;
}
