#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=nas-common.sh
source "$SCRIPT_DIR/nas-common.sh"

if [[ "${1:-}" == "--yes" ]]; then
  NAS_ASSUME_YES=true
elif (($#)); then
  echo "Usage : bash scripts/nas-reset-database.sh [--yes]" >&2
  exit 2
fi

load_nas_config
confirm_action \
  "VIDER ELISE" \
  "Cette opération supprime les comptes, logements, alertes et observations d'Élise. Les autres volumes sont conservés."

echo "Remise à zéro de la base Élise sur $MICHEL_NAS_TARGET"
ssh "$MICHEL_NAS_TARGET" "$(remote_shell_command)" <<'REMOTE_SCRIPT'
set -euo pipefail
cd "$REMOTE_PATH"

if [[ "$(pwd -P)" != "${REMOTE_PATH%/}" || ! -f compose.yaml ]]; then
  echo "Dossier Élise OS distant invalide ; opération refusée." >&2
  exit 1
fi

restart_apps() {
  docker compose up -d api worker dashboard >/dev/null 2>&1 || true
}
trap restart_apps EXIT

docker compose stop dashboard worker api
docker compose exec -T postgres psql -U michel -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE michel WITH (FORCE);'
docker compose exec -T postgres psql -U michel -d postgres -v ON_ERROR_STOP=1 \
  -c 'CREATE DATABASE michel OWNER michel;'
docker compose up -d api worker dashboard
trap - EXIT

deadline=$((SECONDS + 180))
until curl --fail --silent "http://127.0.0.1:${REMOTE_PORT}/api/v1/system/health" >/dev/null; do
  if ((SECONDS >= deadline)); then
    docker compose logs --tail=100 api worker dashboard >&2
    exit 1
  fi
  sleep 3
done

docker compose ps api worker dashboard
REMOTE_SCRIPT

echo "Base Élise recréée. Ouvrez $MICHEL_NAS_URL pour créer le nouvel administrateur."
