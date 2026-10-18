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
    throw new Error("Set DB_USER and DB_PASSWORD in api/.env");
  }

  if (!process.env.WALLET_PASSWORD) {
    throw new Error(
      "Set WALLET_PASSWORD in api/.env — this is the password you chose when downloading the wallet ZIP (not the ADMIN DB password)",
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

function mapUser(row) {
  if (!row) return null;
  return {
    userId: row.USER_ID,
    email: row.EMAIL,
    displayName: row.DISPLAY_NAME,
    role: row.ROLE,
    patientId: row.PATIENT_ID || null,
    passwordHash: row.PASSWORD_HASH,
  };
}

export async function findUserByEmail(email) {
  return withConn(async (conn) => {
    const r = await conn.execute(
      `SELECT u.user_id, u.email, u.password_hash, u.display_name, u.role, p.patient_id
       FROM users u
       LEFT JOIN patients p ON p.user_id = u.user_id
       WHERE LOWER(u.email) = LOWER(:email)`,
      { email },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return mapUser(r.rows?.[0]);
  });
}

export async function findUserById(userId) {
  return withConn(async (conn) => {
    const r = await conn.execute(
      `SELECT u.user_id, u.email, u.password_hash, u.display_name, u.role, p.patient_id
       FROM users u
       LEFT JOIN patients p ON p.user_id = u.user_id
       WHERE u.user_id = :userId`,
      { userId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return mapUser(r.rows?.[0]);
  });
}

export async function createUser({ userId, email, passwordHash, displayName, role, patientId }) {
  await withConn(async (conn) => {
    await conn.execute(
      `INSERT INTO users (user_id, email, password_hash, display_name, role)
       VALUES (:userId, :email, :passwordHash, :displayName, :role)`,
      { userId, email, passwordHash, displayName, role },
    );
    if (role === "patient" && patientId) {
      await conn.execute(
        `INSERT INTO patients (patient_id, display_name, user_id)
         VALUES (:patientId, :displayName, :userId)`,
        { patientId, displayName, userId },
      );
    }
    await conn.commit();
  });
}

export async function listPts() {
  return withConn(async (conn) => {
    const r = await conn.execute(
      `SELECT user_id, display_name, email
       FROM users
       WHERE role = 'pt'
       ORDER BY LOWER(display_name)`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (r.rows || []).map((row) => ({
      userId: row.USER_ID,
      displayName: row.DISPLAY_NAME,
      email: row.EMAIL,
    }));
  });
}

export async function ensurePatient(patientId, displayName, userId = null) {
  await withConn(async (conn) => {
    await conn.execute(
      `MERGE INTO patients t
       USING (SELECT :id AS patient_id, :name AS display_name, :userId AS user_id FROM dual) s
       ON (t.patient_id = s.patient_id)
       WHEN NOT MATCHED THEN
         INSERT (patient_id, display_name, user_id) VALUES (s.patient_id, s.display_name, s.user_id)
       WHEN MATCHED THEN
         UPDATE SET t.display_name = s.display_name,
                    t.user_id = NVL(s.user_id, t.user_id)`,
      { id: patientId, name: displayName || "Demo Patient", userId },
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

export async function getSession(sessionId) {
  return withConn(async (conn) => {
    const r = await conn.execute(
      `SELECT s.session_id, s.patient_id, s.exercise,
              TO_CHAR(s.started_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS started_at,
              TO_CHAR(s.ended_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS ended_at,
              p.user_id AS patient_user_id
       FROM sessions s
       LEFT JOIN patients p ON p.patient_id = s.patient_id
       WHERE s.session_id = :sessionId`,
      { sessionId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = r.rows?.[0];
    if (!row) return null;
    return {
      sessionId: row.SESSION_ID,
      patientId: row.PATIENT_ID,
      exercise: row.EXERCISE,
      startedAt: row.STARTED_AT,
      endedAt: row.ENDED_AT,
      patientUserId: row.PATIENT_USER_ID || null,
    };
  });
}

export async function listSessionsForPatient(patientId) {
  return withConn(async (conn) => {
    const r = await conn.execute(
      `SELECT s.session_id, s.patient_id, s.exercise,
              TO_CHAR(s.started_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS started_at,
              TO_CHAR(s.ended_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS ended_at,
              (SELECT COUNT(*) FROM reps r WHERE r.session_id = s.session_id) AS rep_count
       FROM sessions s
       WHERE s.patient_id = :patientId
       ORDER BY s.started_at DESC`,
      { patientId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (r.rows || []).map(mapSessionRow);
  });
}

export async function listSessionsSharedWithPt(ptUserId) {
  return withConn(async (conn) => {
    const r = await conn.execute(
      `SELECT s.session_id, s.patient_id, s.exercise,
              TO_CHAR(s.started_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS started_at,
              TO_CHAR(s.ended_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS ended_at,
              (SELECT COUNT(*) FROM reps r WHERE r.session_id = s.session_id) AS rep_count,
              p.display_name AS patient_name,
              sh.share_id
       FROM session_shares sh
       JOIN sessions s ON s.session_id = sh.session_id
       LEFT JOIN patients p ON p.patient_id = s.patient_id
       WHERE sh.pt_user_id = :ptUserId AND sh.revoked_at IS NULL
       ORDER BY s.started_at DESC`,
      { ptUserId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (r.rows || []).map((row) => ({
      ...mapSessionRow(row),
      patientName: row.PATIENT_NAME || null,
      shareId: row.SHARE_ID,
    }));
  });
}

export async function listSharesForSession(sessionId) {
  return withConn(async (conn) => {
    const r = await conn.execute(
      `SELECT sh.share_id, sh.session_id, sh.pt_user_id, sh.patient_user_id,
              TO_CHAR(sh.granted_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS granted_at,
              TO_CHAR(sh.revoked_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS revoked_at,
              u.display_name AS pt_name, u.email AS pt_email
       FROM session_shares sh
       JOIN users u ON u.user_id = sh.pt_user_id
       WHERE sh.session_id = :sessionId AND sh.revoked_at IS NULL
       ORDER BY sh.granted_at DESC`,
      { sessionId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (r.rows || []).map((row) => ({
      shareId: row.SHARE_ID,
      sessionId: row.SESSION_ID,
      ptUserId: row.PT_USER_ID,
      patientUserId: row.PATIENT_USER_ID,
      grantedAt: row.GRANTED_AT,
      ptName: row.PT_NAME,
      ptEmail: row.PT_EMAIL,
    }));
  });
}

export async function grantSessionShare({ shareId, sessionId, patientUserId, ptUserId }) {
  await withConn(async (conn) => {
    // Upsert: re-grant clears revoked_at if a prior share row exists.
    await conn.execute(
      `MERGE INTO session_shares t
       USING (SELECT :sessionId AS session_id, :ptUserId AS pt_user_id FROM dual) s
       ON (t.session_id = s.session_id AND t.pt_user_id = s.pt_user_id)
       WHEN MATCHED THEN
         UPDATE SET t.revoked_at = NULL,
                    t.granted_at = SYSTIMESTAMP,
                    t.patient_user_id = :patientUserId
       WHEN NOT MATCHED THEN
         INSERT (share_id, session_id, patient_user_id, pt_user_id)
         VALUES (:shareId, :sessionId, :patientUserId, :ptUserId)`,
      { shareId, sessionId, patientUserId, ptUserId },
      { autoCommit: true },
    );
  });
}

export async function revokeSessionShare(sessionId, ptUserId) {
  return withConn(async (conn) => {
    const r = await conn.execute(
      `UPDATE session_shares
       SET revoked_at = SYSTIMESTAMP
       WHERE session_id = :sessionId
         AND pt_user_id = :ptUserId
         AND revoked_at IS NULL`,
      { sessionId, ptUserId },
      { autoCommit: true },
    );
    return r.rowsAffected || 0;
  });
}

function mapSessionRow(row) {
  return {
    sessionId: row.SESSION_ID,
    patientId: row.PATIENT_ID,
    exercise: row.EXERCISE,
    startedAt: row.STARTED_AT,
    endedAt: row.ENDED_AT,
    repCount: Number(row.REP_COUNT || 0),
  };
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
