#!/usr/bin/env bash
# Builds the Raspberry Pi image from the local working tree on the NAS, without GitHub Actions,
# then optionally writes it to the SD card inserted in the NAS reader.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${MICHEL_NAS_CONFIG:-$ROOT_DIR/config/nas-deploy.env}"
BUILD=true
FLASH=false
BASE_VERSION=""

usage() {
  cat <<'EOF'
Usage: pnpm pi:image [--flash] [--base vX.Y.Z]
       pnpm pi:flash

Construit sur le NAS l’image Raspberry Pi à partir de la copie locale : installateur,
premier démarrage, préparation, Zigbee et fichiers compose locaux ; conteneurs de la
release de base (la dernière par défaut).

Options :
  --flash        Écrit l’image sur la carte SD insérée dans le lecteur du NAS.
  --no-build     Réutilise la dernière image construite (avec --flash).
  --base vX.Y.Z  Release dont les conteneurs sont utilisés.
  -h, --help     Affiche cette aide.

Réglages facultatifs dans config/nas-deploy.env :
  MICHEL_PI_BUILD_DIR, MICHEL_PI_HOSTNAME, MICHEL_PI_USER, MICHEL_PI_SSH_KEY,
  MICHEL_PI_WIFI_SSID, MICHEL_PI_WIFI_PASSWORD, MICHEL_PI_WIFI_COUNTRY
EOF
}

while (($#)); do
  case "$1" in
    --flash) FLASH=true ;;
    --no-build) BUILD=false ;;
    --base)
      BASE_VERSION="${2:-}"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Option inconnue : $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

[[ -f "$CONFIG_FILE" ]] || {
  echo "Configuration NAS absente : copiez config/nas-deploy.env.example vers config/nas-deploy.env." >&2
  exit 1
}
# shellcheck disable=SC1090
source "$CONFIG_FILE"
: "${MICHEL_NAS_TARGET:?MICHEL_NAS_TARGET est requis}"
BUILD_DIR="${MICHEL_PI_BUILD_DIR:-/mnt/data/elise-os-builds/local}"
[[ "$BUILD_DIR" =~ ^/mnt/data/elise-os-builds/[A-Za-z0-9._-]+$ ]] || {
  echo "Dossier de build refusé par sécurité : $BUILD_DIR" >&2
  exit 1
}
# The image build may reach the NAS another way than deploy:nas, e.g. on the local network.
NAS_TARGET="${MICHEL_PI_NAS_TARGET:-$MICHEL_NAS_TARGET}"
ssh_command=(ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30)
[[ -z "${MICHEL_PI_NAS_IDENTITY:-}" ]] || ssh_command+=(-i "$MICHEL_PI_NAS_IDENTITY" -o IdentitiesOnly=yes)
remote() { "${ssh_command[@]}" "$NAS_TARGET" "$@"; }
sync_to_nas() { rsync -e "${ssh_command[*]}" "$@"; }

