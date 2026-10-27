# `api/` — Kinetix ATP API

Express service on **:3001**. Logs accounts, sessions, and reps to Oracle Autonomous DB and (optionally) uploads feature JSON to Object Storage.

The GenAI coach API stays in `backend/` (:8000). The browser hits this service via `window.FORM_CHECK_ATP` / `auth.js` (default `http://127.0.0.1:3001`).

Without a wallet and `.env`, the web app still runs in **demo mode** (localStorage). You only need this folder for real register/login and DB-backed session/rep writes.

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

From the repo root you can also use `npm run serve:atp` and `npm run migrate:atp`.

4. Serve the web app from the repo root (`npm run serve`).
5. Sign in from the app modal, or open `login.html` / `register.html`. Patients can share sessions at `permissions.html` (also mirrored under Patient settings).

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

## Planned for the Kinetix screens (not built yet)

The new web screens read through `web/data.js`, which calls these endpoints when a JWT exists and `/health` answers,
and falls back to the browser demo store when an endpoint is missing (so they are safe to add one at a time):

| Endpoint | Used by |
|---|---|
| `GET /api/me/plan` | Patient Today (active plan + PT message) |
| `GET /api/me/sessions?detail=1` → `{ sessions: [{ startedAt, exercises: [{ ex, done, good, mistakes: [{ code, n }] }], checkin: { pain } }] }` | My progress (summarized client-side by `summarizeProgress` in `web/planRules.js`) |
| `POST /api/checkins` `{ sessionId, pain, effort, note }` | Session summary |
| `GET /api/caseload` (pt) | Provider caseload |
| `GET/PUT /api/settings` | Patient and provider settings |
| `POST /api/drafts/:id/approve` | AI plan review |

A migration `schema/002_kinetix.sql` would add `care_team`, `plans` / `plan_items`, `pt_messages`, `checkins`,
`clinical_profile`, `ai_drafts` / `ai_suggestions` and `settings`, with care-team auto-sharing of new sessions
(keeping `session_shares` and per-session revoke).
