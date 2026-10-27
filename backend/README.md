# `backend/` — Kinetix coach API

FastAPI service on **:8000**. Bridges the browser to OCI Generative AI (with local template fallbacks), proxies neural TTS, and stores session logs (rep results only — never video).

The UI calls this via `window.FORM_CHECK_API` (`web/config.js`, `web/coach.js`).

## Run

From the repo root (uses `backend/` as the app dir):

```bash
npm run serve:api
# → http://127.0.0.1:8000
```

Or:

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill OCI settings when you have them
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Works **without** OCI credentials: GenAI calls fall back to local templates (`source: local`). With `~/.oci/config` + `.env` filled, responses use OCI GenAI (`source: oci`).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness (`service: kinetix-coach`) |
| `POST` | `/coach/cue` | Short spoken cue after a rep |
| `POST` | `/coach/chat` | Ask-coach mid-set Q&A |
| `POST` | `/coach/summary` | End-of-set patient report + `spoken_summary` |
| `POST` | `/coach/plan-suggestions` | PT draft: deterministic rules + GenAI wording |
| `POST` | `/tts` | Proxy to voice-feedback on `:3002` (HTTPS path for Vercel) |
| `GET` | `/tts/health` | Upstream TTS health |
| `POST` / `GET` | `/sessions` | Session logs → OCI Object Storage (or `backend/data/sessions/` on disk) |

## Modules

| File | Role |
|---|---|
| `main.py` | FastAPI app, CORS, routes |
| `oci_genai.py` | OCI GenAI + local fallbacks |
| `plan_rules.py` | Deterministic AI plan rules (pain limit, progression caps, …) |
| `oci_storage.py` | Object Storage write/list with disk fallback |
| `.env.example` | CORS, GenAI, bucket, port |

## Env

Copy `.env.example` → `.env`. Important keys:

- `CORS_ORIGINS` — local + custom domains (`*.vercel.app` is allowed via regex in `main.py`)
- `OCI_GENAI_COMPARTMENT_ID`, `OCI_GENAI_MODEL_ID`, `OCI_REGION`
- `OCI_NAMESPACE`, `OCI_BUCKET` — session archive
- `TTS_UPSTREAM` — default `http://127.0.0.1:3002`

Never commit `.env`. Production secrets are synced by GitHub Actions onto the OCI VM (see `deploy/README.md`).

## Deploy

Pushes to `main` that touch `backend/**` (among other paths) trigger `.github/workflows/deploy-backend.yml`, which SSHs to the VM and runs `deploy.sh`.
