import "dotenv/config";
import cors from "cors";
import express from "express";
import { v4 as uuidv4 } from "uuid";
import {
  initDb,
  closeDb,
  ensurePatient,
  createSession,
  endSession,
  insertRep,
  bumpProgress,
} from "./db.js";
import { initStorage, putJson, storageEnabled } from "./storage.js";

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    db: true,
    objectStorage: storageEnabled(),
    bucket: process.env.OCI_BUCKET || "pt-app",
  });
});

// Start a workout session
app.post("/api/sessions", async (req, res) => {
  try {
    const patientId = req.body.patientId || process.env.DEFAULT_PATIENT_ID || "p1";
    const patientName = req.body.patientName || process.env.DEFAULT_PATIENT_NAME || "Demo Patient";
    const exercise = req.body.exercise;
    if (!exercise) return res.status(400).json({ error: "exercise required" });

    const sessionId = req.body.sessionId || uuidv4();
    await ensurePatient(patientId, patientName);
    await createSession({ sessionId, patientId, exercise });

    res.status(201).json({ sessionId, patientId, exercise });
  } catch (e) {
    console.error("POST /api/sessions", e);
    res.status(500).json({ error: e.message });
  }
});

// End a session
app.post("/api/sessions/:sessionId/end", async (req, res) => {
  try {
    await endSession(req.params.sessionId);
    res.json({ ok: true, sessionId: req.params.sessionId });
  } catch (e) {
    console.error("POST /api/sessions/:id/end", e);
    res.status(500).json({ error: e.message });
  }
});

// Log a rep (+ optional keypoints / features JSON to Object Storage)
app.post("/api/reps", async (req, res) => {
  try {
    const {
      sessionId,
      patientId,
      exercise,
      repNumber,
      counted = true,
      verdict,
      mistake,
      cue,
      features,
      keypoints,
      goalId,
    } = req.body;

    if (!sessionId || repNumber == null) {
      return res.status(400).json({ error: "sessionId and repNumber required" });
    }

    const repId = req.body.repId || uuidv4();
    await insertRep({
      repId,
      sessionId,
      repNumber,
      counted: !!counted,
      verdict,
      mistake,
      cue,
    });

    let upload = { skipped: true, reason: "no_payload" };
    if (features || keypoints) {
      const objectName = `sessions/${sessionId}/rep-${repNumber}-${repId}.json`;
      upload = await putJson(objectName, {
        repId,
        sessionId,
        patientId: patientId || process.env.DEFAULT_PATIENT_ID || "p1",
        exercise,
        repNumber,
        counted: !!counted,
        verdict,
        mistake,
        cue,
        features: features || null,
        keypoints: keypoints || null,
        savedAt: new Date().toISOString(),
      });
    }

    if (counted && verdict === "CORRECT" && (patientId || process.env.DEFAULT_PATIENT_ID)) {
      await bumpProgress({
        patientId: patientId || process.env.DEFAULT_PATIENT_ID || "p1",
        goalId: goalId || null,
        sessionId,
        exercise,
        metric: "good_reps",
        metricValue: 1,
        note: cue || verdict,
      });
    }

    res.status(201).json({ repId, upload });
  } catch (e) {
    console.error("POST /api/reps", e);
    res.status(500).json({ error: e.message });
  }
});

async function main() {
  await initDb();
  initStorage();
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Form Check API http://127.0.0.1:${PORT}`);
  });
}

main().catch((e) => {
  console.error("Failed to start API:", e.message);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await closeDb();
  process.exit(0);
});
