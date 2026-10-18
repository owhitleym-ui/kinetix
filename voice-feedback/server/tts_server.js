/**
 * Tiny TTS proxy — browser sends text, we return OpenAI neural speech audio.
 * Uses gpt-4o-mini-tts + style instructions for energetic, human-like delivery.
 */
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const PORT = Number(process.env.TTS_PORT || 3002);
const MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const VOICE = process.env.OPENAI_TTS_VOICE || "nova";
const SPEED = Number(process.env.OPENAI_TTS_SPEED || "1.08");
const INSTRUCTIONS = process.env.OPENAI_TTS_INSTRUCTIONS || [
  "You are an upbeat female physical therapy coach speaking to someone mid-workout.",
  "Sound warm, encouraging, and human — not flat or robotic.",
  "Use natural energy and prosody: vary pitch and emphasis like a real person.",
  "For praise, sound genuinely happy and lively.",
  "For form tips, sound caring and clear, still energetic, never scolding.",
  "Speak at a confident conversational pace with light smile in the voice.",
].join(" ");

const origins = (process.env.CORS_ORIGINS || "http://127.0.0.1:8801,http://localhost:8801")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const vercelOrigin = /^https:\/\/([a-z0-9-]+\.)*vercel\.app$/i;

function allowOrigin(origin) {
  if (!origin || origins.includes(origin) || origins.includes("null")) return true;
  if (vercelOrigin.test(origin)) return true;
  return false;
}

app.use(cors({ origin: (o, cb) => cb(null, allowOrigin(o)) }));
app.use(express.json({ limit: "32kb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "voice-feedback-tts",
    model: MODEL,
    voice: VOICE,
    speed: SPEED,
    expressive: MODEL.includes("gpt-4o"),
    keyConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
});

app.post("/tts", async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(503).json({ error: "Set OPENAI_API_KEY in voice-feedback/.env" });
  }

  const text = String(req.body?.text || "").trim().slice(0, 400);
  if (!text) return res.status(400).json({ error: "text required" });

  const voice = String(req.body?.voice || VOICE);
  const model = String(req.body?.model || MODEL);
  const speed = Number(req.body?.speed || SPEED);
  const instructions = String(req.body?.instructions || INSTRUCTIONS);

  const body = {
    model,
    voice,
    input: text,
    response_format: "mp3",
    speed: Math.min(4, Math.max(0.25, speed || 1)),
  };
  // Style steering only works on gpt-4o-mini-tts (not tts-1 / tts-1-hd)
  if (model.includes("gpt-4o") && instructions) {
    body.instructions = instructions;
  }

  try {
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("OpenAI TTS error", r.status, errText);
      return res.status(r.status).json({ error: "openai_tts_failed", detail: errText.slice(0, 500) });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Voice Feedback TTS http://127.0.0.1:${PORT}`);
  console.log(`  model=${MODEL} voice=${VOICE} speed=${SPEED} key=${process.env.OPENAI_API_KEY ? "set" : "MISSING"}`);
});
