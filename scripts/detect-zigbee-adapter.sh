#!/usr/bin/env bash

set -euo pipefail

SERIAL_DIR="${MICHEL_SERIAL_BY_ID_DIR:-/dev/serial/by-id}"
# Drivers confirmed by elise-zigbee-setup for adapters whose USB name says nothing.
CACHE_FILE="${ZIGBEE_ADAPTER_CACHE:-/var/lib/elise/zigbee/adapters}"
ENV_FILE=""
CLASSIFY_NAME=""

usage() {
  cat <<'EOF'
Usage: scripts/detect-zigbee-adapter.sh [--write-env FILE] [--classify NAME]

Détecte un coordinateur Zigbee USB et détermine le pilote Zigbee2MQTT.
La variable MICHEL_SERIAL_BY_ID_DIR permet d'utiliser un dossier différent pour les tests.
EOF
}

while (($#)); do
  case "$1" in
    --write-env)
      ENV_FILE="${2:-}"
      shift
      ;;
    --classify)
      CLASSIFY_NAME="${2:-}"
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

classify_adapter() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"

  case "$value" in
    *conbee* | *dresden_elektronik* | *dresden-electronik* | *raspbee*)
      printf 'deconz\n'
      ;;
    *zigate*)
      printf 'zigate\n'
      ;;
    *zboss* | *nrf52840*zigbee*)
      printf 'zboss\n'
      ;;
    *zbdongle-p* | *dongle_plus_p* | *cc2530* | *cc2531* | *cc2652* | *cc1352* | *ti_cc* | *texas_instruments* | *electrolama* | *zzh* | *slae.sh* | *tubeszb*ti* | *zigstar*ti*)
      printf 'zstack\n'
      ;;
    *zbdongle-e* | *sonoff*dongle*plus_v2* | *dongle_plus_e* | *dongle_lite_mg* | *efr32* | *mg21* | *mg24* | *ember* | *skyconnect* | *connect_zbt-1* | *connect_zbt_1* | *nabu_casa* | *silicon_labs*)
      printf 'ember\n'
      ;;
    *)
      printf 'auto\n'
      ;;
  esac
}

if [[ -n "$CLASSIFY_NAME" ]]; then
  classify_adapter "$CLASSIFY_NAME"
  exit 0
fi

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local temporary
  temporary="$(mktemp "${file}.XXXXXX")"
  if [[ -f "$file" ]]; then
    awk -v key="$key" -v value="$value" '
      BEGIN { updated = 0 }
      index($0, key "=") == 1 { print key "=" value; updated = 1; next }
      { print }
      END { if (!updated) print key "=" value }
    ' "$file" > "$temporary"
    chmod --reference="$file" "$temporary" 2>/dev/null || true
  else
    printf '%s=%s\n' "$key" "$value" > "$temporary"
  fi
  mv "$temporary" "$file"
}

if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  configured_mode="$(sed -n 's/^ZIGBEE_ADAPTER_MODE=//p' "$ENV_FILE" | tail -n 1)"
  if [[ "$configured_mode" == "manual" ]]; then
    echo "Zigbee : configuration manuelle conservée."
    exit 0
  fi
fi

candidates=()
if [[ -d "$SERIAL_DIR" ]]; then
  while IFS= read -r -d '' candidate; do
    [[ -e "$candidate" ]] && candidates+=("$candidate")
  done < <(find "$SERIAL_DIR" -mindepth 1 -maxdepth 1 -type l -print0 2>/dev/null | sort -z)
fi

if ((${#candidates[@]} == 0)); then
  [[ -n "$ENV_FILE" ]] && set_env_value "$ENV_FILE" ZIGBEE_ADAPTER /dev/null
  [[ -n "$ENV_FILE" ]] && set_env_value "$ENV_FILE" ZIGBEE_ADAPTER_TYPE auto
  echo "Zigbee : aucun coordinateur USB détecté."
  exit 0
fi

known_candidates=()
for candidate in "${candidates[@]}"; do
  adapter_type="$(classify_adapter "$(basename "$candidate")")"
  [[ "$adapter_type" != "auto" ]] && known_candidates+=("$candidate")
done

if ((${#candidates[@]} == 1)); then
  selected="${candidates[0]}"
elif ((${#known_candidates[@]} == 1)); then
  selected="${known_candidates[0]}"
else
  echo "Zigbee : plusieurs ports série sont présents, choix automatique impossible :" >&2
  printf '  - %s\n' "${candidates[@]}" >&2
  echo "Définissez ZIGBEE_ADAPTER_MODE=manual, ZIGBEE_ADAPTER et ZIGBEE_ADAPTER_TYPE dans .env." >&2
  exit 1
fi

selected_type="$(classify_adapter "$(basename "$selected")")"
if [[ "$selected_type" == "auto" && -r "$CACHE_FILE" ]]; then
  cached_type="$(awk -v key="$selected" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { print value }' "$CACHE_FILE")"
  case "$cached_type" in zstack | ember | deconz | zigate | zboss) selected_type="$cached_type" ;; esac
fi
if [[ -n "$ENV_FILE" ]]; then
  set_env_value "$ENV_FILE" ZIGBEE_ADAPTER_MODE auto
  set_env_value "$ENV_FILE" ZIGBEE_ADAPTER "$selected"
  set_env_value "$ENV_FILE" ZIGBEE_ADAPTER_TYPE "$selected_type"
fi

if [[ "$selected_type" == "auto" ]]; then
  echo "Zigbee : coordinateur détecté sur $selected ; pilote confié à l’auto-détection Zigbee2MQTT."
else
  echo "Zigbee : coordinateur détecté sur $selected ; pilote $selected_type sélectionné."
fi
