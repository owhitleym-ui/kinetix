/**
 * Rule-based squat correction logic.
 * Phases: descent → bottom → ascent (via hip Y).
 * Priority: back_round > knee_cave > shallow > asymmetric
 * Fire when deviation exceeds 1.5 SD from personal baseline.
 */

import { zScore } from "./baseline";

export const ERROR_TYPES = {
  BACK_ROUND: "back_round",
  KNEE_CAVE: "knee_cave",
  SHALLOW: "shallow",
  ASYMMETRIC: "asymmetric",
};

const Z_THRESHOLD = 1.5;

export const CUES = {
  en: {
    back_round: "Lower your back",
    knee_cave: "Push your knees out",
    shallow: "Go deeper",
    asymmetric: "Even out both sides",
  },
  es: {
    back_round: "Baja la espalda",
    knee_cave: "Empuja las rodillas hacia afuera",
    shallow: "Baja más",
    asymmetric: "Iguala ambos lados",
  },
};

/**
 * Detect squat phase from hip Y relative to standing baseline.
 * MediaPipe y increases downward.
 */
export function detectPhase(hipY, standingHipY, deepestHipY) {
  if (hipY == null || standingHipY == null) return "standing";
  const range = Math.max(0.02, (deepestHipY ?? standingHipY + 0.15) - standingHipY);
  const depth = (hipY - standingHipY) / range;

  if (depth < 0.15) return "standing";
  if (depth >= 0.85) return "bottom";
  // Caller tracks direction for descent vs ascent
  return "moving";
}

/**
 * Simple state machine for phase + rep counting.
 */
export function createPhaseTracker() {
  return {
    phase: "standing",
    prevHipY: null,
    standingHipY: null,
    deepestHipY: null,
    direction: null, // "down" | "up"
    repCount: 0,
    framesInRep: [],
    lastCompletedRep: null,
  };
}

export function updatePhaseTracker(tracker, metrics) {
  const hipY = metrics?.hipY;
  if (hipY == null) return tracker;

  // Bootstrap standing height from first ~stable frames
  if (tracker.standingHipY == null) {
    tracker.standingHipY = hipY;
  } else if (tracker.phase === "standing") {
    // gently update standing estimate toward min hipY (taller = smaller y)
    tracker.standingHipY = Math.min(tracker.standingHipY, hipY) * 0.1 + tracker.standingHipY * 0.9;
  }

  const prev = tracker.prevHipY;
  tracker.prevHipY = hipY;

  if (prev != null) {
    const dy = hipY - prev;
    if (Math.abs(dy) > 0.002) {
      tracker.direction = dy > 0 ? "down" : "up";
    }
  }

  const range = Math.max(
    0.05,
    (tracker.deepestHipY ?? tracker.standingHipY + 0.12) - tracker.standingHipY
  );
  const depth = (hipY - tracker.standingHipY) / range;

  const prevPhase = tracker.phase;

  if (tracker.phase === "standing") {
    if (tracker.direction === "down" && depth > 0.12) {
      tracker.phase = "descent";
      tracker.framesInRep = [];
      tracker.deepestHipY = hipY;
    }
  } else if (tracker.phase === "descent") {
    tracker.deepestHipY = Math.max(tracker.deepestHipY ?? hipY, hipY);
    if (depth >= 0.75 || (tracker.direction === "up" && depth > 0.4)) {
      tracker.phase = "bottom";
    }
  } else if (tracker.phase === "bottom") {
    tracker.deepestHipY = Math.max(tracker.deepestHipY ?? hipY, hipY);
    if (tracker.direction === "up" && depth < 0.75) {
      tracker.phase = "ascent";
    }
  } else if (tracker.phase === "ascent") {
    if (depth < 0.15) {
      tracker.phase = "standing";
      tracker.repCount += 1;
      tracker.lastCompletedRep = {
        repNumber: tracker.repCount,
        frames: tracker.framesInRep,
        deepestHipY: tracker.deepestHipY,
      };
      tracker.framesInRep = [];
    }
  }

  // Map "moving" internal to descent/ascent for baseline keys
  let reportPhase = tracker.phase;
  if (reportPhase === "standing") reportPhase = prevPhase === "ascent" ? "ascent" : "standing";

  if (tracker.phase !== "standing") {
    tracker.framesInRep.push({
      phase: tracker.phase,
      joints: { ...metrics },
      t: Date.now(),
    });
  }

  return { ...tracker, reportPhase };
}

