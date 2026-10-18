# Design notes — interactive natural voice

## Problem

`window.speechSynthesis` (current `speak()` in `web/app.js`):

- Sounds robotic / OS-dependent  
- Drops audio mid-session in Chrome  
- Cannot match a product “coach” brand voice  

## Solution split

| Concern | Tech | Latency target |
|---------|------|----------------|
| User speech → text | Web Speech API (existing) | ~0.5–1.5 s |
| Text coach reply | OCI GenAI or OpenAI chat | ~0.5–2 s |
| Text → audio | OpenAI TTS `tts-1-hd` | ~0.5–1.5 s |
| Play while exercising | Queue / barge-in cancel | interruptible |

Total spoken cue after a rep: aim **&lt; 2.5 s** from verdict → first audio.

## Voice choices (OpenAI TTS)

Good coach-like options to A/B:

- `coral` — warm, clear  
- `sage` — calm  
- `ash` — neutral  
- `alloy` — default  

Model: `tts-1-hd` (quality) or `tts-1` (faster/cheaper).  
Newer: `gpt-4o-mini-tts` with style instructions (“encouraging PT coach, concise”).

## Real-time conversation (phase 2)

For true talk-over-exercise duplex:

- **OpenAI Realtime API** (WebRTC or WebSocket) — STT + LLM + TTS in one session  
- Or keep STT local + chat + TTS as three hops (simpler, good enough for demo)

Phase 1 (this folder): neural TTS for cues + chat replies.  
Phase 2: Realtime or continuous listen between reps.

## Security

- OpenAI / OCI keys **only** on the server (`voice-feedback/server` or `backend/`)  
- Browser calls `http://127.0.0.1:3002/tts` with text only  
- Never ship `OPENAI_API_KEY` to Vercel static `web/`

## Cost guardrails

- Cap cue length (already ~10 words in `oci_genai`)  
- Skip TTS if Voice checkbox off  
- Dedupe identical lines within 2 s  
- Prefer short cues during tempo exercises (shoulder extension)
