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
        <span className={styles.scoreSource}>
          {score.source === "local" ? "on device" : "OCI model"}
        </span>
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

function formatError(t) {
  const map = {
    knee_cave: "Knee cave",
    back_round: "Back rounding",
    shallow: "Insufficient depth",
    asymmetric: "Asymmetry",
  };
  return map[t] || t;
}
