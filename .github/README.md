# `.github/` — CI / deploy

| Path | Role |
|---|---|
| `workflows/deploy-backend.yml` | On push to `main` (paths under `backend/`, `web/`, `voice-feedback/`, `deploy/`, `deploy.sh`), SSH to the OCI VM, sync env secrets, pull, run `deploy.sh` |

Required Actions secrets are listed in `deploy/HOSTING.md` and `deploy/README.md`. Prefer PRs over direct pushes to `main` — the workflow resets the VM to `origin/main`.
