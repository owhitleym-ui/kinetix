/**
 * CLI: node scripts/smoke_tts.mjs "Your cue here"
 * Writes voice-feedback/out/cue.mp3
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Load voice-feedback/.env without requiring a root node_modules
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const text = process.argv.slice(2).join(" ") || "Good form. Keep going.";
const key = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_TTS_MODEL || "tts-1-hd";
const voice = process.env.OPENAI_TTS_VOICE || "coral";

if (!key) {
  console.error("Set OPENAI_API_KEY in voice-feedback/.env");
  process.exit(1);
}

const r = await fetch("https://api.openai.com/v1/audio/speech", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
});

if (!r.ok) {
  console.error(r.status, await r.text());
  process.exit(1);
}

const outDir = path.join(root, "out");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "cue.mp3");
fs.writeFileSync(outFile, Buffer.from(await r.arrayBuffer()));
console.log(`Wrote ${outFile}`);
console.log(`model=${model} voice=${voice}`);
console.log(`text: ${text}`);
