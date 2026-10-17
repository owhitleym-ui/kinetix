import styles from "@/styles/session.module.css";

export default function CorrectionCue({
  text,
  errorType,
  visible,
  language = "en",
  tone = "bad",
}) {
  if (!visible || !text) return null;

  const good = tone === "good";
  const label = good
    ? language === "es"
      ? "Forma correcta"
      : "Form check"
    : language === "es"
      ? "Revisión de forma"
      : "Form check";

  return (
    <div
      className={`${styles.cueBanner} ${good ? styles.cueBannerGood : styles.cueBannerBad}`}
      role="status"
      aria-live="assertive"
      data-error={errorType || ""}
      data-tone={tone}
    >
      <span className={styles.cueLabel}>{label}</span>
      <p className={styles.cueText}>{text}</p>
    </div>
  );
}
