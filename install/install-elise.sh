#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="${ELISE_REPOSITORY:-Elise-OS/EliseOS}"
VERSION="${ELISE_VERSION:-__ELISE_VERSION__}"
ELISE_ROOT="${ELISE_ROOT:-/opt/elise}"
ELISE_STATE="${ELISE_STATE:-/var/lib/elise}"
ELISE_CONFIG="${ELISE_CONFIG:-/etc/elise}"
SOURCE_DIR="${ELISE_SOURCE_DIR:-}"
GITHUB_AUTH_FILE="${ELISE_GITHUB_AUTH_FILE:-$ELISE_CONFIG/github-auth}"
GITHUB_API="${ELISE_GITHUB_API:-https://api.github.com}"
GITHUB_USERNAME=""
GITHUB_TOKEN=""
docker_config_dir=""
UPDATE_LOCK_FILE="${ELISE_UPDATE_LOCK_FILE:-/run/elise-update/update.lock}"

preparation_status() {
  [[ -d /run/elise-preparation ]] || return 0
  local message="${1//\\/\\\\}"
  message="${message//\"/\\\"}"
  printf '{"message":"%s","updatedAt":"%s","error":%s}\n' "$message" "$(date -u +%FT%TZ)" "${2:-false}" \
    > /run/elise-preparation/status.json
}
fail() {
  echo "Erreur : $*" >&2
  [[ "${ELISE_FIRST_BOOT:-false}" != true ]] \
    || preparation_status "Erreur : $*. Élise réessaiera automatiquement dans une minute." true
  exit 1
}
progress() {
  echo "→ $*"
  preparation_status "$*"
}

if [[ -f "$GITHUB_AUTH_FILE" ]]; then
  GITHUB_USERNAME="$(sed -n 's/^username=//p' "$GITHUB_AUTH_FILE" | tail -1)"
  GITHUB_TOKEN="$(sed -n 's/^token=//p' "$GITHUB_AUTH_FILE" | tail -1)"
fi

github_get() {
  # A public repository needs no account; the bot only unlocks a private one.
  local auth=()
  [[ -z "$GITHUB_TOKEN" ]] || auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  curl -fsSL \
    -H "Accept: ${GITHUB_ACCEPT:-application/vnd.github+json}" \
    "${auth[@]}" \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    -H 'User-Agent: elise-os-installer' \
    "$@"
}
github_release() {
  github_get "$GITHUB_API/repos/$REPOSITORY/releases/$1" && return 0
  [[ -n "$GITHUB_TOKEN" ]] || fail "dépôt Élise privé : configurez le compte bot GitHub"
  fail "release Élise introuvable : $1"
}

download_release_asset() {
  local release_json="$1"
  local asset_name="$2"
  local destination="$3"
  local asset_id
  asset_id="$(python3 - "$release_json" "$asset_name" <<'PY'
import json, sys
release = json.load(open(sys.argv[1], encoding='utf-8'))
for asset in release.get('assets', []):
    if asset.get('name') == sys.argv[2] and asset.get('state') == 'uploaded':
        print(asset['id'])
        break
else:
    raise SystemExit(f'asset absent: {sys.argv[2]}')
PY
)" || fail "asset GitHub absent : $asset_name"
  # GitHub honours only the first Accept header: a second one returns the asset's JSON.
  GITHUB_ACCEPT=application/octet-stream github_get \
    "$GITHUB_API/repos/$REPOSITORY/releases/assets/$asset_id" -o "$destination" \
    || fail "téléchargement impossible : $asset_name"
}

[[ "${EUID}" -eq 0 ]] || fail "l’installation doit être lancée avec sudo"
install -d -m 0755 "$(dirname "$UPDATE_LOCK_FILE")"
if [[ "${ELISE_UPDATE_LOCK_HELD:-false}" != true ]]; then
  exec 9>"$UPDATE_LOCK_FILE"
  flock -n 9 || fail "une mise à jour est déjà en cours"
fi
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

