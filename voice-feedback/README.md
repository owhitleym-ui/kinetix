# `voice-feedback/` — neural TTS proxy

Optional OpenAI TTS server on **:3002**. The live app already uses it through `web/naturalSpeak.js` (and on OCI, FastAPI proxies `/tts` so Vercel HTTPS can reach voice).

Without this server, spoken cues fall back to the browser `speechSynthesis` API.

## What it does

Browser → `POST /tts` `{ text, voice? }` → OpenAI `gpt-4o-mini-tts` → MP3 audio blob → played in-session.

| Piece | Where |
|---|---|
| STT (listen) | `web/speechInput.js` |
| Cue / chat wording | `backend/` (OCI GenAI or local templates) + `web/coach.js` |
| Neural TTS | **this folder** (`server/tts_server.js`) |
| Playback in app | `web/naturalSpeak.js` (queued, interruptible) |

Design notes and latency budget: [DESIGN.md](./DESIGN.md).

## Quick start

1. Copy env and add an OpenAI key:

```bash
cp voice-feedback/.env.example voice-feedback/.env
# set OPENAI_API_KEY=sk-...
```

2. Install + run:

```bash
cd voice-feedback/server
npm install
npm start
# → http://127.0.0.1:3002
```

3. Smoke test (optional):

```bash
cd voice-feedback
node scripts/smoke_tts.mjs "Knees out. Push them over your toes."
# writes voice-feedback/out/cue.mp3
```

4. With `npm run serve` and this TTS process running, open the app and enable spoken cues — `config.js` points localhost at `:3002`.

Browser demo page (standalone): `browser/demo.html` (serve the folder or open via any static server).

## Env

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | (required) | Never commit `.env` |
| `TTS_PORT` | `3002` | |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | |
| `OPENAI_TTS_VOICE` | `nova` | Also try `coral`, `sage`, `ash` |
| `OPENAI_TTS_SPEED` | `0.92` | |
| `OPENAI_TTS_INSTRUCTIONS` | coach style string | Style instructions for mini-tts |

## Folder layout

```
voice-feedback/
  README.md
  DESIGN.md
  .env.example
  server/          Express TTS proxy (holds the OpenAI key)
  browser/         naturalSpeak.js copy + demo.html
  scripts/         smoke_tts.mjs
  out/             generated audio (gitignored)
```

On the OCI VM, production `.env` is written by GitHub Actions (`VOICE_FEEDBACK_ENV` secret) and nginx/`backend` expose `/tts` over HTTPS — see `deploy/HOSTING.md`.
