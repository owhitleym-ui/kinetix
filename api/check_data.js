import "dotenv/config";
import oracledb from "oracledb";
import { initDb, withConn, closeDb } from "./db.js";

await initDb();
await withConn(async (c) => {
  const s = await c.execute(
    `SELECT session_id, patient_id, exercise,
            TO_CHAR(started_at,'YYYY-MM-DD HH24:MI:SS') AS started,
            TO_CHAR(ended_at,'YYYY-MM-DD HH24:MI:SS') AS ended
     FROM sessions ORDER BY started_at DESC FETCH FIRST 10 ROWS ONLY`,
    [],
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  console.log("=== SESSIONS (latest 10) ===");
  console.table(s.rows);

  const r = await c.execute(
    `SELECT rep_id, session_id, rep_number, counted, verdict, mistake,
            TO_CHAR(created_at,'YYYY-MM-DD HH24:MI:SS') AS created
     FROM reps ORDER BY created_at DESC FETCH FIRST 20 ROWS ONLY`,
    [],
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  console.log("=== REPS (latest 20) ===");
  console.table(r.rows);
});
await closeDb();