/**
 * Evaluate corrections against personal baseline.
 * Returns at most one correction (highest priority).
 */
export function evaluateCorrection(baseline, phase, metrics) {
  if (!baseline || !metrics || phase === "standing") return null;

  const evalPhase = phase === "bottom" || phase === "descent" || phase === "ascent" ? phase : null;
  if (!evalPhase) return null;

  // 1. Back rounding — backTilt above baseline mean by >1.5 SD
  const backZ = zScore(baseline, evalPhase, "backTilt", metrics.backTilt);
  if (backZ != null && backZ > Z_THRESHOLD) {
    return {
      errorType: ERROR_TYPES.BACK_ROUND,
      highlightJoints: ["left_shoulder", "right_shoulder", "left_hip", "right_hip"],
      z: backZ,
      baseline: baseline[evalPhase].backTilt.mean,
      current: metrics.backTilt,
      phase: evalPhase,
    };
  }

  // 2. Knee cave — either side
  const leftCaveZ = zScore(baseline, evalPhase, "leftKneeCave", metrics.leftKneeCave);
  const rightCaveZ = zScore(baseline, evalPhase, "rightKneeCave", metrics.rightKneeCave);
  const caveZ = Math.max(leftCaveZ ?? -Infinity, rightCaveZ ?? -Infinity);
  if (caveZ > Z_THRESHOLD) {
    const leftWorse = (leftCaveZ ?? -Infinity) >= (rightCaveZ ?? -Infinity);
    return {
      errorType: ERROR_TYPES.KNEE_CAVE,
      highlightJoints: leftWorse
        ? ["left_knee", "left_ankle", "left_foot"]
        : ["right_knee", "right_ankle", "right_foot"],
      z: caveZ,
      baseline: leftWorse
        ? baseline[evalPhase].leftKneeCave.mean
        : baseline[evalPhase].rightKneeCave.mean,
      current: leftWorse ? metrics.leftKneeCave : metrics.rightKneeCave,
      phase: evalPhase,
    };
  }

  // 3. Depth not reached — at bottom, hip angle too open (higher than baseline)
  if (evalPhase === "bottom") {
    const leftHipZ = zScore(baseline, "bottom", "leftHip", metrics.leftHip);
    const rightHipZ = zScore(baseline, "bottom", "rightHip", metrics.rightHip);
    // Higher hip angle = less flexed = shallower; positive z = shallower than baseline
    const shallowZ = Math.max(leftHipZ ?? -Infinity, rightHipZ ?? -Infinity);
    if (shallowZ > Z_THRESHOLD) {
      return {
        errorType: ERROR_TYPES.SHALLOW,
        highlightJoints: ["left_hip", "right_hip", "left_knee", "right_knee"],
        z: shallowZ,
        baseline: baseline.bottom.leftHip.mean,
        current: metrics.leftHip,
        phase: evalPhase,
      };
    }
  }

  // 4. Asymmetry
  const kneeAsymZ = zScore(baseline, evalPhase, "kneeAsymmetry", metrics.kneeAsymmetry);
  const hipAsymZ = zScore(baseline, evalPhase, "hipAsymmetry", metrics.hipAsymmetry);
  const asymZ = Math.max(kneeAsymZ ?? -Infinity, hipAsymZ ?? -Infinity);
  if (asymZ > Z_THRESHOLD) {
    return {
      errorType: ERROR_TYPES.ASYMMETRIC,
      highlightJoints: ["left_knee", "right_knee", "left_hip", "right_hip"],
      z: asymZ,
      baseline: baseline[evalPhase].kneeAsymmetry.mean,
      current: metrics.kneeAsymmetry,
      phase: evalPhase,
    };
  }

  return null;
}

export function getCueText(errorType, language = "en") {
  const lang = CUES[language] ? language : "en";
  return CUES[lang][errorType] || CUES.en[errorType] || "";
}
