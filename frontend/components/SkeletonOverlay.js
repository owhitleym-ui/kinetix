/**
 * Draws MediaPipe pose skeleton on canvas over the video feed.
 * Offending joints highlight in red.
 */

import { LM } from "@/lib/jointAngles";

const CONNECTIONS = [
  // Head / neck
  [LM.NOSE, LM.LEFT_SHOULDER],
  [LM.NOSE, LM.RIGHT_SHOULDER],
  // Arms
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  // Torso
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  // Legs
  [LM.LEFT_HIP, LM.LEFT_KNEE],
  [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.LEFT_ANKLE, LM.LEFT_FOOT_INDEX],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE],
  [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  [LM.RIGHT_ANKLE, LM.RIGHT_FOOT_INDEX],
];

const JOINT_NAME_TO_INDEX = {
  nose: LM.NOSE,
  left_shoulder: LM.LEFT_SHOULDER,
  right_shoulder: LM.RIGHT_SHOULDER,
  left_elbow: LM.LEFT_ELBOW,
  right_elbow: LM.RIGHT_ELBOW,
  left_wrist: LM.LEFT_WRIST,
  right_wrist: LM.RIGHT_WRIST,
  left_hip: LM.LEFT_HIP,
  right_hip: LM.RIGHT_HIP,
  left_knee: LM.LEFT_KNEE,
  right_knee: LM.RIGHT_KNEE,
  left_ankle: LM.LEFT_ANKLE,
  right_ankle: LM.RIGHT_ANKLE,
  left_foot: LM.LEFT_FOOT_INDEX,
  right_foot: LM.RIGHT_FOOT_INDEX,
};

const MAJOR_JOINTS = new Set(Object.values(JOINT_NAME_TO_INDEX));

const GOOD = "#2dd4a8";
const BAD = "#ef4444";
const BONE = "rgba(255,255,255,0.75)";

export function drawSkeleton(ctx, landmarks, width, height, highlightJoints = []) {
  if (!ctx || !landmarks) return;

  ctx.clearRect(0, 0, width, height);

  const highlightSet = new Set(
    (highlightJoints || [])
      .map((name) => JOINT_NAME_TO_INDEX[name])
      .filter((i) => i != null)
  );

  // Bones
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const [a, b] of CONNECTIONS) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (!pa || !pb) continue;
    if ((pa.visibility ?? 1) < 0.5 || (pb.visibility ?? 1) < 0.5) continue;
    const bad = highlightSet.has(a) || highlightSet.has(b);
    ctx.strokeStyle = bad ? BAD : BONE;
    ctx.beginPath();
    ctx.moveTo(pa.x * width, pa.y * height);
    ctx.lineTo(pb.x * width, pb.y * height);
    ctx.stroke();
  }

  // Joints
  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    if (!p || (p.visibility ?? 1) < 0.5) continue;
    if (!MAJOR_JOINTS.has(i)) continue;
    const bad = highlightSet.has(i);
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, bad ? 10 : 7, 0, Math.PI * 2);
    ctx.fillStyle = bad ? BAD : GOOD;
    ctx.fill();
    if (bad) {
      ctx.strokeStyle = "rgba(239,68,68,0.4)";
      ctx.lineWidth = 6;
      ctx.stroke();
    }
  }
}

export default function SkeletonOverlay() {
  // Drawing is imperative via drawSkeleton from PoseCamera
  return null;
}
