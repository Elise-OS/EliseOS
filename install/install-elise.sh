#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="${ELISE_REPOSITORY:-Elise-OS/EliseOS}"
VERSION="${ELISE_VERSION:-__ELISE_VERSION__}"
ELISE_ROOT="${ELISE_ROOT:-/opt/elise}"
ELISE_STATE="${ELISE_STATE:-/var/lib/elise}"
ELISE_CONFIG="${ELISE_CONFIG:-/etc/elise}"
SOURCE_DIR="${ELISE_SOURCE_DIR:-}"

fail() { echo "Erreur : $*" >&2; exit 1; }
progress() {
  echo "→ $*"
  if [[ -d /run/elise-preparation ]]; then
    printf '{"message":"%s","updatedAt":"%s"}\n' "$*" "$(date -u +%FT%TZ)" > /run/elise-preparation/status.json
  fi
}

[[ "${EUID}" -eq 0 ]] || fail "l’installation doit être lancée avec sudo"
[[ -r /etc/os-release ]] || fail "Ubuntu Server 24.04 est requis"
. /etc/os-release
[[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04 ]] || fail "Ubuntu Server 24.04 LTS est requis"
case "$(dpkg --print-architecture)" in amd64|arm64) ;; *) fail "architecture non prise en charge" ;; esac
(( $(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo) >= 3500 )) || fail "4 Go de mémoire sont requis"
(( $(df -Pm / | awk 'NR==2 {print $2}') >= 28672 )) || fail "un stockage de 32 Go minimum est requis"
(( $(df -Pm / | awk 'NR==2 {print $4}') >= 16384 )) || fail "au moins 16 Go libres sont requis"
getent hosts github.com >/dev/null || fail "connexion Internet indisponible"

http_port_preflight=8080
[[ -f "$ELISE_CONFIG/elise.env" ]] && http_port_preflight="$(sed -n 's/^MICHEL_HTTP_PORT=//p' "$ELISE_CONFIG/elise.env" | tail -1)"
for port in "${http_port_preflight:-8080}" 18080 8555; do
  if [[ "${ELISE_FIRST_BOOT:-false}" == true && "$port" == "${http_port_preflight:-8080}" ]] \
    && systemctl is-active --quiet elise-preparation.service; then
    continue
  fi
  if ss -H -ltn "sport = :$port" 2>/dev/null | grep -q . && [[ ! -L "$ELISE_ROOT/current" ]]; then
    fail "le port $port est déjà utilisé"
  fi
done

progress "Installation de Docker, Tailscale et des services réseau"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq age ca-certificates curl gnupg avahi-daemon docker.io docker-compose-v2 nftables python3 xz-utils
install -d -m 0755 /usr/share/keyrings
if [[ ! -f /usr/share/keyrings/tailscale-archive-keyring.gpg ]]; then
  curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list
  apt-get update -qq
fi
apt-get install -y -qq tailscale
systemctl enable --now docker tailscaled avahi-daemon

if ! command -v cosign >/dev/null; then
  cosign_arch="$(dpkg --print-architecture)"
  curl -fL "https://github.com/sigstore/cosign/releases/download/v2.5.3/cosign-linux-${cosign_arch}" -o /usr/local/bin/cosign
  chmod 0755 /usr/local/bin/cosign
fi

install -d -m 0755 "$ELISE_ROOT/releases" "$ELISE_STATE/backups" "$ELISE_CONFIG"
if getent group elise-agent >/dev/null; then
  AGENT_GID="$(getent group elise-agent | cut -d: -f3)"
else
  groupadd --system elise-agent
  AGENT_GID="$(getent group elise-agent | cut -d: -f3)"
fi

work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT
if [[ -n "$SOURCE_DIR" ]]; then
  VERSION="${ELISE_VERSION:-dev}"
  mkdir -p "$work_dir/runtime"
  cp -a "$SOURCE_DIR/." "$work_dir/runtime/"
