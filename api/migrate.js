/**
 * Apply api/schema/*.sql against Autonomous DB.
 * Ignores "already exists" errors so the script is re-runnable.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDb, withConn, closeDb } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.join(__dirname, "schema");

/** Oracle errors that mean the object/column/constraint is already there. */
const IGNORE = new Set([
  955, // name is already used by an existing object
  1430, // column being added already exists in table
  2260, // table can have only one primary key
  2261, // such unique or primary key already exists in the table
  2275, // such a referential constraint already exists in the table
  1442, // column to be modified to NOT NULL is already NOT NULL
]);

function splitStatements(sql) {
  return sql
    .split(/;\s*\r?\n/)
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !/^\s*--/.test(line))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

async function runFile(conn, filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const statements = splitStatements(text);
  console.log(`\n== ${path.basename(filePath)} (${statements.length} statements) ==`);
  for (const sql of statements) {
    const preview = sql.replace(/\s+/g, " ").slice(0, 90);
    try {
      await conn.execute(sql);
      console.log(`  OK  ${preview}`);
    } catch (e) {
      const code = e.errorNum ?? e.code;
      if (IGNORE.has(Number(code))) {
        console.log(`  skip (${code}) ${preview}`);
      } else {
        console.error(`  FAIL ${preview}`);
        throw e;
      }
    }
  }
  await conn.commit();
}

async function main() {
  const files = fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (!files.length) {
    console.log("No .sql files in schema/");
    return;
  }
  await initDb();
  await withConn(async (conn) => {
    for (const f of files) {
      await runFile(conn, path.join(SCHEMA_DIR, f));
    }
  });
  console.log("\nMigration complete.");
}

main()
  .catch((e) => {
    console.error("Migration failed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
