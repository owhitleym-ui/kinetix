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
  findUserByEmail,
  createUser,
  findUserById,
  listPts,
  listSessionsForPatient,
  listSessionsSharedWithPt,
  listSharesForSession,
  getSession,
  grantSessionShare,
  revokeSessionShare,
} from "./db.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  publicUser,
  requireAuth,
  requireRole,
} from "./auth.js";
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

// ── Auth ──────────────────────────────────────────────────────────────

app.post("/api/auth/register", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const displayName = String(req.body.displayName || "").trim();
    const role = String(req.body.role || "").trim().toLowerCase();

    if (!email || !password || !displayName) {
      return res.status(400).json({ error: "email, password, and displayName required" });
    }
    if (!["patient", "pt"].includes(role)) {
      return res.status(400).json({ error: "role must be patient or pt" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "password must be at least 6 characters" });
    }

    const existing = await findUserByEmail(email);
    if (existing) return res.status(409).json({ error: "Email already registered" });

    const userId = `u_${uuidv4()}`;
    const patientId = role === "patient" ? `p_${uuidv4()}` : null;
    const passwordHash = await hashPassword(password);

    await createUser({ userId, email, passwordHash, displayName, role, patientId });
    const user = await findUserById(userId);
    const token = signToken(user);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (e) {
    console.error("POST /api/auth/register", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }

    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error("POST /api/auth/login", e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/pts", requireAuth, async (_req, res) => {
  try {
    const pts = await listPts();
    res.json({ pts });
  } catch (e) {
    console.error("GET /api/pts", e);
    res.status(500).json({ error: e.message });
  }
});

// ── Sessions (list / share) ───────────────────────────────────────────

app.get("/api/sessions", requireAuth, async (req, res) => {
  try {
    if (req.user.role === "patient") {
      if (!req.user.patientId) {
        return res.status(400).json({ error: "Patient profile missing" });
      }
      const sessions = await listSessionsForPatient(req.user.patientId);
      // Attach active shares per session for permissions UI
      const withShares = await Promise.all(
        sessions.map(async (s) => ({
          ...s,
          shares: await listSharesForSession(s.sessionId),
        })),
      );
      return res.json({ sessions: withShares });
    }
    if (req.user.role === "pt") {
      const sessions = await listSessionsSharedWithPt(req.user.userId);
      return res.json({ sessions });
    }
    res.status(403).json({ error: "Forbidden" });
  } catch (e) {
    console.error("GET /api/sessions", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sessions/:sessionId/share", requireAuth, requireRole("patient"), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const ptUserId = String(req.body.ptUserId || "").trim();
    if (!ptUserId) return res.status(400).json({ error: "ptUserId required" });

    const session = await getSession(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.patientUserId !== req.user.userId && session.patientId !== req.user.patientId) {
      return res.status(403).json({ error: "You do not own this session" });
    }

    const pt = await findUserById(ptUserId);
    if (!pt || pt.role !== "pt") {
      return res.status(400).json({ error: "ptUserId must be a physical therapist account" });
    }

    const shareId = `sh_${uuidv4()}`;
    await grantSessionShare({
      shareId,
      sessionId,
      patientUserId: req.user.userId,
      ptUserId,
    });
    const shares = await listSharesForSession(sessionId);
    res.status(201).json({ ok: true, sessionId, shares });
  } catch (e) {
    console.error("POST /api/sessions/:id/share", e);
    res.status(500).json({ error: e.message });
  }
});

app.delete(
  "/api/sessions/:sessionId/share/:ptUserId",
  requireAuth,
  requireRole("patient"),
  async (req, res) => {
    try {
      const { sessionId, ptUserId } = req.params;
      const session = await getSession(sessionId);
      if (!session) return res.status(404).json({ error: "Session not found" });
      if (session.patientUserId !== req.user.userId && session.patientId !== req.user.patientId) {
        return res.status(403).json({ error: "You do not own this session" });
      }

      const n = await revokeSessionShare(sessionId, ptUserId);
      if (!n) return res.status(404).json({ error: "Active share not found" });
      const shares = await listSharesForSession(sessionId);
      res.json({ ok: true, sessionId, shares });
    } catch (e) {
      console.error("DELETE /api/sessions/:id/share/:ptUserId", e);
      res.status(500).json({ error: e.message });
    }
  },
);

// ── Session write (patients only) ─────────────────────────────────────

app.post("/api/sessions", requireAuth, requireRole("patient"), async (req, res) => {
  try {
    const patientId = req.user.patientId;
    if (!patientId) return res.status(400).json({ error: "Patient profile missing" });

    const exercise = req.body.exercise;
    if (!exercise) return res.status(400).json({ error: "exercise required" });

    const sessionId = req.body.sessionId || uuidv4();
    await ensurePatient(patientId, req.user.displayName, req.user.userId);
    await createSession({ sessionId, patientId, exercise });

    res.status(201).json({ sessionId, patientId, exercise });
  } catch (e) {
    console.error("POST /api/sessions", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sessions/:sessionId/end", requireAuth, requireRole("patient"), async (req, res) => {
  try {
    const session = await getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.patientId !== req.user.patientId) {
      return res.status(403).json({ error: "You do not own this session" });
    }
    await endSession(req.params.sessionId);
    res.json({ ok: true, sessionId: req.params.sessionId });
  } catch (e) {
    console.error("POST /api/sessions/:id/end", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/reps", requireAuth, requireRole("patient"), async (req, res) => {
  try {
    const {
      sessionId,
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

    const session = await getSession(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.patientId !== req.user.patientId) {
      return res.status(403).json({ error: "You do not own this session" });
    }

    const patientId = req.user.patientId;
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
        patientId,
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

    if (counted && verdict === "CORRECT") {
      await bumpProgress({
        patientId,
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
    console.log(`Kinetix API http://127.0.0.1:${PORT}`);
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
