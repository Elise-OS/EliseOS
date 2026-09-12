#!/usr/bin/env bash
set -euo pipefail
status=/run/elise-preparation/status.json
mkdir -p "$(dirname "$status")"
failed() {
  mkdir -p "$(dirname "$status")"
  printf '{"message":"La préparation a rencontré un problème. Élise réessaiera automatiquement dans une minute."}\n' > "$status"
  systemctl start elise-preparation.service || true
}
trap failed ERR
printf '{"message":"Connexion au réseau…"}\n' > "$status"
for _ in $(seq 1 60); do
  getent hosts github.com >/dev/null 2>&1 && break
  sleep 5
done
if ! getent hosts github.com >/dev/null 2>&1; then
  printf '{"message":"Internet est indisponible. Élise réessaiera automatiquement ; vérifiez le câble ou le Wi-Fi."}\n' > "$status"
  exit 1
fi
ELISE_SOURCE_DIR=/usr/share/elise/runtime ELISE_VERSION="$(cat /usr/share/elise/version)" ELISE_FIRST_BOOT=true /usr/lib/elise/install-elise.sh
touch /var/lib/elise/.firstboot-complete
trap - ERR
