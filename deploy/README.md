# `deploy/` — hosting & nginx

Production layout: **static UI on Vercel**, **coach API + TTS on OCI Compute** behind nginx/HTTPS.

Step-by-step guide: **[HOSTING.md](./HOSTING.md)**.

## Contents

| File | Role |
|---|---|
| `HOSTING.md` | One-time OCI VM setup, Certbot, Vercel project, GitHub Actions secrets |
| `nginx-formcheck.conf` | Sample nginx: serve `web/` + proxy `/coach`, `/health`, `/tts`, … |

Root `deploy.sh` (run on the VM) pulls `main`, restarts uvicorn + TTS, reloads nginx.

## Architecture

```
Browser (Vercel *.vercel.app)
  → https://<oci-host>/coach/*     → FastAPI :8000
  → https://<oci-host>/tts         → FastAPI → voice-feedback :3002
  → MediaPipe / models             → from Vercel static files (no video upload)
```

`web/config.js` points Vercel traffic at the public OCI hostname (`OCI_BACKEND`).

## Auto-deploy

`.github/workflows/deploy-backend.yml` runs on pushes to `main` that touch `backend/`, `web/`, `voice-feedback/`, `deploy/`, or `deploy.sh`.

Typical Actions secrets: `OCI_HOST`, `OCI_USER`, `OCI_SSH_KEY`, `BACKEND_ENV`, `VOICE_FEEDBACK_ENV` (optional `OCI_CONFIG`, `OCI_API_KEY_PEM`).

**Do not push straight to `main` for experiments** — the workflow hard-resets the VM to `origin/main`. Open a PR instead.
