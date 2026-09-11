#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAS_CONFIG_FILE="${MICHEL_NAS_CONFIG:-$ROOT_DIR/config/nas-deploy.env}"
API_TARGET="${MICHEL_DEV_API_TARGET:-}"
DEV_PORT="${MICHEL_DEV_PORT:-5173}"
FORCE_INSTALL=false
OPEN_BROWSER=true

usage() {
  cat <<'EOF'
Usage : bash scripts/dev-dashboard.sh [options]

Lance uniquement le frontend Élise OS sur le Mac. Les appels /api sont envoyés
vers le NAS ; aucun conteneur Docker ni service backend n'est lancé localement.

Options :
  --api URL     Adresse d'Élise OS sur le NAS.
  --port PORT   Port local de Vite (5173 par défaut).
  --install     Réinstaller les dépendances du frontend.
  --no-open     Ne pas ouvrir automatiquement le navigateur.
  -h, --help    Afficher cette aide.
EOF
}

while (($#)); do
  case "$1" in
    --api)
      if (($# < 2)); then
        echo "L'option --api nécessite une URL." >&2
        exit 2
      fi
      API_TARGET="$2"
      shift
      ;;
    --port)
      if (($# < 2)); then
        echo "L'option --port nécessite un numéro de port." >&2
        exit 2
      fi
      DEV_PORT="$2"
      shift
      ;;
    --install) FORCE_INSTALL=true ;;
    --no-open) OPEN_BROWSER=false ;;
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

if [[ ! "$DEV_PORT" =~ ^[0-9]{1,5}$ ]] || ((DEV_PORT < 1 || DEV_PORT > 65535)); then
  echo "Port local invalide : $DEV_PORT" >&2
  exit 1
fi

if [[ -z "$API_TARGET" && -f "$NAS_CONFIG_FILE" ]]; then
  # Lire uniquement l'URL ; ne pas exécuter le fichier de configuration.
  API_TARGET="$(sed -n 's/^MICHEL_NAS_URL=//p' "$NAS_CONFIG_FILE" | tail -n 1)"
fi
API_TARGET="${API_TARGET:-http://192.168.1.55:8090}"
API_TARGET="${API_TARGET%/}"

if [[ ! "$API_TARGET" =~ ^https?://[^[:space:]]+$ ]]; then
  echo "URL d'API invalide : $API_TARGET" >&2
  exit 1
fi

if ! command -v node >/dev/null; then
  echo "Node.js 22 à 26 est requis pour lancer le frontend." >&2
  exit 1
fi

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if ((node_major < 22 || node_major >= 27)); then
  echo "Version Node.js incompatible : $(node --version). Utilisez Node.js 22 à 26." >&2
  exit 1
fi

if command -v pnpm >/dev/null; then
  PNPM=(pnpm)
elif command -v corepack >/dev/null; then
  PNPM=(corepack pnpm)
else
  echo "pnpm 11 ou Corepack est requis." >&2
  exit 1
fi

cd "$ROOT_DIR"

if [[ "$FORCE_INSTALL" == true || ! -x apps/dashboard/node_modules/.bin/vite ]]; then
  echo "Installation des dépendances du frontend uniquement…"
  "${PNPM[@]}" install --filter '@michel/dashboard...' --frozen-lockfile
fi

if command -v curl >/dev/null \
  && ! curl --fail --silent --max-time 5 "$API_TARGET/api/v1/system/health" >/dev/null; then
  echo "Attention : l'API du NAS ne répond pas encore sur $API_TARGET" >&2
fi

echo "Frontend local : http://127.0.0.1:$DEV_PORT"
echo "API distante    : $API_TARGET"
echo "Arrêt           : Ctrl+C"

vite_args=(--host 127.0.0.1 --port "$DEV_PORT")
if [[ "$OPEN_BROWSER" == true ]]; then
  vite_args+=(--open)
fi

export MICHEL_DEV_API_TARGET="$API_TARGET"
exec "${PNPM[@]}" --filter @michel/dashboard exec vite "${vite_args[@]}"
