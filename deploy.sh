#!/usr/bin/env bash
set -euo pipefail

# Deploy trackpix-api na VM pdfs (authixvm1)
# Uso: ./deploy.sh [mensagem-do-commit]
# Primeira vez na VM:
#   1) Enviar .env: gcloud compute scp --zone us-central1-f .env pdfs:/root/trackpix-api/.env --project kingingressosv3
#   2) SSL: sudo certbot --nginx -d api.trackpix.com.br

GCP_PROJECT="${GCP_PROJECT:-kingingressosv3}"
GCP_ZONE="${GCP_ZONE:-us-central1-f}"
GCP_INSTANCE="${GCP_INSTANCE:-pdfs}"
REMOTE_DIR="${REMOTE_DIR:-/root/trackpix-api}"
COMMIT_MSG="${1:-deploy vm}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "==> Local: commit e push (${BRANCH})"
git add .

if git diff --staged --quiet; then
  echo "    Nenhuma alteração staged; pulando commit."
else
  git commit -m "$COMMIT_MSG"
fi

git push origin "$BRANCH"

echo "==> Remote: ${GCP_INSTANCE} (${REMOTE_DIR})"
gcloud compute ssh \
  --zone "$GCP_ZONE" \
  "$GCP_INSTANCE" \
  --project "$GCP_PROJECT" \
  --command "sudo -i bash -s" <<REMOTE
set -euo pipefail
if [ ! -d "$REMOTE_DIR/.git" ]; then
  mkdir -p "$REMOTE_DIR"
  git clone https://github.com/leosouza28/trackpix-api.git "$REMOTE_DIR"
fi
cd "$REMOTE_DIR"
git reset --hard
git pull origin "$BRANCH"
test -f .env || { echo "ERRO: .env ausente em $REMOTE_DIR — copie com gcloud compute scp"; exit 1; }
npm ci
npm run build
pm2 stop ecosystem.config.js 2>/dev/null || true
pm2 delete ecosystem.config.js 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 list
REMOTE

echo "==> Deploy concluído (https://api.trackpix.com.br)"
