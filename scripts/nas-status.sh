#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=nas-common.sh
source "$SCRIPT_DIR/nas-common.sh"
load_nas_config

echo "État d'Élise OS sur $MICHEL_NAS_TARGET"
ssh "$MICHEL_NAS_TARGET" "$(remote_shell_command)" <<'REMOTE_SCRIPT'
set -euo pipefail
cd "$REMOTE_PATH"

if [[ "$(pwd -P)" != "${REMOTE_PATH%/}" ]]; then
  echo "Le chemin distant réel ne correspond pas au chemin attendu." >&2
  exit 1
fi

docker compose ps -a
if [[ -f /var/lib/elise/jitsi/jitsi.env ]]; then
 docker compose --project-name elise-jitsi --env-file /var/lib/elise/jitsi/jitsi.env -f docker/jitsi/compose.yaml ps
fi
echo
if curl --fail --silent --show-error "http://127.0.0.1:${REMOTE_PORT}/api/v1/system/health"; then
  echo
  echo "Élise OS répond correctement."
else
  echo
  echo "L'API Élise OS ne répond pas correctement." >&2
  exit 1
fi
REMOTE_SCRIPT

echo "Interface : $MICHEL_NAS_URL"
