#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${MICHEL_NAS_CONFIG:-$ROOT_DIR/config/nas-deploy.env}"
DRY_RUN=false
SERVICES=(ai api worker dashboard)

usage() {
  cat <<'EOF'
Usage: pnpm deploy:nas [--dashboard] [--dry-run]

Synchronises the current working tree to the configured Michel OS test NAS,
then rebuilds and restarts only ai, api, worker and dashboard.

Options:
  --dashboard Rebuild and restart only the Dashboard (fast interface preview).
  --dry-run  Show files that would be synchronised without changing the NAS.
  -h, --help Show this help.
EOF
}

while (($#)); do
  case "$1" in
    --dashboard) SERVICES=(dashboard) ;;
    --dry-run) DRY_RUN=true ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Missing NAS configuration: $CONFIG_FILE" >&2
  echo "Copy config/nas-deploy.env.example to config/nas-deploy.env first." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$CONFIG_FILE"

: "${MICHEL_NAS_TARGET:?MICHEL_NAS_TARGET is required}"
: "${MICHEL_NAS_PATH:?MICHEL_NAS_PATH is required}"
: "${MICHEL_NAS_URL:?MICHEL_NAS_URL is required}"
: "${MICHEL_NAS_HTTP_PORT:?MICHEL_NAS_HTTP_PORT is required}"

if [[ ! "$MICHEL_NAS_PATH" =~ ^/home/drsam/michel-os/?$ ]]; then
  echo "Refusing unsafe remote path: $MICHEL_NAS_PATH" >&2
  exit 1
fi

if [[ ! "$MICHEL_NAS_HTTP_PORT" =~ ^[0-9]{1,5}$ ]]; then
  echo "MICHEL_NAS_HTTP_PORT must be a valid port." >&2
  exit 1
fi

if ! command -v rsync >/dev/null || ! command -v ssh >/dev/null; then
  echo "rsync and ssh are required on this Mac." >&2
  exit 1
fi

if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$MICHEL_NAS_TARGET" \
  "test -f '$MICHEL_NAS_PATH/compose.yaml' && command -v docker >/dev/null"; then
  echo "Cannot reach the Michel NAS through SSH or its project is unavailable." >&2
  exit 1
fi

RSYNC_ARGS=(
  --archive
  --compress
  --human-readable
  --itemize-changes
  --delete-delay
  --include='.env.example'
  --exclude='.env'
  --exclude='.env.*'
  --exclude='.git/'
  --exclude='node_modules/'
  --exclude='dist/'
  --exclude='build/'
  --exclude='coverage/'
  --exclude='.turbo/'
  --exclude='.ruff_cache/'
  --exclude='.pytest_cache/'
  --exclude='__pycache__/'
  --exclude='*.pyc'
  --exclude='*.tsbuildinfo'
  --exclude='*.log'
  --exclude='.DS_Store'
  --exclude='apps/api/src/generated/'
  --exclude='apps/ai/.venv/'
  --exclude='config/nas-deploy.env'
  --exclude='docker/*/data/'
  --exclude='secrets/'
  --exclude='backups/'
)

if [[ "$DRY_RUN" == true ]]; then
  RSYNC_ARGS+=(--dry-run)
fi

echo "→ Synchronisation vers $MICHEL_NAS_TARGET:$MICHEL_NAS_PATH"
rsync "${RSYNC_ARGS[@]}" "$ROOT_DIR/" "$MICHEL_NAS_TARGET:$MICHEL_NAS_PATH/"

if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run complete. No file or service was changed on the NAS."
  exit 0
fi

SERVICE_LIST="${SERVICES[*]}"
echo "→ Build Docker sur le NAS ($SERVICE_LIST)"
REMOTE_COMMAND="REMOTE_PATH=$(printf '%q' "$MICHEL_NAS_PATH") REMOTE_PORT=$(printf '%q' "$MICHEL_NAS_HTTP_PORT") REMOTE_SERVICES=$(printf '%q' "$SERVICE_LIST") bash -se"
ssh "$MICHEL_NAS_TARGET" "$REMOTE_COMMAND" <<'REMOTE_SCRIPT'
set -o pipefail
cd "$REMOTE_PATH"
read -r -a services <<<"$REMOTE_SERVICES"

show_logs() {
  echo >&2
  echo "Deployment failed. Recent Michel application logs:" >&2
  docker compose logs --tail=100 "${services[@]}" >&2 || true
}

if ! docker compose build "${services[@]}"; then
  show_logs
  exit 1
fi

if ! docker compose up -d --no-deps "${services[@]}"; then
  show_logs
  exit 1
fi

deadline=$((SECONDS + 180))
until curl --fail --silent --show-error "http://127.0.0.1:${REMOTE_PORT}/api/v1/system/health" >/dev/null \
  && curl --fail --silent --show-error "http://127.0.0.1:${REMOTE_PORT}/" >/dev/null; do
  if ((SECONDS >= deadline)); then
    show_logs
    exit 1
  fi
  sleep 3
done

docker compose ps --format 'table {{.Service}}\t{{.Status}}'
REMOTE_SCRIPT

echo "✓ Michel OS is ready: $MICHEL_NAS_URL"