else
  [[ "$VERSION" != __ELISE_VERSION__ ]] || VERSION="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPOSITORY/releases/latest" | sed 's#.*/tag/##')"
  asset="elise-runtime-${VERSION}.tar.gz"
  base="https://github.com/$REPOSITORY/releases/download/${VERSION}"
  progress "Téléchargement d’Élise OS ${VERSION}"
  curl -fL "$base/$asset" -o "$work_dir/$asset"
  curl -fL "$base/$asset.sha256" -o "$work_dir/$asset.sha256"
  curl -fL "$base/$asset.sigstore.json" -o "$work_dir/$asset.sigstore.json"
  (cd "$work_dir" && sha256sum -c "$asset.sha256") || fail "archive Élise non valide"
  cosign verify-blob "$work_dir/$asset" --bundle "$work_dir/$asset.sigstore.json" \
    --certificate-identity-regexp "^https://github.com/${REPOSITORY}/.github/workflows/release.yml@refs/tags/.*$" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com >/dev/null \
    || fail "signature de l’archive Élise non valide"
  mkdir "$work_dir/runtime"
  tar -xzf "$work_dir/$asset" -C "$work_dir/runtime"
fi

if [[ "$VERSION" != dev ]]; then
  base="https://github.com/$REPOSITORY/releases/download/${VERSION}"
  curl -fL "$base/release-manifest.json" -o "$work_dir/release-manifest.json"
  curl -fL "$base/release-manifest.json.sha256" -o "$work_dir/release-manifest.json.sha256"
  curl -fL "$base/release-manifest.json.sigstore.json" -o "$work_dir/release-manifest.json.sigstore.json"
  (cd "$work_dir" && sha256sum -c release-manifest.json.sha256) || fail "manifeste de version non valide"
  cosign verify-blob "$work_dir/release-manifest.json" --bundle "$work_dir/release-manifest.json.sigstore.json" \
    --certificate-identity-regexp "^https://github.com/${REPOSITORY}/.github/workflows/release.yml@refs/tags/.*$" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com >/dev/null \
    || fail "signature du manifeste non valide"
fi

release_dir="$ELISE_ROOT/releases/$VERSION"
if [[ ! -d "$release_dir" ]]; then
  mv "$work_dir/runtime" "$release_dir"
fi
previous="$(readlink -f "$ELISE_ROOT/current" 2>/dev/null || true)"
previous_env="$ELISE_STATE/previous.env"
[[ -f "$ELISE_CONFIG/elise.env" ]] && cp "$ELISE_CONFIG/elise.env" "$previous_env"
rollback_dump=""
if [[ -n "$previous" ]]; then
  old_compose=(docker compose --project-name michel-os --env-file "$previous_env" -f "$previous/compose.yaml" -f "$previous/compose.release.yaml")
  [[ "$(dpkg --print-architecture)" == arm64 ]] && old_compose+=(-f "$previous/compose.raspberry.yaml" -f "$previous/compose.raspberry.release.yaml")
  rollback_dump="$(mktemp "$ELISE_STATE/rollback-XXXXXXXX.dump")"
  chmod 600 "$rollback_dump"
  progress "Sauvegarde de sécurité avant la mise à jour"
  "${old_compose[@]}" exec -T postgres pg_dump -U michel --format=custom michel > "$rollback_dump" \
    || fail "impossible de sauvegarder la base avant la mise à jour"
fi
ln -sfn "$release_dir" "$ELISE_ROOT/current"

restore_previous() {
  [[ -n "$previous" ]] || return 0
  ln -sfn "$previous" "$ELISE_ROOT/current"
  cp "$previous_env" "$ELISE_CONFIG/elise.env"
  "${old_compose[@]}" up -d postgres
  if [[ -n "$rollback_dump" && -s "$rollback_dump" ]]; then
    "${old_compose[@]}" exec -T postgres pg_restore -U michel --clean --if-exists --dbname=michel < "$rollback_dump" \
      || echo "La restauration de la base doit être vérifiée manuellement : $rollback_dump" >&2
  fi
  "${old_compose[@]}" up -d
}

install -d -m 0755 /usr/lib/elise
install -m 0755 "$release_dir/appliance/remote-access-agent.py" /usr/lib/elise/remote-access-agent.py
install -m 0755 "$release_dir/install/elise" /usr/local/bin/elise
install -m 0644 "$release_dir/appliance/systemd/elise-remote-access-agent.service" /etc/systemd/system/
install -m 0755 "$release_dir/appliance/elise-tailscale-firewall.sh" /usr/lib/elise/elise-tailscale-firewall.sh
install -m 0644 "$release_dir/appliance/systemd/elise-tailscale-firewall.service" /etc/systemd/system/
printf 'ELISE_AGENT_GID=%s\n' "$AGENT_GID" > "$ELISE_CONFIG/agent.env"

