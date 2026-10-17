/**
 * Joint angle computation from MediaPipe Pose landmarks (33 points).
 * Spec: LEFT_HIP→LEFT_KNEE→LEFT_ANKLE, etc.
 */

export const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
};

export function getAngle(A, B, C) {
  if (!A || !B || !C) return null;
  const AB = { x: A.x - B.x, y: A.y - B.y };
  const CB = { x: C.x - B.x, y: C.y - B.y };
  const dot = AB.x * CB.x + AB.y * CB.y;
  const magAB = Math.sqrt(AB.x ** 2 + AB.y ** 2);
  const magCB = Math.sqrt(CB.x ** 2 + CB.y ** 2);
  if (magAB === 0 || magCB === 0) return null;
  const cos = Math.min(1, Math.max(-1, dot / (magAB * magCB)));
  return Math.acos(cos) * (180 / Math.PI);
}

function midpoint(a, b) {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 };
}

function visibilityOk(landmark, min = 0.5) {
  return landmark && (landmark.visibility ?? 1) >= min;
}

/**
 * Extract squat-relevant joint metrics from a landmarks array.
 */
export function extractJointMetrics(landmarks) {
  if (!landmarks || landmarks.length < 33) return null;

  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];
  const lk = landmarks[LM.LEFT_KNEE];
  const rk = landmarks[LM.RIGHT_KNEE];
  const la = landmarks[LM.LEFT_ANKLE];
  const ra = landmarks[LM.RIGHT_ANKLE];
  const lf = landmarks[LM.LEFT_FOOT_INDEX];
  const rf = landmarks[LM.RIGHT_FOOT_INDEX];

  const shoulderMid = midpoint(ls, rs);
  const hipMid = midpoint(lh, rh);

  // Back tilt: angle of shoulder→hip line from vertical (0 = upright)
  let backTilt = null;
  if (shoulderMid && hipMid) {
    const dx = hipMid.x - shoulderMid.x;
    const dy = hipMid.y - shoulderMid.y;
    // angle from vertical downward
    backTilt = Math.abs(Math.atan2(dx, dy) * (180 / Math.PI));
  }

  // Knee cave: positive = knee inside foot (cave), using x delta
  // Mirror-aware: for left side, cave means knee.x > foot.x (toward midline)
  // For a facing camera, midline is ~0.5. Knee cave = knee closer to center than foot.
  let leftKneeCave = null;
  let rightKneeCave = null;
  if (visibilityOk(lk) && visibilityOk(lf) && hipMid) {
    const midX = hipMid.x;
    const footDist = Math.abs(lf.x - midX);
    const kneeDist = Math.abs(lk.x - midX);
    leftKneeCave = footDist - kneeDist; // >0 means knee closer to center than foot
  }
  if (visibilityOk(rk) && visibilityOk(rf) && hipMid) {
    const midX = hipMid.x;
    const footDist = Math.abs(rf.x - midX);
    const kneeDist = Math.abs(rk.x - midX);
    rightKneeCave = footDist - kneeDist;
  }

  const leftKnee = getAngle(lh, lk, la);
  const rightKnee = getAngle(rh, rk, ra);
  const leftHip = getAngle(ls, lh, lk);
  const rightHip = getAngle(rs, rh, rk);

  const shoulderDelta =
    visibilityOk(ls) && visibilityOk(rs) ? Math.abs(ls.y - rs.y) * 100 : null;

  return {
    leftKnee,
    rightKnee,
    leftHip,
    rightHip,
    backTilt,
    leftKneeCave,
    rightKneeCave,
    shoulderDelta,
    hipY: hipMid ? hipMid.y : null,
    kneeAsymmetry:
      leftKnee != null && rightKnee != null ? Math.abs(leftKnee - rightKnee) : null,
    hipAsymmetry:
      leftHip != null && rightHip != null ? Math.abs(leftHip - rightHip) : null,
  };
}

export const METRIC_KEYS = [
  "leftKnee",
  "rightKnee",
  "leftHip",
  "rightHip",
  "backTilt",
  "leftKneeCave",
  "rightKneeCave",
  "kneeAsymmetry",
  "hipAsymmetry",
];