if [[ "${ELISE_SKIP_SYSTEM_PACKAGES:-false}" != true ]]; then
  progress "Installation de Docker, Tailscale et des services réseau"
  export DEBIAN_FRONTEND=noninteractive
  # A fresh Ubuntu runs unattended-upgrades right after boot: wait for its dpkg lock.
  apt=(apt-get -o DPkg::Lock::Timeout=900)
  "${apt[@]}" update -qq
  "${apt[@]}" install -y -qq age ca-certificates curl gnupg avahi-daemon docker.io docker-compose-v2 nftables python3 xz-utils
  install -d -m 0755 /usr/share/keyrings
  if [[ ! -f /usr/share/keyrings/tailscale-archive-keyring.gpg ]]; then
    curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg
    curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list
    "${apt[@]}" update -qq
  fi
  "${apt[@]}" install -y -qq tailscale
fi
systemctl enable --now docker tailscaled avahi-daemon

if ! command -v cosign >/dev/null; then
  progress "Installation de l’outil de vérification des signatures"
  cosign_arch="$(dpkg --print-architecture)"
  case "$cosign_arch" in
    amd64) cosign_sha256=783b5d6c74105401c63946c68d9b2a4e1aab3c8abce043e06b8510b02b623ec9 ;;
    arm64) cosign_sha256=bffabe4cf183122b7de3111257a863c99e7dc6cf1093bfd7bf961de1795589b8 ;;
  esac
  curl -fsSL "https://github.com/sigstore/cosign/releases/download/v2.5.3/cosign-linux-${cosign_arch}" -o /usr/local/bin/cosign.download \
    || fail "téléchargement de cosign impossible"
  echo "$cosign_sha256  /usr/local/bin/cosign.download" | sha256sum -c - >/dev/null \
    || { rm -f /usr/local/bin/cosign.download; fail "cosign téléchargé non valide"; }
  chmod 0755 /usr/local/bin/cosign.download
  mv /usr/local/bin/cosign.download /usr/local/bin/cosign
fi

install -d -m 0755 "$ELISE_ROOT/releases" "$ELISE_STATE/backups" "$ELISE_CONFIG"
if getent group elise-agent >/dev/null; then
  AGENT_GID="$(getent group elise-agent | cut -d: -f3)"
else
  groupadd --system elise-agent
  AGENT_GID="$(getent group elise-agent | cut -d: -f3)"
fi

work_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "$work_dir"
  [[ -z "$docker_config_dir" ]] || rm -rf -- "$docker_config_dir"
}
trap cleanup EXIT
if [[ -n "$SOURCE_DIR" ]]; then
  VERSION="${ELISE_VERSION:-dev}"
  mkdir -p "$work_dir/runtime"
  cp -a "$SOURCE_DIR/." "$work_dir/runtime/"
else
  [[ "$VERSION" != __ELISE_VERSION__ ]] || VERSION="$(github_release latest | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')"
  asset="elise-runtime-${VERSION}.tar.gz"
  progress "Téléchargement d’Élise OS ${VERSION}"
  release_json="$work_dir/release.json"
  github_release "tags/$VERSION" > "$release_json"
  python3 - "$release_json" "$VERSION" <<'PY'
import json, sys
release = json.load(open(sys.argv[1], encoding='utf-8'))
if release.get('tag_name') != sys.argv[2] or release.get('draft') or release.get('prerelease'):
    raise SystemExit('La release demandée n’est pas une version stable publiée')
PY
  download_release_asset "$release_json" "$asset" "$work_dir/$asset"
  download_release_asset "$release_json" "$asset.sha256" "$work_dir/$asset.sha256"
  download_release_asset "$release_json" "$asset.sigstore.json" "$work_dir/$asset.sigstore.json"
  (cd "$work_dir" && sha256sum -c "$asset.sha256") || fail "archive Élise non valide"
  cosign verify-blob "$work_dir/$asset" --bundle "$work_dir/$asset.sigstore.json" \
    --certificate-identity-regexp "^https://github.com/${REPOSITORY}/.github/workflows/release.yml@refs/heads/main$" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com >/dev/null \
    || fail "signature de l’archive Élise non valide"
  mkdir "$work_dir/runtime"
  tar -xzf "$work_dir/$asset" -C "$work_dir/runtime"
fi

