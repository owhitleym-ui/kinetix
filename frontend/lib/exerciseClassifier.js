/**
 * Exercise classifier for synthetic lower-back PT:
 * bird_dog | side_plank
 * Weights from /models/exercise_weights.json (train_ec3d.py on synthetic only).
 */

import { LM } from "./jointAngles";

export const EXERCISES = ["bird_dog", "side_plank", "unknown"];

export const EXERCISE_LABELS = {
  en: {
    bird_dog: "Bird dog",
    side_plank: "Side plank",
    unknown: "Waiting",
  },
  es: {
    bird_dog: "Bird dog",
    side_plank: "Plancha lateral",
    unknown: "Esperando",
  },
};

const WINDOW = 18;
const MIN_CONFIDENCE = 0.42;

let trainedWeights = null;
let weightsLoadPromise = null;

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

function blankScores(unknown = 0) {
  return { bird_dog: 0, side_plank: 0, unknown };
}

export function createExerciseClassifier() {
  loadExerciseWeights();
  return {
    history: [],
    label: "unknown",
    confidence: 0,
    scores: blankScores(1),
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
  state.source = trainedWeights ? "synthetic_logistic" : "heuristic_stub";

  const lang = EXERCISE_LABELS[language] ? language : "en";
  return {
    label: state.label,
    confidence: state.confidence,
    scores: state.scores,
    displayName: EXERCISE_LABELS[lang][state.label] || state.label,
    source: state.source,
  };
}

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
    Math.abs(90 - backTilt),
  ];
}

function scoreFrameTrained(landmarks, metrics, weights) {
  const raw = mediapipeFeatures(landmarks, metrics);
  if (!raw) {
    return { bird_dog: 0.15, side_plank: 0.15, unknown: 0.7 };
  }

  const { mean, scale, coef, intercept, classes } = weights;
  const x = raw.map((v, i) => (v - mean[i]) / (scale[i] || 1));
  const logits = coef.map(
    (row, ci) => row.reduce((s, w, j) => s + w * x[j], 0) + intercept[ci]
  );
  const maxLogit = Math.max(...logits);
  const exps = logits.map((z) => Math.exp(z - maxLogit));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const probs = exps.map((e) => e / sum);

  const scores = blankScores(0.08);
  classes.forEach((c, i) => {
    scores[c] = (scores[c] || 0) + probs[i];
  });

  // Standing / upright idle → unknown
  const avgKnee = 0.5 * ((metrics.leftKnee ?? 180) + (metrics.rightKnee ?? 180));
  const sh = landmarks[LM.LEFT_SHOULDER];
  const hip = landmarks[LM.LEFT_HIP];
  const upright =
    avgKnee > 155 &&
    sh &&
    hip &&
    Math.abs((sh.y ?? 0) - (hip.y ?? 0)) > 0.18;
  if (upright) {
    scores.unknown += 0.65;
    scores.bird_dog *= 0.25;
    scores.side_plank *= 0.25;
  }

  return normalize(scores);
}

export function scoreFrameHeuristic(landmarks, metrics) {
  const scores = { bird_dog: 0.08, side_plank: 0.08, unknown: 0.3 };
  if (!landmarks || !metrics) return scores;

  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];
  const la = landmarks[LM.LEFT_ANKLE];
  const ra = landmarks[LM.RIGHT_ANKLE];
  const lw = landmarks[LM.LEFT_WRIST];
  const rw = landmarks[LM.RIGHT_WRIST];
  const avgKnee =
    0.5 * ((metrics.leftKnee ?? 180) + (metrics.rightKnee ?? 180));

  let shoulderY = null;
  let hipY = metrics.hipY;
  if (vis(ls) && vis(rs) && vis(lh) && vis(rh)) {
    shoulderY = (ls.y + rs.y) / 2;
    hipY = (lh.y + rh.y) / 2;
  }

  // Side plank: large left/right shoulder height delta
  if (vis(ls) && vis(rs) && Math.abs(ls.y - rs.y) > 0.12 && avgKnee > 130) {
    scores.side_plank += 0.6;
  }

  // Bird dog: quadruped — hips near shoulders in Y, body low
  if (hipY != null && shoulderY != null && Math.abs(hipY - shoulderY) < 0.14 && hipY > 0.42) {
    scores.bird_dog += 0.45;
  }
  if (vis(lw) && vis(rw) && vis(la) && vis(ra)) {
    if (Math.abs(lw.y - rw.y) > 0.14 || Math.abs(la.y - ra.y) > 0.12) {
      scores.bird_dog += 0.35;
    }
  }

  if (avgKnee > 155 && shoulderY != null && hipY != null && Math.abs(shoulderY - hipY) > 0.2) {
    scores.unknown += 0.7;
    scores.bird_dog *= 0.25;
    scores.side_plank *= 0.25;
  }

  return normalize(scores);
}

export const scoreFrame = scoreFrameHeuristic;

function averageScores(history) {
  const sum = blankScores(0);
  for (const s of history) {
    for (const k of EXERCISES) sum[k] += s[k] || 0;
  }
  const n = Math.max(1, history.length);
  return normalize(Object.fromEntries(EXERCISES.map((k) => [k, sum[k] / n])));
}

function pickWinner(scores) {
  let label = "unknown";
  let confidence = 0;
  for (const k of EXERCISES) {
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
