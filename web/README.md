# `web/` — Kinetix app

Static patient + provider SPA. No bundler: ES modules served as-is (`npm run serve` → `http://127.0.0.1:8801`). Vercel deploys this folder (`vercel.json` → `outputDirectory: web`).

Pose, rep counting, and form scoring run **in the browser**. Video never leaves the device.

## Run

From the repo root:

```bash
npm run serve
```

Open Chrome, Edge, or Safari. Sign in with a demo account (no API required), or use a real ATP account when `api/` is running.

Optional companions (each is used when reachable, skipped when not):

| Service | Command | Port | Used for |
|---|---|---|---|
| Coach API | `npm run serve:api` | 8000 | cues, Ask coach, summary, plan-suggestions |
| ATP API | `npm run serve:atp` | 3001 | login, sessions, reps |
| TTS | `cd voice-feedback/server && npm start` | 3002 | neural spoken cues |

Base URLs are set in `config.js` (localhost ports; Vercel → OCI HTTPS).

## Layout

| Path | Role |
|---|---|
| `index.html` | App shell (warm-up, library, live session markup) |
| `kinetix.css` | Fresh Mint design tokens + components |
| `router.js` + `views/` | Hash router; one module per screen |
| `app.js` | Camera loop, judging, feedback, plan sessions |
| `features.js` / `rules.js` | Trained classifiers vs joint-angle ROM checks |
| `session.js` | Setup gate, rep validation, mobility limits |
| `catalog.js` | Exercise library (regions → exercises) |
| `data.js` + `demo/seed.js` | Demo store (`localStorage`) or ATP-backed data |
| `planRules.js` / `planRun.js` | AI plan rules + in-progress plan session |
| `coach.js` / `naturalSpeak.js` / `speechInput.js` | GenAI client, TTS, mic |
| `auth.js` / `atpClient.js` | JWT + session/rep logging |
| `models/` | MediaPipe task + `rehab26_*.json` + `rules_*.json` |
| `assets/` | Warm-up GIFs, icons, brand art |

Standalone pages: `login.html`, `register.html`, `permissions.html` (still used; main flow is the hash router).

## Routes

Registered in `views/index.js` (and session/library routes from `app.js`):

- Public: `#/`, `#/signin`
- Patient: `#/patient`, `/progress`, `/messages`, `/summary`, `/settings`, `/report/:id`, warm-up → record → session, library
- Provider: `#/provider`, `/drafts`, `/messages`, `/patient/:id`, `/plan/:draftId`, `/settings`, `/report/:id`

## Demo mode

With only `npm run serve`, **Continue with demo patient/provider** loads fictional data from `demo/seed.js`. Sessions you run are saved to `localStorage`. **Reset demo data** is at the bottom of Settings.

When ATP is up and you have a JWT, auth + session/rep writes go there. Newer screen reads (plans, caseload, drafts, …) fall back to the demo store until those endpoints exist in `api/`.

## Form check pipeline

1. MediaPipe Pose Landmarker (CDN) → 33 landmarks  
2. Setup gate → rep detection → validation  
3. Either classifier (`rehab26_*.json`) or ROM rules (`rules_*.json`)  
4. On-screen + spoken feedback (`naturalSpeak.js` → TTS when available)

Retrain / regenerate models from `training/` (see root README).
