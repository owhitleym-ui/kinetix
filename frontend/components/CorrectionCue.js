import styles from "@/styles/session.module.css";

export default function CorrectionCue({ text, errorType, visible }) {
  if (!visible || !text) return null;

  return (
    <div
      className={styles.cueBanner}
      role="status"
      aria-live="assertive"
      data-error={errorType || ""}
    >
      <span className={styles.cueLabel}>Form check</span>
      <p className={styles.cueText}>{text}</p>
    </div>
  );
}
