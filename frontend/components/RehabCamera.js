import { useEffect, useRef, useState } from "react";
import { createPose, startCamera } from "@/lib/poseDetection";
import { speakNow } from "@/lib/voice";
import { Calibrator, classify, decide, makeSegmenter, repFeatures } from "@/lib/rehab/features";
import { RULES, SetupGate, framing, validateRep } from "@/lib/rehab/session";
import {
  EXERCISE_TITLES,
  HIGHLIGHT,
  HOWTO,
  cueText,
  shortText,
  tempoCue,
  translateMessage,
} from "@/lib/rehab/cues";
import { drawSkeleton } from "@/components/SkeletonOverlay";
import CorrectionCue from "@/components/CorrectionCue";
import RepScoreCard from "@/components/RepScoreCard";
import styles from "@/styles/session.module.css";

const OUT_OF_FRAME_PAUSE = 15; // frames (~0.5 s) before pausing back to setup
const HIGHLIGHT_MS = 2500;

/**
 * REHAB26 live coaching: webcam → MediaPipe Pose (world landmarks) → setup gate → rep detection →
 * rep validation → per-rep mistake classifier (early model for reps 1-3, then calibrated to this user).
 * Pipeline mirrors the v_REHAB24-6 Form Check app; models come from training/train_rehab26.py.
 */
