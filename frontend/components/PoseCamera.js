import { useEffect, useRef, useState } from "react";
import { extractJointMetrics } from "@/lib/jointAngles";
import {
  accumulateFrame,
  createEmptyBaseline,
  finalizeBaseline,
  serializeBaseline,
} from "@/lib/baseline";
import {
  createPhaseTracker,
  evaluateCorrection,
  getCueText,
  updatePhaseTracker,
} from "@/lib/corrections";
import { createPose, startCamera } from "@/lib/poseDetection";
import { speakCue } from "@/lib/voice";
import { generateCue, scoreRep } from "@/lib/ociClient";
import {
  createExerciseClassifier,
  formatDetectedBadge,
  loadExerciseWeights,
  updateExerciseClassifier,
} from "@/lib/exerciseClassifier";
import { drawSkeleton } from "@/components/SkeletonOverlay";
import CorrectionCue from "@/components/CorrectionCue";
import RepScoreCard from "@/components/RepScoreCard";
import styles from "@/styles/session.module.css";

const CALIBRATION_REPS = 3;
const GENAI_THROTTLE_MS = 3000;

/**
 * Webcam + MediaPipe + calibration + live corrections.
 *
 * Modes: loading → calibrate → coaching → done
 */
export default function PoseCamera({ language = "en", patientId = "demo-patient" }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const poseRef = useRef(null);
  const cameraRef = useRef(null);
  const baselineRef = useRef(createEmptyBaseline());
  const trackerRef = useRef(createPhaseTracker());
  const modeRef = useRef("loading");
  const languageRef = useRef(language);
  const sessionFramesRef = useRef([]);
  const highlightRef = useRef([]);
  const lastGenAiKeyRef = useRef(null);
  const lastGenAiAtRef = useRef(0);
  const exerciseClassifierRef = useRef(createExerciseClassifier());
  const detectedExerciseRef = useRef("unknown");

  const [mode, setMode] = useState("loading"); // loading | calibrate | coaching | done | error
  const [statusMsg, setStatusMsg] = useState("Loading pose model…");
  const [calibReps, setCalibReps] = useState(0);
  const [repCount, setRepCount] = useState(0);
  const [phase, setPhase] = useState("standing");
  const [cue, setCue] = useState(null);
  const [lastScore, setLastScore] = useState(null);
  const [error, setError] = useState(null);
  const [detectedExercise, setDetectedExercise] = useState({
    label: "unknown",
    confidence: 0,
    displayName: "Waiting",
  });

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const patientIdRef = useRef(patientId);
  patientIdRef.current = patientId;

  const stopSession = () => {
    cameraRef.current?.stop();
    cameraRef.current = null;
    poseRef.current?.close?.();
    poseRef.current = null;
    setMode("done");
    setStatusMsg(
      languageRef.current === "es" ? "Sesión terminada" : "Session ended"
    );
    setCue(null);
    highlightRef.current = [];
  };

  const handleRepCompleteRef = useRef(null);
  handleRepCompleteRef.current = async (completed) => {
    if (modeRef.current === "calibrate") {
      const next = completed.repNumber;
      setCalibReps(next);
      if (next >= CALIBRATION_REPS) {
        finalizeBaseline(baselineRef.current);
        trackerRef.current = createPhaseTracker();
        setMode("coaching");
        setStatusMsg("Calibration complete. Continue squatting");
        setCue({
          text:
            languageRef.current === "es"
              ? "¡Listo! Sigue haciendo sentadillas"
              : "You're calibrated. Keep going",
          errorType: null,
        });
      } else {
        setStatusMsg(`Calibration: ${next}/${CALIBRATION_REPS} reps. Keep going`);
      }
      return;
    }

    if (modeRef.current === "coaching") {
      setRepCount(completed.repNumber);
      const exercise =
        detectedExerciseRef.current !== "unknown"
          ? detectedExerciseRef.current
          : "squat";
      const payload = {
        patient_id: patientIdRef.current,
        exercise,
        rep_number: completed.repNumber,
        frames: completed.frames.map((f) => ({
          phase: f.phase,
          joints: f.joints,
          errorType: f.errorType || null,
        })),
      };
      const score = await scoreRep(payload);
      setLastScore({ ...score, repNumber: completed.repNumber });
      sessionFramesRef.current.push({
        rep: completed.repNumber,
        frames: completed.frames,
        score,
      });

      // Speak EC3D model cue when rep scored incorrect
      if (score?.quality === "incorrect" && score.error_type) {
        const text = getCueText(score.error_type, languageRef.current);
        if (text) {
          setCue({ text, errorType: score.error_type });
          speakCue(text, languageRef.current);
        }
      }
    }
  };

  const requestGenAiCue = (correction) => {
    const key = `${correction.errorType}:${languageRef.current}`;
    const now = Date.now();
    if (
      key === lastGenAiKeyRef.current &&
      now - lastGenAiAtRef.current < GENAI_THROTTLE_MS
    ) {
      return;
    }
    lastGenAiKeyRef.current = key;
    lastGenAiAtRef.current = now;

    const errorType = correction.errorType;
    generateCue({
      errorType,
      baseline: correction.baseline ?? 0,
      current: correction.current ?? 0,
      language: languageRef.current,
    }).then((res) => {
      if (!res?.cue) return;
      if (modeRef.current !== "coaching") return;
      setCue((prev) => {
        if (prev?.errorType && prev.errorType !== errorType) return prev;
        return { text: res.cue, errorType, source: res.source };
      });
    });
  };

  const onResultsRef = useRef(null);
  onResultsRef.current = (results) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !results.poseLandmarks) return;
    if (modeRef.current === "done") return;

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const ctx = canvas.getContext("2d");
    const landmarks = results.poseLandmarks;
    const metrics = extractJointMetrics(landmarks);
    if (!metrics) {
      drawSkeleton(ctx, landmarks, w, h, []);
      return;
    }

    const detected = updateExerciseClassifier(
      exerciseClassifierRef.current,
      landmarks,
      metrics,
      languageRef.current
    );
    detectedExerciseRef.current = detected.label;
    setDetectedExercise(detected);

    const tracker = updatePhaseTracker(trackerRef.current, metrics);
    trackerRef.current = tracker;
    setPhase(tracker.phase);

    if (modeRef.current === "calibrate" && tracker.phase !== "standing") {
      accumulateFrame(baselineRef.current, tracker.phase, metrics);
    }

    // Squat coaching only when squat (or unknown during transition); lunge/plank cues later
    let correction = null;
    const canCoachSquat =
      detected.label === "squat" || detected.label === "unknown";
    if (
      modeRef.current === "coaching" &&
      tracker.phase !== "standing" &&
      canCoachSquat
    ) {
      correction = evaluateCorrection(baselineRef.current, tracker.phase, metrics);
      if (correction && tracker.framesInRep.length) {
        const last = tracker.framesInRep[tracker.framesInRep.length - 1];
        last.errorType = correction.errorType;
      }
    }

    highlightRef.current = correction?.highlightJoints || [];
    drawSkeleton(ctx, landmarks, w, h, highlightRef.current);

    if (correction) {
      const text = getCueText(correction.errorType, languageRef.current);
      setCue({ text, errorType: correction.errorType, source: "local" });
      speakCue(text, languageRef.current);
      requestGenAiCue(correction);
    }

    if (tracker.lastCompletedRep) {
      const completed = tracker.lastCompletedRep;
      tracker.lastCompletedRep = null;
      handleRepCompleteRef.current?.(completed);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setStatusMsg("Starting camera…");
        // Wait for video element to mount
        if (!videoRef.current) {
          await new Promise((r) => requestAnimationFrame(r));
        }
        await loadExerciseWeights();
        const pose = await createPose((results) => {
          if (!cancelled) onResultsRef.current?.(results);
        });
        if (cancelled) {
          try {
            pose.close?.();
          } catch {
            /* ignore */
          }
          return;
        }
        poseRef.current = pose;

        const cam = await startCamera(videoRef.current, pose);
        if (cancelled) {
          cam.stop();
          try {
            pose.close?.();
          } catch {
            /* ignore */
          }
          return;
        }
        cameraRef.current = cam;
        setMode("calibrate");
        setStatusMsg(`Calibration: do ${CALIBRATION_REPS} slow squats`);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          const msg = String(err?.message || err || "Camera / pose init failed");
          // Common after HMR / double-init — soft hint to hard-refresh
          if (msg.includes("arguments") || msg.includes("Aborted")) {
            setError("Pose model crashed — hard refresh the page (Ctrl+Shift+R)");
          } else {
            setError(msg);
          }
          setMode("error");
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      cameraRef.current?.stop();
      cameraRef.current = null;
      // Prefer stopping the camera loop before closing WASM
      try {
        poseRef.current?.close?.();
      } catch {
        /* ignore */
      }
      poseRef.current = null;
    };
  }, []);

  useEffect(() => {
    window.__ptGetSessionPayload = () => ({
      patient_id: patientIdRef.current,
      timestamp: new Date().toISOString(),
      exercise:
        detectedExerciseRef.current !== "unknown"
          ? detectedExerciseRef.current
          : "squat",
      baseline: serializeBaseline(baselineRef.current),
      reps: sessionFramesRef.current.map((r) => ({
        rep: r.rep,
        score: r.score,
        frames: r.frames.map((f) => ({
          phase: f.phase,
          joints: f.joints,
        })),
      })),
    });
    window.__ptStopSession = stopSession;
    window.__ptSessionMode = mode;
  }, [mode]);

  return (
    <div className={styles.cameraWrap}>
      <div className={styles.videoStage}>
        <video
          ref={videoRef}
          className={styles.video}
          playsInline
          muted
          aria-label="Webcam exercise feed"
        />
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />

        <div className={styles.overlayTop}>
          <span className={styles.badge}>{modeLabel(mode, language)}</span>
          <span
            className={`${styles.badgeDetect} ${
              detectedExercise.label === "unknown" ? styles.badgeDetectIdle : ""
            }`}
            role="status"
            aria-live="polite"
            title={
              detectedExercise.confidence
                ? `${(detectedExercise.confidence * 100).toFixed(0)}% confidence`
                : undefined
            }
          >
            {formatDetectedBadge(detectedExercise.label, language)}
          </span>
          <span className={styles.badgeMuted}>{phase}</span>
        </div>

        <CorrectionCue
          text={cue?.text}
          errorType={cue?.errorType}
          language={language}
          visible={!!cue?.text && mode === "coaching"}
        />

        {lastScore && (
          <div className={styles.scoreDock}>
            <RepScoreCard score={lastScore} repNumber={lastScore.repNumber} />
          </div>
        )}
      </div>

      <div className={styles.statsRow} aria-live="polite">
        {mode === "calibrate" && (
          <Stat
            label={language === "es" ? "Calibración" : "Calibration"}
            value={`${calibReps}/${CALIBRATION_REPS}`}
          />
        )}
        {(mode === "calibrate" || mode === "coaching") && (
          <Stat
            label={language === "es" ? "Ejercicio" : "Exercise"}
            value={detectedExercise.displayName}
          />
        )}
        {mode === "coaching" && (
          <>
            <Stat
              label={language === "es" ? "Repeticiones" : "Reps"}
              value={repCount}
            />
            <Stat label="Phase" value={phase} />
          </>
        )}
        {mode === "done" && (
          <Stat
            label={language === "es" ? "Estado" : "Status"}
            value={language === "es" ? "Guardada" : "Saved"}
          />
        )}
        <p className={styles.statusMsg}>{error || statusMsg}</p>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

function modeLabel(mode, language) {
  const en = {
    loading: "Loading",
    calibrate: "Calibrating",
    coaching: "Live coaching",
    done: "Done",
    error: "Error",
  };
  const es = {
    loading: "Cargando",
    calibrate: "Calibrando",
    coaching: "Entrenamiento",
    done: "Listo",
    error: "Error",
  };
  return (language === "es" ? es : en)[mode] || mode;
}
