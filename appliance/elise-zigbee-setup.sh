#!/usr/bin/env bash
# Detects the plugged Zigbee coordinator and starts Zigbee2MQTT with the driver that answers.
# Started at boot, after each installation and by udev whenever a USB serial adapter
# appears or disappears.
set -euo pipefail

ELISE_ROOT_DIR="${ELISE_ROOT_DIR:-/opt/elise}"
ELISE_CONFIG_FILE="${ELISE_CONFIG_FILE:-/etc/elise/elise.env}"
STATE_DIR="${ELISE_ZIGBEE_STATE_DIR:-/var/lib/elise/zigbee}"
SERIAL_DIR="${MICHEL_SERIAL_BY_ID_DIR:-/dev/serial/by-id}"
CACHE_FILE="$STATE_DIR/adapters"
STATUS_FILE="$STATE_DIR/status.json"
TRY_SECONDS="${ELISE_ZIGBEE_TRY_SECONDS:-75}"
# Most common coordinator families first: Silicon Labs, Texas Instruments, then the rest.
DRIVERS=(ember zstack zigate deconz zboss)

[[ -L "$ELISE_ROOT_DIR/current" && -f "$ELISE_CONFIG_FILE" ]] || exit 0
release_dir="$(readlink -f "$ELISE_ROOT_DIR/current")"
install -d -m 0755 "$STATE_DIR"
exec 9>"$STATE_DIR/.lock"
flock 9

env_value() { sed -n "s/^$1=//p" "$ELISE_CONFIG_FILE" | tail -1; }
set_env_value() {
  if grep -q "^$1=" "$ELISE_CONFIG_FILE"; then
    sed -i "s|^$1=.*|$1=$2|" "$ELISE_CONFIG_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ELISE_CONFIG_FILE"
  fi
}
write_status() {
  python3 - "$STATUS_FILE" "$@" <<'PY'
import json, os, sys
from datetime import datetime, timezone
path, state, message, adapter, driver = sys.argv[1:6]
value = {"state": state, "message": message, "adapter": adapter or None, "driver": driver or None,
         "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
with open(path + ".tmp", "w", encoding="utf-8") as output:
    json.dump(value, output, ensure_ascii=False)
os.replace(path + ".tmp", path)
PY
  echo "Zigbee : $2"
}
remember_driver() {
  local cache_tmp
  cache_tmp="$(mktemp "$CACHE_FILE.XXXXXX")"
  { grep -v "^$1=" "$CACHE_FILE" 2>/dev/null || true; printf '%s=%s\n' "$1" "$2"; } > "$cache_tmp"
  mv "$cache_tmp" "$CACHE_FILE"
}
serial_snapshot() { find "$SERIAL_DIR" -mindepth 1 -maxdepth 1 -type l 2>/dev/null | sort | tr '\n' ' '; }

compose=(
  docker compose --project-name michel-os --env-file "$ELISE_CONFIG_FILE"
  -f "$release_dir/compose.yaml" -f "$release_dir/compose.release.yaml"
)
if [[ "$(uname -m)" == aarch64 ]]; then
  compose+=(-f "$release_dir/compose.raspberry.yaml" -f "$release_dir/compose.raspberry.release.yaml")
fi
[[ "$(env_value MICHEL_VERSION)" == dev ]] && compose=(
  docker compose --project-name michel-os --env-file "$ELISE_CONFIG_FILE" -f "$release_dir/compose.yaml"
)

container_id() { "${compose[@]}" ps -q zigbee2mqtt 2>/dev/null || true; }
# A freshly recreated container only holds the logs of the driver being tried.
started_with() {
  local id
  id="$(container_id)"
  [[ -n "$id" ]] || return 1
  [[ "$(docker inspect -f '{{range .HostConfig.Devices}}{{.PathOnHost}}{{end}}' "$id" 2>/dev/null)" == "$1" ]] || return 1
  [[ "$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$id" 2>/dev/null \
    | sed -n 's/^MICHEL_ZIGBEE_ADAPTER_TYPE=//p')" == "$2" ]] || return 1
  docker logs "$id" 2>&1 | grep -q 'Zigbee2MQTT started'
}
try_driver() {
  local adapter="$1" driver="$2" id deadline
  set_env_value ZIGBEE_ADAPTER_TYPE "$driver"
  "${compose[@]}" up -d --no-deps --force-recreate zigbee2mqtt >/dev/null 2>&1 || return 1
  deadline=$((SECONDS + TRY_SECONDS))
  while ((SECONDS < deadline)); do
    sleep 3
    id="$(container_id)"
    [[ -n "$id" ]] || continue
    if docker logs "$id" 2>&1 | grep -q 'Zigbee2MQTT started'; then return 0; fi
    if docker logs "$id" 2>&1 | grep -qE 'Failed to start zigbee-herdsman|Exiting\.\.\.'; then return 1; fi
  done
  return 1
}

detect_once() {
  local adapter driver candidates=()
  if [[ "$(env_value ZIGBEE_ADAPTER_MODE)" == manual ]]; then
    write_status manual "Configuration Zigbee manuelle conservée." "$(env_value ZIGBEE_ADAPTER)" "$(env_value ZIGBEE_ADAPTER_TYPE)"
    return 0
  fi
  if ! ZIGBEE_ADAPTER_CACHE="$CACHE_FILE" "$release_dir/scripts/detect-zigbee-adapter.sh" --write-env "$ELISE_CONFIG_FILE" >/dev/null 2>&1; then
    write_status multiple "Plusieurs adaptateurs série sont branchés : laissez uniquement la clé Zigbee." "" ""
    return 0
  fi
  adapter="$(env_value ZIGBEE_ADAPTER)"
  driver="$(env_value ZIGBEE_ADAPTER_TYPE)"
  if [[ -z "$adapter" || "$adapter" == /dev/null ]]; then
    # Without a coordinator Zigbee2MQTT would only restart in a loop.
    "${compose[@]}" stop zigbee2mqtt >/dev/null 2>&1 || true
    write_status none "Aucune clé Zigbee branchée." "" ""
    return 0
  fi
  if [[ "$driver" != auto ]] && started_with "$adapter" "$driver"; then
    write_status ready "Clé Zigbee prête." "$adapter" "$driver"
    return 0
  fi

  # A known or remembered driver is tried first, then every other family.
  [[ "$driver" != auto ]] && candidates+=("$driver")
  for candidate in "${DRIVERS[@]}"; do
    [[ "$candidate" == "$driver" ]] || candidates+=("$candidate")
  done
  for candidate in "${candidates[@]}"; do
    write_status detecting "Recherche du pilote de la clé Zigbee ($candidate)…" "$adapter" "$candidate"
    if try_driver "$adapter" "$candidate"; then
      remember_driver "$adapter" "$candidate"
      write_status ready "Clé Zigbee prête." "$adapter" "$candidate"
      return 0
    fi
  done
  set_env_value ZIGBEE_ADAPTER_TYPE auto
  "${compose[@]}" stop zigbee2mqtt >/dev/null 2>&1 || true
  write_status unsupported "Clé Zigbee non reconnue : vérifiez qu’elle porte un micrologiciel coordinateur." "$adapter" ""
}

udevadm settle --timeout=10 2>/dev/null || true
# A key plugged or removed while drivers were tried is handled in another pass.
for _ in 1 2 3; do
  before="$(serial_snapshot)"
  detect_once
  [[ "$(serial_snapshot)" == "$before" ]] && break
done
