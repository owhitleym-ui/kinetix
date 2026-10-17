import styles from "@/styles/session.module.css";

export default function RepScoreCard({ score, repNumber }) {
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
        <div className={styles.scoreError}>{formatError(score.error_type)}</div>
      )}
      <div className={styles.scoreConf}>
        Confidence {(score.confidence * 100).toFixed(0)}%
      </div>
    </div>
  );
}

function sourceLabel(source) {
  const map = {
    ec3d_mistake: "EC3D model",
    ec3d_quality: "EC3D quality",
    oci_model_deployment: "OCI model",
    local_model: "local model",
    local: "on device",
    heuristic: "on device",
  };
  return map[source] || source || "model";
}

function formatError(t) {
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
  };
  return map[t] || t;
}
