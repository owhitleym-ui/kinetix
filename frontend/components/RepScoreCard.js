import { LABELS, labelName } from "@/lib/rehab/cues";
import styles from "@/styles/session.module.css";

export default function RepScoreCard({ score, repNumber, language = "en" }) {
  if (!score) return null;

  const ok = score.quality === "correct";

  return (
    <div
      className={`${styles.scoreCard} ${ok ? styles.scoreGood : styles.scoreBad}`}
      role="status"
      aria-label={`Rep ${repNumber} quality: ${score.quality}`}
    >
      <div className={styles.scoreHeader}>
        <span>Rep {repNumber}</span>
        <span className={styles.scoreSource}>{sourceLabel(score.source)}</span>
      </div>
      <div className={styles.scoreQuality}>{ok ? "Correct" : "Needs work"}</div>
      {!ok && score.error_type && (
        <div className={styles.scoreError}>{formatError(score.error_type, language)}</div>
      )}
      <div className={styles.scoreConf}>
        Confidence {(score.confidence * 100).toFixed(0)}%
      </div>
    </div>
  );
}

function sourceLabel(source) {
  const map = {
    rehab26_early: "REHAB26 model",
    rehab26_calibrated: "REHAB26 · calibrated",
    joint_intervals: "interval rules",
    ec3d_mistake: "EC3D model",
    ec3d_quality: "EC3D quality",
    oci_model_deployment: "OCI model",
    local_model: "local model",
    local: "on device",
    heuristic: "on device",
  };
  return map[source] || source || "model";
}

function formatError(t, language = "en") {
  if (LABELS.en[t]) return labelName(t, language);
  const map = {
    knee_cave: "Knees inward",
    back_round: "Torso lean",
    shallow: "Not low enough",
    asymmetric: "Asymmetry",
    feet_too_wide: "Feet too wide",
    knees_inward: "Knees inward",
    not_low_enough: "Not low enough",
    front_bent: "Front bent",
    knee_passes_toe: "Knee past toe",
    arched_back: "Arched back",
    hunch_back: "Hunched back",
    leg_too_high: "Leg too high",
    leg_too_low: "Leg too low",
    leg_not_extended: "Leg not extended",
    support_knee_too_closed: "Support knee closed",
    support_knee_too_open: "Support knee open",
    arm_too_low: "Arm too low",
    arm_too_high: "Arm too high",
    lumbar_hyperextension: "Lumbar hyperextension",
    lumbar_rounding: "Lumbar rounding",
    trunk_rotation: "Trunk rotation",
    lateral_hip_shift: "Lateral hip shift",
    head_lifting: "Head lifting",
    head_dropped: "Head dropped",
    hip_sag: "Hip sag",
    hip_pike: "Hip pike",
    knees_too_closed: "Knees too closed",
    knees_too_open: "Knees too open",
    shoulder_collapse: "Shoulder collapse",
    elbow_too_far: "Elbow too far",
    pelvic_rotation: "Pelvic rotation",
    head_tilt: "Head tilt",
  };
  return map[t] || t;
}
