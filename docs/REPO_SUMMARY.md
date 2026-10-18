# Kinetix — Repository Summary

One-page map of what this repo is, how the pieces fit together, and what each major folder does.

**Product:** Patients practise their PT’s home exercise plan on camera with live form feedback. Their physical therapist sees progress and approves AI-drafted plan changes. Pose runs **in the browser**; video never leaves the device.

**Live demo (typical):** Frontend on [Vercel](https://kinetix-six-drab.vercel.app/) · Coach API / TTS on OCI (`https://207-211-163-177.sslip.io`).

---

## Architecture (high level)

```
┌─────────────────────────────┐
│  web/  (Vercel or :8801)    │  MediaPipe Pose, UI, demo store
│  Patient + Provider SPA     │
└───────────┬─────────────────┘
            │ HTTPS
     ┌──────┴──────┬─────────────────────┐
     ▼             ▼                     ▼
┌──────────┐ ┌───────────┐      ┌────────────────┐
│ backend/ │ │ voice-    │      │ api/ (ATP)      │
│ FastAPI  │ │ feedback/ │      │ Express +      │
│ :8000    │ │ TTS :3002 │      │ Oracle DB      │
│ OCI GenAI│ │ OpenAI    │      │ :3001          │
│ Object   │ │ speech    │      │ auth, sessions │
│ Storage  │ └───────────┘      └────────────────┘
└──────────┘
     ▲
     │ deploy.sh + GitHub Actions → OCI Compute + nginx
```

| Layer | Role |
|--------|------|
| **Frontend (`web/`)** | Landing, auth UI, patient Today/warmup/session/summary, provider caseload/AI plan, exercise library, on-device pose + classifiers |
| **Coach API (`backend/`)** | GenAI cues, chat, session summaries, PT plan-suggestion wording; optional Object Storage session logs |
| **TTS (`voice-feedback/`)** | Neural spoken coach voice (OpenAI) proxied for the browser |
| **ATP API (`api/`)** | JWT auth, patients/sessions/reps on Oracle Autonomous DB (wallet required) |
| **Deploy (`deploy/`, `deploy.sh`)** | nginx + processes on one OCI VM; secrets via GitHub Actions |

---

## User flows

### Patient
1. Landing → sign in (real ATP or **demo patient**)  
2. **Today** — plan, PT message, week strip  
3. Warm-up → recording choice → **live session** (camera/video, reps, cues, TTS)  
4. **Summary** + pain/effort check-in  
5. Settings (privacy, cues, care team / sharing)

### Provider (PT)
1. Landing → sign in (real or **demo provider**)  
2. **Caseload** — needs attention + all patients  
3. Patient progress (pain, form, deficits, adherence)  
4. **AI plan review** — accept / edit / dismiss suggestions → approve & send  
5. Provider settings (AI on/off, pain limit, alerts)

**Rule of the product:** nothing changes on the patient’s plan until the PT approves. Progression is blocked while pain is above the PT’s limit (default 4/10).

---

## Frontend (`web/`)

Vanilla JS + ES modules (no bundler). Entry: `index.html` + hash router (`router.js` / `views/`).

| Area | Key files |
|------|-----------|
| Routing / chrome | `views/index.js`, `views/chrome.js`, `router.js`, `kinetix.css`, `ui.js` |
| Landing / sign-in | `views/landing.js`, `account.js`, `auth.js` |
| Patient screens | `views/patientHome.js`, `summary.js`, `progress.js`, `patientSettings.js`, `recordChoice.js` |
| Provider screens | `views/caseload.js`, `patientDetail.js`, `aiPlan.js`, `providerSettings.js` |
| Live form check | `app.js`, `session.js`, `features.js`, `rules.js`, `catalog.js` |
| Coach / voice | `coach.js`, `naturalSpeak.js`, `speechInput.js`, `sessionMemory.js` |
| AI plan rules (client) | `planRules.js` → tries `POST /coach/plan-suggestions`, else local rules |
| Demo data | `demo/seed.js`, `data.js` (localStorage; works offline) |
| Config | `config.js` — local ports vs Vercel → OCI backend URL |

### Exercise / form tech
- **MediaPipe Pose** in-browser  
- **Trained classifiers** (squat, shoulder abduction, shoulder extension) — mistake labels per exercise  
- **Joint-angle rules** for five other shoulder exercises (`rules_*.json`)  
- Setup gate, mobility limits (None / Slight / Moderate), rep validation, overlay + log  
- Models/assets under `web/models/` and `web/assets/`

### Config URLs (`config.js`)
- Localhost → API `:8000`, TTS `:3002`  
- `*.vercel.app` → public OCI origin  
- Otherwise same-origin (nginx on the VM)

---

## Backend — FastAPI (`backend/`)

`npm run serve:api` → `http://127.0.0.1:8000`

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness |
| `POST /coach/cue` | Short spoken cue after a rep (OCI GenAI or local) |
| `POST /coach/chat` | Ask-coach Q&A from session context |
| `POST /coach/summary` | End-of-set patient report + TTS `spoken_summary` |
| `POST /coach/plan-suggestions` | PT draft: deterministic rules + OCI wording for `why[]` / patient message |
| `POST /tts` | Proxy to Node TTS on `:3002` (so Vercel HTTPS can reach voice) |
| `GET /tts/health` | TTS upstream health |
| `POST/GET /sessions` | Session logs → OCI Object Storage (or local disk fallback) |

Key modules: `main.py`, `oci_genai.py`, `plan_rules.py`, `oci_storage.py`.  
Env: `backend/.env` / `.env.example` (`OCI_GENAI_*`, CORS, bucket). Needs `~/.oci/config` + API key for real GenAI.

---

## Voice (`voice-feedback/`)

- Node Express TTS proxy (`server/tts_server.js`) on `:3002`  
- OpenAI `gpt-4o-mini-tts` (female voice `nova`)  
- Env: `voice-feedback/.env` → `OPENAI_API_KEY`  
- Browser client in the app: `web/naturalSpeak.js` (queued, gain-boosted playback)

---

## ATP API (`api/`)

Express + Oracle Autonomous DB (wallet). `npm run serve:atp` → `:3001`.

- Auth: register / login / me (JWT; roles `patient` | `pt`)  
- Sessions, reps, shares, goals (see `api/README.md`, `schema/`)  
- Newer UI reads (plans, caseload, drafts) may still fall back to **demo store** until those ATP endpoints exist  

`branch/` holds an older/experimental copy of related work; treat `api/` + `web/` as current.

---

## Training & data

| Path | Role |
|------|------|
| `training/` | Pose extract, REHAB26 feature export, train classifiers, clinical/angle rules |
| `dataset/` | Dataset notes / assets for training |
| `Data/` | Additional data (if present locally) |
| `tests/` | Parity, sim, rules, mobility, browser/load checks (`npm test`, etc.) |
| `scripts/` | `serve-web.mjs`, helpers |

---

## Deploy & hosting

| Piece | Role |
|-------|------|
| `deploy.sh` | On OCI VM: pull `main`, restart uvicorn + TTS, reload nginx |
| `deploy/nginx-formcheck.conf` | Static `web/` + proxy `/coach`, `/health`, `/tts`, … |
| `deploy/HOSTING.md` | Vercel front + OCI back; HTTPS/CORS notes |
| `.github/workflows/deploy-backend.yml` | SSH deploy on push; writes `BACKEND_ENV` / `VOICE_FEEDBACK_ENV` secrets onto the VM |
| `vercel.json` | Static output = `web/` |

**GitHub Actions secrets (typical):** `OCI_HOST`, `OCI_USER`, `OCI_SSH_KEY`, `BACKEND_ENV`, `VOICE_FEEDBACK_ENV`.

---

## Docs in this repo

| File | Contents |
|------|----------|
| `README.md` | Product overview, screens, quick start, exercises |
| `docs/KINETIX_BRIEF.md` | Implementation brief / wireframe handoff |
| `docs/REPO_SUMMARY.md` | This file |
| `deploy/HOSTING.md` | Production hosting |
| `api/README.md` | ATP / wallet setup |
| `voice-feedback/README.md`, `DESIGN.md` | TTS notes |

---

## Local quick start

```bash
npm run serve          # web → http://127.0.0.1:8801
npm run serve:api      # coach → :8000
# optional:
npm run serve:atp      # Oracle auth/sessions → :3001
# optional TTS: cd voice-feedback/server && npm start  → :3002
```

Demo accounts work with **only** `npm run serve` (no DB, no OCI, no TTS).

---

## What’s wired vs what you still configure

| Capability | Status in code | Needs credentials |
|------------|----------------|-------------------|
| On-device form check + library | Ready | None |
| Demo patient/provider UX | Ready | None |
| Coach cue / chat / summary / plan wording | Ready (local fallback) | OCI GenAI + `~/.oci` for `source: oci` |
| Neural TTS | Ready | `OPENAI_API_KEY` |
| Vercel → OCI | Ready (`config.js` + CORS) | Deployed VM + HTTPS |
| ATP login / DB sessions | Ready in `api/` | Wallet + `api/.env` |
| Object Storage session archive | Ready | `OCI_NAMESPACE` / bucket + OCI auth |

---

## Repo layout (top level)

```
web/                 Patient + provider SPA + pose pipeline
backend/             FastAPI coach + GenAI + plan rules + TTS proxy routes
api/                 Express ATP (Oracle DB auth/sessions)
voice-feedback/      OpenAI TTS proxy
deploy/              nginx + hosting docs
training/            Model training
dataset/, Data/      Training / sample data
tests/, scripts/     Tests and helpers
docs/                Briefs and this summary
.github/workflows/   OCI deploy
branch/              Legacy/experimental (not the primary app path)
frontend/            Extra/legacy frontend material if present
```

---

*Generated as a living overview of the Kinetix monorepo. Prefer `README.md` for day-to-day product docs and `deploy/HOSTING.md` for production steps.*
