import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import dynamic from "next/dynamic";
import { logSession } from "@/lib/ociClient";
import styles from "@/styles/session.module.css";

const LOCAL_SESSION_KEY = "pt-form-coach-last-session";

// REHAB26 per-rep models are the main coach; bird dog / side plank keeps the interval-rule coach.
const EXERCISES = [
  { id: "squat", en: "Squat", es: "Sentadilla" },
  { id: "arm_abduction", en: "Shoulder abduction", es: "Abducción de hombro" },
  { id: "shoulder_extension", en: "Shoulder extension", es: "Extensión de hombro" },
  { id: "core_holds", en: "Bird dog / side plank", es: "Bird dog / plancha lateral" },
];

// MediaPipe + webcam must run client-only
const PoseCamera = dynamic(() => import("@/components/PoseCamera"), {
  ssr: false,
  loading: () => <p className={styles.statusMsg}>Loading camera…</p>,
});
const RehabCamera = dynamic(() => import("@/components/RehabCamera"), {
  ssr: false,
  loading: () => <p className={styles.statusMsg}>Loading camera…</p>,
});

export default function SessionPage() {
  const router = useRouter();
  const [language, setLanguage] = useState("en");
  const queryEx = typeof router.query.ex === "string" ? router.query.ex : null;
  const exercise = EXERCISES.some((e) => e.id === queryEx) ? queryEx : "squat";

  function pickExercise(id) {
    if (id === exercise) return;
    setSaveMsg("");
    router.replace({ pathname: "/session", query: { ex: id } }, undefined, { shallow: true });
  }
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

      try {
        await logSession(payload);
        setSaveMsg(
          language === "es"
            ? "Sesión guardada (solo keypoints)."
            : "Session saved (keypoints only)."
        );
      } catch (err) {
        try {
          localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(payload));
          setSaveMsg(
            language === "es"
              ? `Backend no disponible — sesión guardada en este dispositivo. (${err.message})`
              : `Backend unavailable — session saved on this device. (${err.message})`
          );
        } catch {
          setSaveMsg(
            language === "es"
              ? `No se pudo guardar: ${err.message}`
              : `Could not save: ${err.message}`
          );
          setSaving(false);
          return;
        }
      }

      if (typeof window !== "undefined" && window.__ptStopSession) {
        window.__ptStopSession();
      }
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

        <div className={styles.exPicker} role="radiogroup" aria-label={language === "es" ? "Ejercicio" : "Exercise"}>
          {EXERCISES.map((e) => (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={exercise === e.id}
              className={`${styles.exBtn} ${exercise === e.id ? styles.exBtnActive : ""}`}
              onClick={() => pickExercise(e.id)}
            >
              {e[language] || e.en}
            </button>
          ))}
        </div>

        {exercise === "core_holds" ? (
          <PoseCamera key="core_holds" language={language} patientId="demo-patient" />
        ) : (
          <RehabCamera key={exercise} exercise={exercise} language={language} patientId="demo-patient" />
        )}

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
