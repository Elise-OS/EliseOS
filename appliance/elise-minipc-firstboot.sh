#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="${ELISE_REPOSITORY:-Elise-OS/EliseOS}"
VERSION="$(cat /usr/share/elise/version)"
STATE=/var/lib/elise
STATUS=/run/elise-preparation/status.json
WORK_DIR="$(mktemp -d)"

status_message() {
  install -d -m 0755 "$(dirname "$STATUS")"
  printf '{"message":"%s","needsGithubAuth":false}\n' "$1" > "$STATUS"
  echo "→ $1"
}

failed() {
  status_message "La préparation a rencontré un problème. Élise réessaiera automatiquement dans une minute."
  systemctl start elise-preparation.service || true
}

cleanup() {
  rm -rf -- "$WORK_DIR"
}

trap cleanup EXIT
trap failed ERR

status_message "Application des réglages du mini PC…"
if [[ ! -L /opt/elise/current ]] && ! grep -q '^ELISE_INSTANCE_ID=.' /etc/elise/elise.env; then
  instance_id="$(python3 -c 'import uuid,sys; print(uuid.uuid5(uuid.NAMESPACE_URL, "elise-os:" + sys.argv[1]))' "$(cat /etc/machine-id)")"
  sed -i '/^ELISE_INSTANCE_ID=/d' /etc/elise/elise.env
  printf 'ELISE_INSTANCE_ID=%s\n' "$instance_id" >> /etc/elise/elise.env
fi

status_message "Connexion au réseau Ethernet…"
for _ in $(seq 1 60); do
  getent hosts github.com >/dev/null 2>&1 && break
  sleep 5
done
getent hosts github.com >/dev/null 2>&1 \
  || { status_message "Internet est indisponible. Vérifiez le câble Ethernet ; Élise réessaiera automatiquement."; exit 1; }

status_message "Vérification de l’installateur Élise OS ${VERSION}…"
base_url="https://github.com/${REPOSITORY}/releases/download/${VERSION}"
for asset in install-elise.sh install-elise.sh.sigstore.json; do
  curl -fsSL "$base_url/$asset" -o "$WORK_DIR/$asset"
done
echo "$(cat /usr/share/elise/install-elise.sha256)  $WORK_DIR/install-elise.sh" | sha256sum -c -

if ! command -v cosign >/dev/null; then
  cosign_sha256=783b5d6c74105401c63946c68d9b2a4e1aab3c8abce043e06b8510b02b623ec9
  curl -fsSL https://github.com/sigstore/cosign/releases/download/v2.5.3/cosign-linux-amd64 \
    -o "$WORK_DIR/cosign"
  echo "$cosign_sha256  $WORK_DIR/cosign" | sha256sum -c -
  install -m 0755 "$WORK_DIR/cosign" /usr/local/bin/cosign
fi
cosign verify-blob "$WORK_DIR/install-elise.sh" \
  --bundle "$WORK_DIR/install-elise.sh.sigstore.json" \
  --certificate-identity-regexp "^https://github.com/${REPOSITORY}/.github/workflows/release.yml@refs/heads/main$" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com >/dev/null

status_message "Démarrage de l’installation signée d’Élise OS ${VERSION}…"
chmod 0700 "$WORK_DIR/install-elise.sh"
ELISE_VERSION="$VERSION" ELISE_FIRST_BOOT=true "$WORK_DIR/install-elise.sh"
install -d -m 0755 "$STATE"
touch "$STATE/.firstboot-complete"
trap - ERR