if [[ "$VERSION" != dev ]]; then
  [[ -n "${release_json:-}" ]] || {
    release_json="$work_dir/release.json"
    github_release "tags/$VERSION" > "$release_json"
    python3 - "$release_json" "$VERSION" <<'PY'
import json, sys
release = json.load(open(sys.argv[1], encoding='utf-8'))
if release.get('tag_name') != sys.argv[2] or release.get('draft') or release.get('prerelease'):
    raise SystemExit('La release demandée n’est pas une version stable publiée')
PY
  }
  download_release_asset "$release_json" release-manifest.json "$work_dir/release-manifest.json"
  download_release_asset "$release_json" release-manifest.json.sha256 "$work_dir/release-manifest.json.sha256"
  download_release_asset "$release_json" release-manifest.json.sigstore.json "$work_dir/release-manifest.json.sigstore.json"
  (cd "$work_dir" && sha256sum -c release-manifest.json.sha256) || fail "manifeste de version non valide"
  cosign verify-blob "$work_dir/release-manifest.json" --bundle "$work_dir/release-manifest.json.sigstore.json" \
    --certificate-identity-regexp "^https://github.com/${REPOSITORY}/.github/workflows/release.yml@refs/heads/main$" \
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
install -m 0755 "$release_dir/appliance/elise-update-agent.py" /usr/lib/elise/elise-update-agent.py
install -m 0755 "$release_dir/install/elise" /usr/local/bin/elise
install -m 0644 "$release_dir/appliance/systemd/elise-remote-access-agent.service" /etc/systemd/system/
install -m 0644 "$release_dir/appliance/systemd/elise-update-agent.service" /etc/systemd/system/
install -m 0755 "$release_dir/appliance/elise-tailscale-firewall.sh" /usr/lib/elise/elise-tailscale-firewall.sh
install -m 0644 "$release_dir/appliance/systemd/elise-tailscale-firewall.service" /etc/systemd/system/
install -m 0755 "$release_dir/appliance/elise-screen-setup.sh" /usr/lib/elise/elise-screen-setup
install -m 0644 "$release_dir/appliance/systemd/elise-screen-setup.service" /etc/systemd/system/
install -m 0644 "$release_dir/appliance/systemd/elise-screen-setup.timer" /etc/systemd/system/
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
systemctl enable --now elise-remote-access-agent.service elise-update-agent.service elise-tailscale-firewall.service

progress "Détection des équipements Zigbee"
"$release_dir/scripts/detect-zigbee-adapter.sh" --write-env "$ELISE_CONFIG/elise.env" || true

compose=(docker compose --project-name michel-os --env-file "$ELISE_CONFIG/elise.env" -f "$release_dir/compose.yaml" -f "$release_dir/compose.release.yaml")
if [[ "$(dpkg --print-architecture)" == arm64 ]]; then
  compose+=(-f "$release_dir/compose.raspberry.yaml" -f "$release_dir/compose.raspberry.release.yaml")
fi
if [[ "$VERSION" == dev ]]; then
  compose=(docker compose --project-name michel-os --env-file "$ELISE_CONFIG/elise.env" -f "$release_dir/compose.yaml")
  if [[ "$(dpkg --print-architecture)" == arm64 ]]; then
    compose+=(-f "$release_dir/compose.raspberry.yaml")
  fi
elif [[ -n "$GITHUB_TOKEN" ]]; then
  docker_config_dir="$(mktemp -d "$ELISE_STATE/docker-auth-XXXXXXXX")"
  chmod 700 "$docker_config_dir"
  printf '%s' "$GITHUB_TOKEN" | DOCKER_CONFIG="$docker_config_dir" docker login ghcr.io \
    --username "$GITHUB_USERNAME" --password-stdin >/dev/null \
    || fail "authentification GHCR impossible avec le compte bot"
  export DOCKER_CONFIG="$docker_config_dir"
fi
if [[ "$VERSION" == dev ]]; then
  progress "Construction des composants Élise"
  pull_or_build=(up -d --build)
else
  progress "Téléchargement des composants Élise"
  pull_or_build=(pull)
fi
if ! "${compose[@]}" "${pull_or_build[@]}"; then
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

if [[ "$(sed -n 's/^ELISE_SCREEN_ENABLED=//p' "$ELISE_CONFIG/elise.env" | tail -1)" == true ]]; then
  progress "Planification de l’écran et de Jitsi"
  systemctl enable --now elise-screen-setup.timer
  # Do not block the core installation if private-network pairing still awaits the user.
  systemctl start --no-block elise-screen-setup.service || true
else
  systemctl disable --now elise-screen-setup.timer 2>/dev/null || true
fi

progress "Élise est prête"
echo "✓ Ouvrez http://${hostname_value:-elise}.local${local_suffix}"
echo "  L’accès privé Tailscale se configure dans l’assistant ou dans Réglages."
