#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=nas-common.sh
source "$SCRIPT_DIR/nas-common.sh"

if [[ "${1:-}" == "--yes" ]]; then
  NAS_ASSUME_YES=true
elif (($#)); then
  echo "Usage : bash scripts/nas-clean-install.sh [--yes]" >&2
  exit 2
fi

load_nas_config
confirm_action \
  "REINSTALLER ELISE" \
  "ATTENTION : cette opération supprime toutes les données et tous les volumes Docker d'Élise OS."

echo "Réinstallation complète d'Élise OS sur $MICHEL_NAS_TARGET"
ssh "$MICHEL_NAS_TARGET" "$(remote_shell_command)" <<'REMOTE_SCRIPT'
set -euo pipefail
cd "$REMOTE_PATH"

if [[ "$(pwd -P)" != "${REMOTE_PATH%/}" || ! -f compose.yaml ]]; then
  echo "Dossier Élise OS distant invalide ; opération refusée." >&2
  exit 1
fi

# La détection a lieu avant toute suppression afin qu'une ambiguïté USB interrompe
# l'installation sans toucher aux données existantes.
./scripts/detect-zigbee-adapter.sh --write-env .env

docker compose down --volumes --remove-orphans

# Utiliser une configuration Docker temporaire évite qu'un ancien jeton GHCR
# enregistré sur le NAS bloque le téléchargement public des images.
deploy_docker_config="$(mktemp -d)"
trap 'rm -r "$deploy_docker_config"' EXIT
printf '{}\n' > "$deploy_docker_config/config.json"

DOCKER_CONFIG="$deploy_docker_config" docker compose up -d --build \
  bootstrap postgres mosquitto go2rtc ai api worker dashboard homeassistant

deadline=$((SECONDS + 300))
until curl --fail --silent "http://127.0.0.1:${REMOTE_PORT}/api/v1/system/health" >/dev/null \
  && curl --fail --silent "http://127.0.0.1:${REMOTE_PORT}/" >/dev/null; do
  if ((SECONDS >= deadline)); then
    docker compose logs --tail=120 api worker dashboard homeassistant >&2
    exit 1
  fi
  sleep 3
done

docker compose ps

adapter="$(sed -n 's/^ZIGBEE_ADAPTER=//p' .env)"
if [[ -n "$adapter" && -e "$adapter" ]]; then
  DOCKER_CONFIG="$deploy_docker_config" docker compose up -d zigbee2mqtt
  zigbee_deadline=$((SECONDS + 60))
  until [[ "$(docker compose ps --status running --services zigbee2mqtt)" == "zigbee2mqtt" ]]; do
    if ((SECONDS >= zigbee_deadline)); then
      docker compose logs --tail=120 zigbee2mqtt >&2
      echo "Le coordinateur est détecté, mais Zigbee2MQTT ne parvient pas à démarrer." >&2
      exit 1
    fi
    sleep 2
  done
  echo "Coordinateur Zigbee configuré automatiquement : Zigbee2MQTT a été démarré."
else
  echo "Coordinateur Zigbee absent : Zigbee2MQTT reste arrêté."
fi
REMOTE_SCRIPT

echo "Installation propre terminée. Ouvrez $MICHEL_NAS_URL"
