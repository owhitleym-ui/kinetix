# Voice Feedback (natural coach voice)

Workspace for making Form Check **talk and listen in real time** with a voice that does **not** sound like the browser’s robotic `speechSynthesis`.

## Goal

While someone is exercising they should be able to:

1. **Hear** short cues out loud in a natural neural voice  
2. **Talk** to the coach mid-set (“how many left?”, “what was wrong?”)  
3. Get replies that feel interactive, not canned robot TTS  

## Why a separate folder?

Today `web/app.js` uses the browser Speech Synthesis API (`speak()`). That is free and offline-ish, but it sounds synthetic and is flaky mid-session.

This folder prototypes the replacement pipeline before wiring it into `web/` + `backend/`.

## Target pipeline

```
Mic (browser STT — already in web/speechInput.js)
        │
        ▼
 OCI GenAI / OpenAI chat model   ← wording of cues & conversation
        │                         (backend/oci_genai.py already does cues/chat)
        ▼
 OpenAI TTS (tts-1-hd / gpt-4o-mini-tts)  ← natural spoken audio
        │
        ▼
 Browser plays audio (HTMLAudioElement) instead of speechSynthesis
```

| Piece | Role | Status in repo |
|--------|------|----------------|
| STT (listen) | User → text | `web/speechInput.js` |
| GenAI cue/chat | Text replies | `backend/oci_genai.py` + `web/coach.js` |
| Neural TTS | Text → natural voice | **this folder** |
| Replace `speak()` | Play audio in app | next step after smoke test |

## Quick start (TTS smoke test)

1. Copy env and add an OpenAI key:

```bash
cp voice-feedback/.env.example voice-feedback/.env
# set OPENAI_API_KEY=sk-...
```

2. Install + run the small TTS server:

```bash
cd voice-feedback/server
npm install
npm start
```

3. In another terminal:

```bash
cd voice-feedback
node scripts/smoke_tts.mjs "Knees out. Push them over your toes."
```

That writes `voice-feedback/out/cue.mp3` — play it. If it sounds human, the TTS path works.

4. Open `voice-feedback/browser/demo.html` (serve the folder or open via any static server) to hear cues in the browser.

## OCI GenAI + “OpenAI model”

Two compatible approaches:

**A. Recommended for hackathon speed**  
- Keep **cue/chat text** on OCI GenAI (or the existing FastAPI coach on `:8000`).  
- Use **OpenAI only for TTS** (voices like `coral`, `sage`, `ash` — much less robotic).

**B. Full OpenAI path**  
- Chat: `gpt-4o-mini` (or Realtime API later for true duplex voice).  
- TTS: same OpenAI account.  
- Still call from our Node/Python backend so keys never sit in the browser.

OCI Generative AI can serve Llama / Cohere / OpenAI-compatible chat shapes (`GenericChatRequest` in `backend/oci_genai.py`). **Spoken audio** still needs a TTS provider — OCI GenAI chat alone does not replace neural TTS.

## Plug into the live app (later)

1. Point `web/app.js` `speak(text)` at `naturalSpeak.js` (fetch `/tts` → play blob).  
2. Keep mic flow in `speechInput.js`.  
3. Keep GenAI wording via `fetchCue` / `fetchChat` in `web/coach.js`.  
4. Gate with the existing **Voice** checkbox.

## Folder layout

```
voice-feedback/
  README.md              this file
  DESIGN.md              decisions + latency budget
  .env.example
  server/                tiny Express TTS proxy (holds OpenAI key)
  browser/               naturalSpeak.js + demo.html
  scripts/smoke_tts.mjs  CLI smoke test
  out/                   generated audio (gitignored)
```
