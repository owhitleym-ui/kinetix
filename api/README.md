# Form Check ATP API

Logs sessions/reps to Oracle Autonomous DB and (optionally) uploads feature JSON to Object Storage.

The GenAI coach API stays in `backend/` (port 8000). This service is the ATP writer (port 3001).

## Setup

1. Download your ATP wallet into `api/Wallet_*` (gitignored).
2. Copy `.env.example` → `.env` and set `DB_USER`, `DB_PASSWORD`, `WALLET_PASSWORD`, `WALLET_DIR`, `DB_CONNECT_STRING`.
3. Install and run:

```bash
cd api
npm install
npm start
```

4. Serve the web app from the repo root (`npm run serve` / `node scripts/serve-web.mjs`).

## Object Storage (optional)

Until OCI API keys are set, DB logging still works; uploads are skipped.

1. OCI Console → Profile → **My profile** → **API keys** → **Add API key** → Download private key as `oci_api_key.pem` into this folder.
2. Copy fingerprint, tenancy OCID, user OCID into `.env`.
3. Bucket `pt-app` → copy **Namespace** into `OCI_NAMESPACE`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness |
| POST | `/api/sessions` | Start session |
| POST | `/api/sessions/:id/end` | End session |
| POST | `/api/reps` | Log rep (+ upload JSON if OCI configured) |
