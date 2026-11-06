#!/usr/bin/env bash
# Captures the App Store screenshots (iPhone 6.9" and iPad 13") in demo mode.
# Usage: bash scripts/store-screenshots.sh path/to/lise.app [fr|en|es]
set -euo pipefail

APP_PATH="${1:?Usage: store-screenshots.sh path/to/lise.app [fr|en|es]}"
LANG_CODE="${2:-fr}"
case "$LANG_CODE" in
  fr) STORE_LOCALE=fr-FR; DEVICE_LOCALE=fr_FR ;;
  en) STORE_LOCALE=en-US; DEVICE_LOCALE=en_US ;;
  es) STORE_LOCALE=es-ES; DEVICE_LOCALE=es_ES ;;
  *) echo "Unknown language: $LANG_CODE (fr, en or es)" >&2; exit 1 ;;
esac
MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$MOBILE_DIR/fastlane/screenshots/$STORE_LOCALE"
MAESTRO="${MAESTRO:-maestro}"
DEVICES=("iPhone 17 Pro Max:iphone" "iPad Pro 13-inch (M5):ipad")

export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
mkdir -p "$OUTPUT_DIR"

for entry in "${DEVICES[@]}"; do
  name="${entry%%:*}"
  prefix="${entry##*:}"
  udid="$(xcrun simctl list devices available -j | python3 -c '
import json, sys
name = sys.argv[1]
devices = json.load(sys.stdin)["devices"]
print(next(d["udid"] for runtime, items in devices.items() if "iOS" in runtime for d in items if d["name"] == name))
' "$name")"

  echo "→ $name ($udid)"
  xcrun simctl boot "$udid" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl spawn "$udid" defaults write .GlobalPreferences AppleLanguages -array "$STORE_LOCALE"
  xcrun simctl spawn "$udid" defaults write .GlobalPreferences AppleLocale "$DEVICE_LOCALE"
  # The status bar (date on iPad) only picks up the new language after a reboot.
  xcrun simctl shutdown "$udid"
  xcrun simctl boot "$udid"
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl status_bar "$udid" override --time "$(date +%H:%M)" --dataNetwork wifi --wifiMode active \
    --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
  xcrun simctl install "$udid" "$APP_PATH"

  work_dir="$(mktemp -d)"
  "$MAESTRO" --device "$udid" test --test-output-dir "$work_dir" -e OUT=store -e STORE_LANG="$LANG_CODE" -e DEVICE="$prefix" "$MOBILE_DIR/.maestro/store-screenshots.yaml"
  # Maestro only writes screenshots inside its output folder; find them wherever it put them.
  find "$work_dir" -path '*/store/*.png' | while read -r file; do
    mv "$file" "$OUTPUT_DIR/$prefix-$(basename "$file")"
  done
  rm -r "$work_dir"
done

echo "Screenshots written to $OUTPUT_DIR"
