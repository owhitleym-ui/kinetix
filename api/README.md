# Form Check ATP API

Logs sessions/reps to Oracle Autonomous DB and (optionally) uploads feature JSON to Object Storage.

The GenAI coach API stays in `backend/` (port 8000). This service is the ATP writer (port 3001).

## Setup

1. Download your ATP wallet into `api/Wallet_*` (gitignored).
2. Copy `.env.example` → `.env` and set `DB_USER`, `DB_PASSWORD`, `WALLET_PASSWORD`, `WALLET_DIR`, `DB_CONNECT_STRING`, and `JWT_SECRET`.
3. Install, migrate auth tables, and run:

```bash
cd api
npm install
npm run migrate   # creates users + session_shares; adds patients.user_id
npm start
```

4. Serve the web app from the repo root (`npm run serve` / `node scripts/serve-web.mjs`).
5. Open `login.html` / `register.html` to create patient or PT accounts. Patients can share sessions at `permissions.html`.

## Object Storage (optional)

Until OCI API keys are set, DB logging still works; uploads are skipped.

1. OCI Console → Profile → **My profile** → **API keys** → **Add API key** → Download private key as `oci_api_key.pem` into this folder.
2. Copy fingerprint, tenancy OCID, user OCID into `.env`.
3. Bucket `pt-app` → copy **Namespace** into `OCI_NAMESPACE`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness |
| POST | `/api/auth/register` | Create patient or PT account |
| POST | `/api/auth/login` | Email/password → JWT |
| GET | `/api/auth/me` | Current user (Bearer) |
| GET | `/api/pts` | List PT accounts (for share UI) |
| GET | `/api/sessions` | Patient: own sessions; PT: shared sessions |
| POST | `/api/sessions` | Start session (patient, auth) |
| POST | `/api/sessions/:id/end` | End session (owner) |
| POST | `/api/sessions/:id/share` | Grant session to a PT |
| DELETE | `/api/sessions/:id/share/:ptUserId` | Revoke share |
| POST | `/api/reps` | Log rep (+ upload JSON if OCI configured) |
