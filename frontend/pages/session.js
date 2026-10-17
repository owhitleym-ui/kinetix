import { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import dynamic from "next/dynamic";
import { logSession } from "@/lib/ociClient";
import styles from "@/styles/session.module.css";

// MediaPipe + webcam must run client-only
const PoseCamera = dynamic(() => import("@/components/PoseCamera"), {
  ssr: false,
  loading: () => <p className={styles.statusMsg}>Loading camera…</p>,
});

export default function SessionPage() {
  const [language, setLanguage] = useState("en");
  const [saveMsg, setSaveMsg] = useState("");
  const [saving, setSaving] = useState(false);

  async function endSession() {
    setSaving(true);
    setSaveMsg("");
    try {
      const payload =
        typeof window !== "undefined" && window.__ptGetSessionPayload
          ? window.__ptGetSessionPayload()
          : null;
      if (!payload || !payload.reps?.length) {
        setSaveMsg(
          language === "es"
            ? "No hay repeticiones para guardar."
            : "No reps to save yet. Finish at least one coaching rep."
        );
        setSaving(false);
        return;
      }
      await logSession(payload);
      setSaveMsg(
        language === "es"
          ? "Sesión guardada en OCI Object Storage (solo keypoints)."
          : "Session saved to OCI Object Storage (keypoints only)."
      );
    } catch (err) {
      setSaveMsg(
        language === "es"
          ? `No se pudo guardar (¿backend activo?): ${err.message}`
          : `Could not save (is the backend running?): ${err.message}`
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Head>
        <title>Live session | PT Form Coach</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <main className={styles.page}>
        <header className={styles.topBar}>
          <Link href="/" className={styles.brand}>
            PT Form Coach
          </Link>
          <div className={styles.controls}>
            <div className={styles.langToggle} role="group" aria-label="Language">
              <button
                type="button"
                className={`${styles.langBtn} ${language === "en" ? styles.langBtnActive : ""}`}
                onClick={() => setLanguage("en")}
                aria-pressed={language === "en"}
              >
                EN
              </button>
              <button
                type="button"
                className={`${styles.langBtn} ${language === "es" ? styles.langBtnActive : ""}`}
                onClick={() => setLanguage("es")}
                aria-pressed={language === "es"}
              >
                ES
              </button>
            </div>
            <button
              type="button"
              className={styles.btn}
              onClick={endSession}
              disabled={saving}
            >
              {saving
                ? language === "es"
                  ? "Guardando…"
                  : "Saving…"
                : language === "es"
                  ? "Terminar sesión"
                  : "End and save session"}
            </button>
            <Link href="/dashboard" className={`${styles.btn} ${styles.btnGhost}`}>
              Dashboard
            </Link>
          </div>
        </header>

        <PoseCamera language={language} patientId="demo-patient" />

        {saveMsg && <p className={styles.privacyNote}>{saveMsg}</p>}
        <p className={styles.privacyNote}>
          {language === "es"
            ? "El video nunca sale de tu dispositivo. Solo se envían keypoints."
            : "Video never leaves your device. Only joint keypoints are sent upstream."}
        </p>
      </main>
    </>
  );
}
