import styles from "@/styles/session.module.css";

export default function CorrectionCue({ text, errorType, visible, language = "en" }) {
  if (!visible || !text) return null;

  const label = language === "es" ? "Revisión de forma" : "Form check";

  return (
    <div
      className={styles.cueBanner}
      role="status"
      aria-live="assertive"
      data-error={errorType || ""}
    >
      <span className={styles.cueLabel}>{label}</span>
      <p className={styles.cueText}>{text}</p>
    </div>
  );
}
