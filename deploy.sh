#!/bin/bash
# Run on the OCI server: bash ~/kinetix/deploy.sh
# Serves: FastAPI coach (:8000) + TTS (:3002) + nginx static web on :80
set -euo pipefail

ROOT="${HOME}/kinetix"
cd "$ROOT"

echo "==> Pull latest main"
git fetch origin main
git reset --hard origin/main

echo "==> Backend (coach API)"
cd "$ROOT/backend"
[ -d .venv ] || python3.12 -m venv .venv || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
pkill -f "uvicorn main:app" || true
nohup .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 \
  > "$HOME/kinetix-api.log" 2>&1 < /dev/null &
sleep 2
curl -fsS http://127.0.0.1:8000/health && echo "  API is up"

echo "==> TTS proxy (optional if voice-feedback/.env has OPENAI_API_KEY)"
if [ -f "$ROOT/voice-feedback/.env" ] && command -v npm >/dev/null 2>&1; then
  cd "$ROOT/voice-feedback/server"
  npm install --silent
  pkill -f "tts_server.js" || true
  nohup npm start > "$HOME/kinetix-tts.log" 2>&1 < /dev/null &
  sleep 2
  curl -fsS http://127.0.0.1:3002/health && echo "  TTS is up" || echo "  TTS not responding (check ~/kinetix-tts.log)"
else
  echo "  Skipping TTS (no voice-feedback/.env or no npm)"
fi

echo "==> nginx (frontend + reverse proxy)"
NGINX_SRC="$ROOT/deploy/nginx-formcheck.conf"
if [ -f "$NGINX_SRC" ]; then
  # Rewrite root to this clone's web/ directory
  WEB_ROOT="$ROOT/web"
  TMP=$(mktemp)
  sed "s|root /home/opc/kinetix/web;|root ${WEB_ROOT};|" "$NGINX_SRC" > "$TMP"
  if command -v nginx >/dev/null 2>&1; then
    sudo cp "$TMP" /etc/nginx/conf.d/formcheck.conf
    # Disable default site if it fights for port 80 (Ubuntu)
    sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
    sudo nginx -t
    sudo systemctl reload nginx || sudo systemctl restart nginx
    echo "  nginx reloaded (web at ${WEB_ROOT})"
  else
    echo "  nginx not installed — copy $TMP to conf.d manually"
  fi
  rm -f "$TMP"
else
  echo "  missing deploy/nginx-formcheck.conf"
fi

echo "==> Done"
echo "    App:  http://$(curl -s ifconfig.me 2>/dev/null || echo YOUR_PUBLIC_IP)/"
echo "    API:  http://127.0.0.1:8000/health"