if [[ ! -f "$ELISE_CONFIG/elise.env" ]]; then
  cp "$release_dir/.env.example" "$ELISE_CONFIG/elise.env"
fi
sed -i "s/^MICHEL_VERSION=.*/MICHEL_VERSION=$VERSION/" "$ELISE_CONFIG/elise.env"
sed -i "s/^ELISE_AGENT_GID=.*/ELISE_AGENT_GID=$AGENT_GID/" "$ELISE_CONFIG/elise.env"
hostname_value="$(hostname -s | tr '[:upper:]_' '[:lower:]-' | tr -cd 'a-z0-9-')"
http_port="$(sed -n 's/^MICHEL_HTTP_PORT=//p' "$ELISE_CONFIG/elise.env" | tail -1)"
local_suffix=":${http_port:-8080}"
[[ "${http_port:-8080}" == 80 ]] && local_suffix=""
sed -i "s|^MICHEL_LOCAL_URL=.*|MICHEL_LOCAL_URL=http://${hostname_value:-elise}.local${local_suffix}|" "$ELISE_CONFIG/elise.env"
if [[ -f "$work_dir/release-manifest.json" ]]; then
  sed -i '/^ELISE_.*_IMAGE=/d' "$ELISE_CONFIG/elise.env"
  python3 - "$work_dir/release-manifest.json" "$ELISE_CONFIG/elise.env" "$VERSION" <<'PY'
import json, re, sys
manifest = json.load(open(sys.argv[1], encoding="utf-8"))
if manifest.get("version") != sys.argv[3]:
    raise SystemExit("Le manifeste ne correspond pas à cette version d’Élise")
with open(sys.argv[2], "a", encoding="utf-8") as output:
    for name, image in manifest.get("images", {}).items():
        if not re.fullmatch(r"[a-z0-9]+", name) or not re.fullmatch(r"sha256:[a-f0-9]{64}", image["digest"]):
            raise SystemExit("Image de version invalide")
        output.write(f"ELISE_{name.upper()}_IMAGE={image['name']}@{image['digest']}\n")
PY
fi

systemctl daemon-reload
systemctl enable --now elise-remote-access-agent.service elise-tailscale-firewall.service

progress "Détection des équipements Zigbee"
"$release_dir/scripts/detect-zigbee-adapter.sh" --write-env "$ELISE_CONFIG/elise.env" || true

compose=(docker compose --project-name michel-os --env-file "$ELISE_CONFIG/elise.env" -f "$release_dir/compose.yaml" -f "$release_dir/compose.release.yaml")
if [[ "$(dpkg --print-architecture)" == arm64 ]]; then
  compose+=(-f "$release_dir/compose.raspberry.yaml" -f "$release_dir/compose.raspberry.release.yaml")
fi
progress "Téléchargement des composants Élise"
if ! "${compose[@]}" pull; then
  if [[ -n "$previous" ]]; then
    ln -sfn "$previous" "$ELISE_ROOT/current"
    cp "$previous_env" "$ELISE_CONFIG/elise.env"
  fi
  [[ -n "$rollback_dump" ]] && rm -f -- "$rollback_dump"
  fail "le téléchargement a été interrompu ; relancez la même commande"
fi
progress "Démarrage et vérification d’Élise"
if [[ "${ELISE_FIRST_BOOT:-false}" == true ]]; then systemctl stop elise-preparation.service || true; fi
if ! "${compose[@]}" up -d; then
  "${compose[@]}" down || true
  restore_previous
  fail "le démarrage a échoué ; la version précédente a été restaurée"
fi

deadline=$((SECONDS + 300))
until curl --fail --silent "http://127.0.0.1:$(sed -n 's/^MICHEL_HTTP_PORT=//p' "$ELISE_CONFIG/elise.env" | tail -1)/api/v1/system/health" >/dev/null; do
  if (( SECONDS >= deadline )); then
    "${compose[@]}" down || true
    restore_previous
    fail "les contrôles de santé ont échoué ; retour à la version précédente"
  fi
  sleep 3
done

if [[ -n "$rollback_dump" ]]; then rm -f -- "$rollback_dump"; fi

progress "Élise est prête"
echo "✓ Ouvrez http://${hostname_value:-elise}.local${local_suffix}"
echo "  L’accès privé Tailscale se configure dans l’assistant ou dans Réglages."
