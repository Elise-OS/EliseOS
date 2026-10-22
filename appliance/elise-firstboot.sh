#!/usr/bin/env bash
set -euo pipefail
status=/run/elise-preparation/status.json
auth_file=/etc/elise/github-auth
status_message() {
  mkdir -p "$(dirname "$status")"
  printf '{"message":"%s","needsGithubAuth":%s}\n' "$1" "${2:-false}" > "$status"
}
failed() {
  # Keep the installer's own explanation when it wrote one.
  grep -q '"error":true' "$status" 2>/dev/null \
    || status_message "La préparation a rencontré un problème. Élise réessaiera automatiquement dans une minute."
  systemctl start elise-preparation.service || true
}
trap failed ERR

status_message "Application des réglages du Raspberry Pi…"
# Hostname, user, Wi-Fi and the root filesystem growth come from cloud-init.
cloud-init status --wait >/dev/null 2>&1 || true

status_message "Connexion au réseau…"
for _ in $(seq 1 60); do
  getent hosts github.com >/dev/null 2>&1 && break
  sleep 5
done
if ! getent hosts github.com >/dev/null 2>&1; then
  status_message "Internet est indisponible. Élise réessaiera automatiquement ; vérifiez le câble ou le Wi-Fi."
  exit 1
fi

# The Raspberry Pi has no clock battery: HTTPS and signatures need the real time.
status_message "Synchronisation de l’horloge…"
for _ in $(seq 1 24); do
  [[ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" == yes ]] && break
  sleep 5
done

# The FAT boot partition is the only one editable from Windows or macOS after flashing.
for candidate in /boot/firmware/elise-github-auth /boot/firmware/elise-github-auth.txt; do
  [[ -s "$candidate" ]] || continue
  install -d -m 0755 /etc/elise
  (umask 077 && tr -d '\r' < "$candidate" > "$auth_file.tmp")
  mv "$auth_file.tmp" "$auth_file"
  rm -f -- "$candidate"
done
# A public repository installs anonymously; a private one needs the bot account.
if ! grep -q '^token=.' "$auth_file" 2>/dev/null \
  && ! curl -fsS -o /dev/null "https://api.github.com/repos/${ELISE_REPOSITORY:-Elise-OS/EliseOS}/releases/latest"; then
  status_message "Indiquez le compte bot GitHub d’Élise pour télécharger les composants." true
  exit 1
fi

ELISE_SOURCE_DIR=/usr/share/elise/runtime ELISE_VERSION="$(cat /usr/share/elise/version)" ELISE_FIRST_BOOT=true \
  ELISE_SKIP_SYSTEM_PACKAGES=true /usr/lib/elise/install-elise.sh
touch /var/lib/elise/.firstboot-complete
trap - ERR