if [[ "$BUILD" == true ]]; then
  if [[ -z "$BASE_VERSION" ]]; then
    BASE_VERSION="$(curl -fsSL https://api.github.com/repos/Elise-OS/EliseOS/releases/latest \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')"
  fi
  [[ "$BASE_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Version de base invalide : $BASE_VERSION" >&2; exit 1; }
  # Container code comes from the base release: say so when local changes would be missing.
  if git -C "$ROOT_DIR" rev-parse -q --verify "refs/tags/$BASE_VERSION" >/dev/null 2>&1 \
    && ! git -C "$ROOT_DIR" diff --quiet "$BASE_VERSION" -- apps packages docker; then
    echo "⚠ apps/, packages/ ou docker/ diffèrent de $BASE_VERSION : l’image utilisera les conteneurs de $BASE_VERSION."
  fi
  commit="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
  git -C "$ROOT_DIR" diff --quiet HEAD -- || commit="$commit-modifie"
  image="$BUILD_DIR/elise-os-$BASE_VERSION-local-$commit.img"

  echo "→ Synchronisation de la copie locale vers $NAS_TARGET:$BUILD_DIR/source"
  remote "mkdir -p '$BUILD_DIR/source' '$BUILD_DIR/work'"
  sync_to_nas -a --delete \
    --include='/compose.yaml' --include='/compose.release.yaml' --include='/compose.raspberry.yaml' \
    --include='/compose.raspberry.release.yaml' --include='/.env.example' --include='/docker/***' \
    --include='/scripts/***' --include='/appliance/***' --include='/install/***' --exclude='*' \
    "$ROOT_DIR/" "$NAS_TARGET:$BUILD_DIR/source/"

  echo "→ Construction sur le NAS (conteneurs $BASE_VERSION) : 20 à 40 minutes"
  # Detached from SSH: a dropped connection must not leave a half-built image.
  remote "cd '$BUILD_DIR' && sudo -n setsid -w nohup env ELISE_BUILD_WORKDIR='$BUILD_DIR/work' \
    bash '$BUILD_DIR/source/appliance/build-raspberry-image.sh' '$BASE_VERSION' '$image' \
    > '$BUILD_DIR/build.log' 2>&1 < /dev/null & echo \$! > '$BUILD_DIR/build.pid'"
  remote "pid=\$(cat '$BUILD_DIR/build.pid'); tail -n +1 --pid=\"\$pid\" -f '$BUILD_DIR/build.log' | grep --line-buffered -E '^(→|✓)|rror'" || true
  remote "test -s '$image'" || { echo "La construction a échoué : voir $BUILD_DIR/build.log sur le NAS." >&2; exit 1; }
  # Keep the new image and the previous one only.
  remote "ln -sfn '$(basename "$image")' '$BUILD_DIR/latest.img' && cd '$BUILD_DIR' \
    && ls -1t elise-os-*-local-*.img | tail -n +3 | xargs -r sudo -n rm -f --"
  echo "✓ Image : $NAS_TARGET:$image"
fi

[[ "$FLASH" == true ]] || exit 0

ssh_key="${MICHEL_PI_SSH_KEY:-$HOME/.ssh/toquehub_pi_test_ed25519.pub}"
[[ -f "$ssh_key" ]] || { echo "Clé SSH publique absente : $ssh_key" >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
cat > "$work/user-data" <<EOF
#cloud-config
# Same settings Raspberry Pi Imager would apply: name, user, SSH key, locale.
hostname: ${MICHEL_PI_HOSTNAME:-elise}
manage_etc_hosts: true
users:
  - name: ${MICHEL_PI_USER:-elise}
    groups: [adm, sudo, video, audio, plugdev, netdev]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: true
    ssh_authorized_keys:
      - $(cat "$ssh_key")
ssh_pwauth: false
timezone: Europe/Paris
locale: fr_FR.UTF-8
keyboard:
  layout: fr
EOF
network_arg=""
if [[ -n "${MICHEL_PI_WIFI_SSID:-}" ]]; then
  MICHEL_PI_WIFI_SSID="$MICHEL_PI_WIFI_SSID" MICHEL_PI_WIFI_PASSWORD="${MICHEL_PI_WIFI_PASSWORD:-}" \
    MICHEL_PI_WIFI_COUNTRY="${MICHEL_PI_WIFI_COUNTRY:-FR}" python3 - "$work/network-config" <<'PY'
import json, os, sys
ssid, password = os.environ["MICHEL_PI_WIFI_SSID"], os.environ.get("MICHEL_PI_WIFI_PASSWORD", "")
country = os.environ.get("MICHEL_PI_WIFI_COUNTRY", "FR")
# JSON strings are valid YAML scalars, whatever the Wi-Fi name contains.
with open(sys.argv[1], "w", encoding="utf-8") as output:
    output.write(
        "network:\n  version: 2\n  ethernets:\n    eth0:\n      dhcp4: true\n      optional: true\n"
        "  wifis:\n    wlan0:\n      dhcp4: true\n      optional: true\n"
        f"      regulatory-domain: {json.dumps(country)}\n      access-points:\n"
        f"        {json.dumps(ssid)}:\n          password: {json.dumps(password)}\n"
    )
PY
  network_arg="'$BUILD_DIR/flash/network-config'"
fi

remote "mkdir -p '$BUILD_DIR/flash' && chmod 700 '$BUILD_DIR/flash' && test -e '$BUILD_DIR/latest.img'" \
  || { echo "Aucune image construite : lancez pnpm pi:image." >&2; exit 1; }
sync_to_nas -a "$work/" "$NAS_TARGET:$BUILD_DIR/flash/"
remote "bash '$BUILD_DIR/source/scripts/nas-sd-card.sh' detect"
remote "sudo -n bash '$BUILD_DIR/source/scripts/nas-sd-card.sh' flash '$BUILD_DIR/latest.img' '$BUILD_DIR/flash/user-data' $network_arg; status=\$?; rm -f '$BUILD_DIR/flash/network-config'; exit \$status"
