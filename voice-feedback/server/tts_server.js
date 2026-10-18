/**
 * Tiny TTS proxy — browser sends text, we return OpenAI neural speech audio.
 * Uses gpt-4o-mini-tts + style instructions for energetic, human-like delivery.
 */
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

/** Node <18 on OCI may lack global fetch — use https for OpenAI. */
function openaiSpeech(payload, apiKey) {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/audio/speech",
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode || 500, buf });
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const PORT = Number(process.env.TTS_PORT || 3002);
const MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const VOICE = process.env.OPENAI_TTS_VOICE || "nova";
const SPEED = Number(process.env.OPENAI_TTS_SPEED || "0.92");
const INSTRUCTIONS = process.env.OPENAI_TTS_INSTRUCTIONS || [
  "You are a warm female physical therapy coach speaking to someone mid-workout.",
  "Speak at a natural conversational pace — clear, friendly, and human, never rushed.",
  "Use gentle pitch variation and prosody like a real person — not flat or robotic.",
  "For praise, sound sincerely encouraging.",
  "For form tips, sound caring and clear, never scolding.",
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
    const r = await openaiSpeech(body, key);
    if (r.status < 200 || r.status >= 300) {
      const errText = r.buf.toString("utf8");
      console.error("OpenAI TTS error", r.status, errText);
      return res.status(r.status).json({ error: "openai_tts_failed", detail: errText.slice(0, 500) });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(r.buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Voice Feedback TTS http://127.0.0.1:${PORT}`);
  console.log(`  model=${MODEL} voice=${VOICE} speed=${SPEED} key=${process.env.OPENAI_API_KEY ? "set" : "MISSING"}`);
});
