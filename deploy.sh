#!/usr/bin/env bash
set -euo pipefail

# Deploy trackpix-api na VM via SCP (sem git push)
# Uso: npm run deploy
#
# Primeira vez / SSL:
#   sudo certbot --nginx -d api.trackpix.com.br

GCP_PROJECT="${GCP_PROJECT:-kingingressosv3}"
GCP_ZONE="${GCP_ZONE:-us-central1-f}"
GCP_INSTANCE="${GCP_INSTANCE:-pdfs}"
REMOTE_DIR="${REMOTE_DIR:-/root/trackpix-api}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="/tmp/trackpix-api-${STAMP}.tgz"
REMOTE_ARCHIVE="/tmp/trackpix-api-${STAMP}.tgz"

cleanup() {
  rm -f "$ARCHIVE"
}
trap cleanup EXIT

if [ ! -f .env ]; then
  echo "ERRO: .env local não encontrado — necessário para a VM."
  exit 1
fi

echo "==> Empacotando projeto (sem node_modules/dist/.git)"
tar \
  --exclude='./node_modules' \
  --exclude='./dist' \
  --exclude='./.git' \
  --exclude='./.DS_Store' \
  --exclude='./*.tgz' \
  -czf "$ARCHIVE" \
  .

echo "==> Enviando para ${GCP_INSTANCE}:${REMOTE_DIR}"
gcloud compute ssh \
  --zone "$GCP_ZONE" \
  "$GCP_INSTANCE" \
  --project "$GCP_PROJECT" \
  --command "sudo mkdir -p '$REMOTE_DIR' && sudo chown -R \$(whoami):\$(whoami) '$REMOTE_DIR' 2>/dev/null || true"

gcloud compute scp \
  --zone "$GCP_ZONE" \
  --project "$GCP_PROJECT" \
  "$ARCHIVE" \
  "${GCP_INSTANCE}:${REMOTE_ARCHIVE}"

echo "==> Extraindo, instalando e reiniciando PM2"
gcloud compute ssh \
  --zone "$GCP_ZONE" \
  "$GCP_INSTANCE" \
  --project "$GCP_PROJECT" \
  --command "sudo -i bash -s" <<REMOTE
set -euo pipefail
mkdir -p "$REMOTE_DIR"
# Preserva node_modules se existir (acelera); troca o restante pelo pacote
tar -xzf "$REMOTE_ARCHIVE" -C "$REMOTE_DIR"
rm -f "$REMOTE_ARCHIVE"
cd "$REMOTE_DIR"
test -f .env || { echo "ERRO: .env não chegou na VM"; exit 1; }
npm ci
npm run build
pm2 stop ecosystem.config.js 2>/dev/null || true
pm2 delete ecosystem.config.js 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 list
REMOTE

echo "==> Deploy concluído (https://api.trackpix.com.br)"
