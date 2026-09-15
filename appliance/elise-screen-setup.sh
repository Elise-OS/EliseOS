#!/usr/bin/env bash
# Complete the resident TV installation as soon as the private Tailscale identity is ready.
set -euo pipefail

ELISE_ROOT_DIR="${ELISE_ROOT_DIR:-/opt/elise}"
ELISE_STATE_DIR="${ELISE_STATE_DIR:-/var/lib/elise}"
ELISE_CONFIG_FILE="${ELISE_CONFIG_FILE:-/etc/elise/elise.env}"
complete_marker="$ELISE_STATE_DIR/.screen-setup-complete"

[[ -f "$complete_marker" ]] && exit 0
[[ -f "$ELISE_CONFIG_FILE" ]] || exit 0

screen_enabled="$(sed -n 's/^ELISE_SCREEN_ENABLED=//p' "$ELISE_CONFIG_FILE" | tail -1)"
[[ "$screen_enabled" == true ]] || exit 0

release_dir="$(readlink -f "$ELISE_ROOT_DIR/current" 2>/dev/null || true)"
[[ -n "$release_dir" && -d "$release_dir" ]] || exit 0

if ! tailscale status --json 2>/dev/null \
  | python3 -c 'import json,sys;sys.exit(0 if json.load(sys.stdin).get("BackendState")=="Running" else 1)'; then
  echo "Écran Élise en attente de l’association Tailscale."
  exit 0
fi

echo "→ Installation automatique de Jitsi et de l’affichage résident"
ELISE_APPLICATION_ENV="$ELISE_CONFIG_FILE" bash "$release_dir/scripts/install-jitsi.sh"

compose=(
  docker compose --project-name michel-os --env-file "$ELISE_CONFIG_FILE"
  -f "$release_dir/compose.yaml" -f "$release_dir/compose.release.yaml"
)
if [[ "$(uname -m)" == aarch64 ]]; then
  compose+=(
    -f "$release_dir/compose.raspberry.yaml"
    -f "$release_dir/compose.raspberry.release.yaml"
  )
fi
# Both services consume the generated Jitsi settings at container creation.
"${compose[@]}" up -d --no-deps api dashboard

screen_url="$(tailscale status --json \
  | python3 -c 'import json,sys;print("https://"+json.load(sys.stdin)["Self"]["DNSName"].rstrip(".")+":8443")')"
bash "$release_dir/scripts/install-screen.sh" "$screen_url"

install -d -m 0755 "$ELISE_STATE_DIR"
touch "$complete_marker"
echo "✓ Affichage TV et appels vidéo prêts."
