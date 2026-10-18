import oracledb from "oracledb";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pool;

export async function initDb() {
  const walletDir = path.resolve(__dirname, process.env.WALLET_DIR || "./Wallet_UVKZ5DGRW1JK04O0");
  process.env.TNS_ADMIN = walletDir;

  const connectString = process.env.DB_CONNECT_STRING || "uvkz5dgrw1jk04o0_high";
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  if (!user || !password) {
    throw new Error("Set DB_USER and DB_PASSWORD in branch/api/.env");
  }

  if (!process.env.WALLET_PASSWORD) {
    throw new Error(
      "Set WALLET_PASSWORD in branch/api/.env — this is the password you chose when downloading the wallet ZIP (not the ADMIN DB password)",
    );
  }

  // Thin mode + ADB wallet (no Oracle Instant Client required)
  pool = await oracledb.createPool({
    user,
    password,
    connectString,
    configDir: walletDir,
    walletLocation: walletDir,
    walletPassword: process.env.WALLET_PASSWORD,
    poolMin: 1,
    poolMax: 4,
    poolIncrement: 1,
    poolTimeout: 60,
    queueTimeout: 120000,
    connectTimeout: 60,
  });

  // Prove a real connection works (createPool alone can succeed without dialing)
  const probe = await pool.getConnection();
  await probe.execute(`SELECT 1 AS ok FROM dual`);
  await probe.close();
  console.log(`Oracle pool ready (${connectString})`);
}

export async function withConn(fn) {
  const conn = await pool.getConnection();
  try {
    return await fn(conn);
  } finally {
    await conn.close();
  }
}

export async function ensurePatient(patientId, displayName) {
  await withConn(async (conn) => {
    await conn.execute(
      `MERGE INTO patients t
       USING (SELECT :id AS patient_id, :name AS display_name FROM dual) s
       ON (t.patient_id = s.patient_id)
       WHEN NOT MATCHED THEN
         INSERT (patient_id, display_name) VALUES (s.patient_id, s.display_name)`,
      { id: patientId, name: displayName || "Demo Patient" },
      { autoCommit: true },
    );
  });
}

export async function createSession({ sessionId, patientId, exercise }) {
  await withConn(async (conn) => {
    await conn.execute(
      `INSERT INTO sessions (session_id, patient_id, exercise)
       VALUES (:sessionId, :patientId, :exercise)`,
      { sessionId, patientId, exercise },
      { autoCommit: true },
    );
  });
}

export async function endSession(sessionId) {
  await withConn(async (conn) => {
    await conn.execute(
      `UPDATE sessions SET ended_at = SYSTIMESTAMP WHERE session_id = :sessionId`,
      { sessionId },
      { autoCommit: true },
    );
  });
}

export async function insertRep(row) {
  await withConn(async (conn) => {
    await conn.execute(
      `INSERT INTO reps (
         rep_id, session_id, rep_number, counted, verdict, mistake, cue
       ) VALUES (
         :repId, :sessionId, :repNumber, :counted, :verdict, :mistake, :cue
       )`,
      {
        repId: row.repId,
        sessionId: row.sessionId,
        repNumber: row.repNumber,
        counted: row.counted ? "Y" : "N",
        verdict: row.verdict || null,
        mistake: row.mistake || null,
        cue: row.cue || null,
      },
      { autoCommit: true },
    );
  });
}

export async function bumpProgress({ patientId, goalId, sessionId, exercise, metric, metricValue, note }) {
  await withConn(async (conn) => {
    const progressId = `pr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await conn.execute(
      `INSERT INTO progress (
         progress_id, patient_id, goal_id, session_id, exercise, metric, metric_value, note
       ) VALUES (
         :progressId, :patientId, :goalId, :sessionId, :exercise, :metric, :metricValue, :note
       )`,
      {
        progressId,
        patientId,
        goalId: goalId || null,
        sessionId: sessionId || null,
        exercise: exercise || null,
        metric,
        metricValue,
        note: note || null,
      },
      { autoCommit: true },
    );
    if (goalId) {
      await conn.execute(
        `UPDATE goals
         SET current_value = current_value + :inc,
             status = CASE
               WHEN current_value + :inc >= target_value THEN 'completed'
               ELSE status
             END
         WHERE goal_id = :goalId AND status = 'active'`,
        { inc: metricValue, goalId },
        { autoCommit: true },
      );
    }
  });
}

export async function closeDb() {
  if (pool) await pool.close(0);
}
