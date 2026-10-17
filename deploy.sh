#!/bin/bash
# Run on the OCI server: bash ~/kinetix/deploy.sh
set -e
cd "$HOME/kinetix"
git pull --ff-only
cd backend
[ -d .venv ] || python3.12 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
pkill -f "uvicorn main:app" || true
nohup .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 > "$HOME/kinetix-api.log" 2>&1 < /dev/null &
sleep 3
curl -fsS http://127.0.0.1:8000/health && echo "  API is up"