export default function RehabCamera({ exercise = "squat", language = "en", patientId = "demo-patient" }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const poseRef = useRef(null);
  const cameraRef = useRef(null);
  const languageRef = useRef(language);
  const patientIdRef = useRef(patientId);
  const modelRef = useRef(null);
  const pipeRef = useRef(null); // { seg, cal, gate, phase, outFrames, facing, calAmps, repCount }
  const repsRef = useRef([]);
  const highlightRef = useRef({ joints: [], until: 0 });
  const lastSetupRef = useRef({ title: "", at: 0 });

  const [mode, setMode] = useState("loading"); // loading | setup | active | done | error
  const [model, setModel] = useState(null);
  const [setup, setSetup] = useState(null);
  const [repCount, setRepCount] = useState(0);
  const [cue, setCue] = useState(null);
  const [lastScore, setLastScore] = useState(null);
  const [notCounted, setNotCounted] = useState(0);
  const [error, setError] = useState(null);

  languageRef.current = language;
  patientIdRef.current = patientId;
  const t = (en, es) => (language === "es" ? es : en);

  const say = (text) => speakNow(text, languageRef.current);

  const stopSession = () => {
    cameraRef.current?.stop();
    cameraRef.current = null;
    try {
      poseRef.current?.close?.();
    } catch {
      /* ignore */
    }
    poseRef.current = null;
    setMode("done");
    setSetup(null);
  };

  const onMovementRef = useRef(null);
  onMovementRef.current = (frames) => {
    const m = modelRef.current;
    const p = pipeRef.current;
    const lang = languageRef.current;
    const v = validateRep(frames, p.seg, RULES[m.exercise]);
    if (!v.ok) {
      setNotCounted((n) => n + 1);
      const reason = translateMessage(v.reason, lang);
      setCue({ text: `${lang === "es" ? "No contó" : "Not counted"}: ${reason}`, errorType: null, tone: "bad" });
      say(`${lang === "es" ? "No contó." : "Not counted."} ${reason}`);
      return;
    }

    p.repCount += 1;
    const n = p.repCount;
    setRepCount(n);

    // Early model until we know this user's normal, then the calibrated model.
    const x = repFeatures(frames, m.feature_set);
    const stage = p.cal.ready ? "calibrated" : "early";
    const out =
      stage === "calibrated"
        ? decide(m, classify(m, frames, p.cal.center(), x))
        : decide(m.early, classify(m.early, frames));
    // Learn from valid reps; a rep much smaller than the others isn't used.
    if (m.segmenter.mode === "tempo" || v.amp == null || !p.calAmps.length || v.amp >= 0.6 * Math.max(...p.calAmps)) {
      p.cal.add(x);
      p.calAmps.push(v.amp ?? 1);
      if (p.calAmps.length > m.calibration.window) p.calAmps.shift();
    }

    const good = out.label === "CORRECT";
    const score = {
      quality: good ? "correct" : "incorrect",
      error_type: good ? null : out.label,
      confidence: out.prob,
      source: `rehab26_${stage}`,
      repNumber: n,
    };
    setLastScore(score);
    repsRef.current.push({
      rep: n,
      label: out.label,
      model: stage,
      duration_s: Number(((frames[frames.length - 1].t - frames[0].t) / 1000).toFixed(2)),
      probs: Object.fromEntries(Object.entries(out.probs).map(([k, val]) => [k, Number(val.toFixed(3))])),
      score: { quality: score.quality, error_type: score.error_type, confidence: score.confidence, source: score.source },
    });

    highlightRef.current = { joints: good ? [] : HIGHLIGHT[out.label] || [], until: performance.now() + HIGHLIGHT_MS };
    if (good) {
      setCue({ text: t("Good rep. Keep it up.", "Buena repetición. Sigue así."), errorType: null, tone: "good" });
      say(`${n}. ${lang === "es" ? "Bien." : "Good."}`);
    } else {
      setCue({ text: cueText(m, out.label, lang), errorType: out.label, tone: "bad" });
      // tempo mode: keep it short so it ends before the next "Back"
      const how = m.segmenter.mode === "tempo" ? "" : ` ${cueText(m, out.label, lang)}`;
      say(`${n}. ${shortText(m, out.label, lang)}.${how}`);
    }
  };

  const onResultsRef = useRef(null);
  onResultsRef.current = (results) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const m = modelRef.current;
    const p = pipeRef.current;
    if (!video || !canvas || !m || !p || p.phase === "done") return;

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");

    const lm = results.poseLandmarks;
    const world = results.poseWorldLandmarks;
    if (!lm || !world || world.length < 33) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    const hl = highlightRef.current;
    drawSkeleton(ctx, lm, w, h, performance.now() < hl.until ? hl.joints : []);

    const now = performance.now();
    const P = world.map((l) => [l.x, l.y, l.z]);
    P.img = lm.map((l) => [l.x, l.y, l.visibility ?? 1]);
    P.t = now;
    P.ok = framing(P.img).ok;

    // How far the hips are turned from the camera (median of the last second)
    const hx = P[23][0] - P[24][0];
    const hz = P[23][2] - P[24][2];
    p.facingHist.push((Math.atan2(Math.abs(hz), Math.abs(hx)) * 180) / Math.PI);
    if (p.facingHist.length > 30) p.facingHist.shift();
    const facing = [...p.facingHist].sort((a, b) => a - b)[p.facingHist.length >> 1];
    const lang = languageRef.current;

    if (p.phase === "setup") {
      const g = p.gate.push(P, facing);
      const title = translateMessage(g.title, lang);
      const sub = translateMessage(g.sub, lang);
      setSetup({ title, sub, progress: g.progress || 0 });
      const last = lastSetupRef.current;
      if (g.title !== last.title && now - last.at > 2500) {
        say(g.title === "Hold still" ? title : `${title}. ${sub}`);
        lastSetupRef.current = { title: g.title, at: now };
      }
      if (g.ready) {
        p.phase = "active";
        p.outFrames = 0;
        p.seg.reset();
        lastSetupRef.current = { title: "", at: 0 };
        setSetup(null);
        setMode("active");
        setCue({ text: lang === "es" ? "¡Ya!" : "Go!", errorType: null, tone: "good" });
        say(lang === "es" ? "Ya" : "Go");
      }
      return;
    }

    // active: pause if the body leaves the frame for ~half a second
    p.outFrames = P.ok ? 0 : p.outFrames + 1;
    if (p.outFrames > OUT_OF_FRAME_PAUSE) {
      p.phase = "setup";
      p.seg.reset();
      p.gate.reset();
      setMode("setup");
      setSetup({
        title: lang === "es" ? "En pausa" : "Paused",
        sub: lang === "es" ? "Aléjate para que todo tu cuerpo esté en el cuadro." : "Step back so your whole body is in the frame.",
        progress: 0,
      });
      say(lang === "es" ? "En pausa. Vuelve al cuadro." : "Paused. Step back into the frame.");
      return;
    }

    const rep = p.seg.push(P, now);
    if (m.segmenter.mode === "tempo" && p.seg.takeCue()) {
      say(tempoCue(m, lang));
      setCue({ text: tempoCue(m, lang), errorType: null, tone: "good" });
    }
    if (rep) onMovementRef.current?.(rep);
  };

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setStatus("model");
        const res = await fetch(`/models/rehab26_${exercise}.json`);
        if (!res.ok) throw new Error(`Could not load ${exercise} model (${res.status})`);
        const m = await res.json();
        if (cancelled) return;
        modelRef.current = m;
        setModel(m);
        pipeRef.current = {
          seg: makeSegmenter(m.segmenter),
          cal: new Calibrator(m.calibration),
          gate: new SetupGate(RULES[exercise]),
          phase: "setup",
          outFrames: 0,
          facingHist: [],
          calAmps: [],
          repCount: 0,
        };
        repsRef.current = [];

        setStatus("camera");
        if (!videoRef.current) await new Promise((r) => requestAnimationFrame(r));
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
        setMode("setup");
      } catch (err) {
        console.error(err);
        if (cancelled) return;
        const msg = String(err?.message || err || "Camera / pose init failed");
        setError(
          msg.includes("arguments") || msg.includes("Aborted")
            ? "Pose model crashed — hard refresh the page (Ctrl+Shift+R)"
            : msg
        );
        setMode("error");
      }
    }

    function setStatus(stage) {
      setSetup({ title: stage === "model" ? "Loading model…" : "Starting camera…", sub: "", progress: 0 });
    }

    init();
    return () => {
      cancelled = true;
      if (pipeRef.current) pipeRef.current.phase = "done";
      cameraRef.current?.stop();
      cameraRef.current = null;
      try {
        poseRef.current?.close?.();
      } catch {
        /* ignore */
      }
      poseRef.current = null;
    };
  }, [exercise]);

  useEffect(() => {
    window.__ptGetSessionPayload = () => ({
      patient_id: patientIdRef.current,
      timestamp: new Date().toISOString(),
      exercise,
      coach: "rehab26",
      model: modelRef.current
        ? { feature_version: modelRef.current.feature_version, source: modelRef.current.source }
        : null,
      reps: repsRef.current,
    });
    window.__ptStopSession = () => {
      if (pipeRef.current) pipeRef.current.phase = "done";
      stopSession();
    };
    window.__ptSessionMode = mode;
  }, [mode, exercise]);

  const title = EXERCISE_TITLES[language]?.[exercise] || EXERCISE_TITLES.en[exercise];
  const metrics = model?.metrics;

  return (
    <div className={styles.cameraWrap}>
      <div className={styles.videoStage}>
        <video ref={videoRef} className={styles.video} playsInline muted aria-label="Webcam exercise feed" />
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />

        <div className={styles.overlayTop}>
          <span className={styles.badge}>{modeLabel(mode, language)}</span>
          {model?.segmenter?.mode === "tempo" && mode === "active" && (
            <span className={styles.badgeMuted}>{t("Guided pace", "Ritmo guiado")}</span>
          )}
        </div>

        {setup && mode !== "done" && mode !== "error" && (
          <div className={styles.setupOverlay} role="status" aria-live="polite">
            <p className={styles.setupTitle}>{setup.title}</p>
            {setup.sub && <p className={styles.setupSub}>{setup.sub}</p>}
            <div className={styles.setupBar}>
              <span style={{ width: `${Math.round(setup.progress * 100)}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className={styles.belowCamera} aria-live="polite">
        <h2 className={styles.exerciseHero}>{title}</h2>
        <p className={styles.howto}>{HOWTO[language]?.[exercise] || HOWTO.en[exercise]}</p>

        <CorrectionCue
          text={cue?.text}
          errorType={cue?.errorType}
          language={language}
          tone={cue?.tone === "good" ? "good" : "bad"}
          visible={!!cue?.text && (mode === "active" || mode === "done")}
        />

        {lastScore && (
          <div className={styles.scoreDockOutside}>
            <RepScoreCard score={lastScore} repNumber={lastScore.repNumber} language={language} />
          </div>
        )}
      </div>

      <div className={styles.statsRow} aria-live="polite">
        <Stat label={t("Reps", "Repeticiones")} value={repCount} />
        {notCounted > 0 && <Stat label={t("Not counted", "No contadas")} value={notCounted} />}
        <Stat
          label={t("Model", "Modelo")}
          value={pipeRef.current?.cal?.ready ? t("Calibrated", "Calibrado") : t("Early", "Inicial")}
        />
        <p className={styles.statusMsg}>
          {error ||
            (metrics &&
              t(
                `REHAB26 model (${metrics.people} people, physio-labeled). On unseen people it catches ${Math.round(metrics.mistakes_caught * 100)}% of mistakes and names ${Math.round(metrics.mistakes_named_right * 100)}% correctly. It adapts to you after ${model.calibration.reps} reps.`,
                `Modelo REHAB26 (${metrics.people} personas, etiquetado por fisioterapeutas). En personas nuevas detecta ${Math.round(metrics.mistakes_caught * 100)}% de los errores y nombra bien ${Math.round(metrics.mistakes_named_right * 100)}%. Se adapta a ti después de ${model.calibration.reps} repeticiones.`
              ))}
        </p>
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
  const en = { loading: "Loading", setup: "Setting up", active: "Live coaching", done: "Done", error: "Error" };
  const es = { loading: "Cargando", setup: "Preparando", active: "Entrenamiento", done: "Listo", error: "Error" };
  return (language === "es" ? es : en)[mode] || mode;
}
