#!/usr/bin/env bash
# Deploy the latest code from GitHub. Run on the server, as the app user, from anywhere:
#   ~/salonbilling/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Pulling latest code"
git pull --ff-only

echo "→ Installing dependencies"
npm ci

echo "→ Building the web app"
npm run build

echo "→ Applying database migrations"
npm run db:deploy

echo "→ Restarting the API"
pm2 restart deploy/ecosystem.config.cjs --update-env

sleep 3
curl -fsS http://127.0.0.1:4000/api/health && echo " ← API is up"
