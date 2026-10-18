// Words for each detected mistake: a clinical name (provider views) and a plain cue + one line (patient views).
import { findExercise } from "./catalog.js";

export const CLINICAL = {
  ERR_KNEES_INSIDE: "Knee valgus", ERR_TORSO_TO_SIDE: "Lateral trunk lean", ERR_SHALLOW_SQUAT: "Insufficient squat depth",
  ERR_KNEES_FORWARD: "Excessive forward knee travel", ERR_LIFTED_HEELS: "Heel rise",
  ERR_ARM_FORWARD: "Forward arm drift", ERR_ELEVATED_SHOULDER: "Scapular elevation (shrug)", ERR_HEAD_TO_SIDE: "Lateral head tilt",
  ERR_LOW_ABDUCTION: "Limited abduction range", ERR_BENT_ARM: "Elbow not fully extended",
  ERR_TORSO_FORWARD: "Forward trunk lean", ERR_TORSO_ROTATION: "Trunk rotation", ERR_ARM_TO_SIDE: "Arm drifting into abduction",
  ERR_TRUNK_LEAN: "Lateral trunk lean", ERR_LOW_RAISE: "Limited elevation range", ERR_BENT_ELBOW: "Elbow not fully extended",
  ERR_NOT_ACROSS: "Limited horizontal adduction", ERR_LOW_ROTATION: "Limited rotation range", ERR_ELBOW_ANGLE: "Elbow angle off 90°",
  ERR_ELBOW_DROP: "Elbow dropping below shoulder", ERR_ELBOW_HIGH: "Elbow above shoulder", ERR_SMALL_CIRCLE: "Small circumduction arc",
  TOO_FAST: "Moving too fast",
};

export const PLAIN = {
  ERR_KNEES_INSIDE: ["Push your knees out", "Keep them in line with your toes."],
  ERR_KNEES_FORWARD: ["Sit back into your hips", "Keep your knees behind your toes."],
  ERR_LIFTED_HEELS: ["Keep your heels down", "Press through your whole foot."],
  ERR_SHALLOW_SQUAT: ["Go a little lower", "Aim for your thighs near level."],
  ERR_TORSO_TO_SIDE: ["Keep your body straight", "Don’t lean to one side."],
  ERR_TRUNK_LEAN: ["Keep your body straight", "Don’t lean as you lift."],
  ERR_ARM_FORWARD: ["Lift out to the side", "Keep your arm in line with your body."],
  ERR_BENT_ARM: ["Keep your elbow straight", "Reach long through your fingers."],
  ERR_BENT_ELBOW: ["Keep your elbow straight", "Reach long through your fingers."],
  ERR_ELEVATED_SHOULDER: ["Keep your shoulder down", "No shrugging as you move."],
  ERR_HEAD_TO_SIDE: ["Keep your head straight", "Eyes forward, chin level."],
  ERR_LOW_ABDUCTION: ["Lift a little higher", "Aim for shoulder height."],
  ERR_LOW_RAISE: ["Lift a little higher", "Reach up beside your ear."],
  ERR_ARM_TO_SIDE: ["Move straight back", "Keep your arm close to your side."],
  ERR_TORSO_FORWARD: ["Keep your chest up", "Stand tall as you move."],
  ERR_TORSO_ROTATION: ["Keep your chest facing forward", "Don’t twist as you move."],
  ERR_NOT_ACROSS: ["Reach further across", "Bring your hand toward your other side."],
  ERR_LOW_ROTATION: ["Rotate a little further", "Keep your elbow where it is."],
  ERR_ELBOW_ANGLE: ["Keep a right angle at your elbow", "Forearm straight forward to start."],
  ERR_ELBOW_DROP: ["Keep your elbow up", "Hold it at shoulder height."],
  ERR_ELBOW_HIGH: ["Lower your elbow a little", "Keep it at shoulder height."],
  ERR_SMALL_CIRCLE: ["Make bigger circles", "Reach up overhead each time."],
  TOO_FAST: ["Slow down", "Take about 3 seconds each way."],
};

export const clinicalName = (code, fallback) => CLINICAL[code] || fallback || String(code || "").replace(/^ERR_/, "").toLowerCase().replace(/_/g, " ");
export const plainCue = (code) => PLAIN[code]?.[0] || "Move slowly and with control";
export const plainLine = (code) => PLAIN[code]?.[1] || "Smooth reps, all the way through.";

export const exName = (ex) => findExercise(ex)?.item.name || ex;
export const exIcon = (ex) => findExercise(ex)?.item.icon || "";

/** "3 sets of 12 · go slow" */
export function dose(item) {
  if (!item) return "";
  const s = `${item.sets} set${item.sets === 1 ? "" : "s"} of ${item.reps}`;
  return item.tempo === "slow" ? `${s} · go slow` : s;
}
/** "3 × 10 · slow pace + cue “…”" for provider views */
export function doseShort(item) {
  if (!item) return "Not in plan";
  let s = `${item.sets} × ${item.reps}`;
  if (item.tempo === "slow") s += " · 3 s down, slow pace";
  if (item.cue) s += ` + cue “${item.cue}”`;
  return s;
}
