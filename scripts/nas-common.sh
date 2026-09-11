#!/usr/bin/env bash

set -euo pipefail

NAS_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAS_CONFIG_FILE="${MICHEL_NAS_CONFIG:-$NAS_ROOT_DIR/config/nas-deploy.env}"

load_nas_config() {
  if [[ ! -f "$NAS_CONFIG_FILE" ]]; then
    echo "Configuration NAS absente : $NAS_CONFIG_FILE" >&2
    echo "Copiez config/nas-deploy.env.example vers config/nas-deploy.env." >&2
    exit 1
  fi

  # shellcheck disable=SC1090
  source "$NAS_CONFIG_FILE"

  : "${MICHEL_NAS_TARGET:?MICHEL_NAS_TARGET est requis}"
  : "${MICHEL_NAS_PATH:?MICHEL_NAS_PATH est requis}"
  : "${MICHEL_NAS_URL:?MICHEL_NAS_URL est requis}"
  : "${MICHEL_NAS_HTTP_PORT:?MICHEL_NAS_HTTP_PORT est requis}"

  if [[ ! "$MICHEL_NAS_PATH" =~ ^/home/drsam/michel-os/?$ ]]; then
    echo "Chemin distant refusé par sécurité : $MICHEL_NAS_PATH" >&2
    exit 1
  fi
  if [[ ! "$MICHEL_NAS_HTTP_PORT" =~ ^[0-9]{1,5}$ ]]; then
    echo "Port HTTP invalide : $MICHEL_NAS_HTTP_PORT" >&2
    exit 1
  fi
  if ! command -v ssh >/dev/null; then
    echo "La commande ssh est requise sur le Mac." >&2
    exit 1
  fi
}

confirm_action() {
  local expected="$1"
  local prompt="$2"

  if [[ "${NAS_ASSUME_YES:-false}" == "true" ]]; then
    return
  fi

  echo "$prompt"
  printf 'Tapez exactement « %s » pour continuer : ' "$expected"
  read -r answer
  if [[ "$answer" != "$expected" ]]; then
    echo "Opération annulée."
    exit 1
  fi
}

remote_shell_command() {
  local services_path
  local http_port
  services_path="$(printf '%q' "$MICHEL_NAS_PATH")"
  http_port="$(printf '%q' "$MICHEL_NAS_HTTP_PORT")"
  printf 'REMOTE_PATH=%s REMOTE_PORT=%s bash -se' "$services_path" "$http_port"
}
