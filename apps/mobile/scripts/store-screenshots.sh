#!/usr/bin/env bash
# Captures the App Store screenshots (iPhone 6.9" and iPad 13") in demo mode.
# Usage: bash scripts/store-screenshots.sh path/to/lise.app
set -euo pipefail

APP_PATH="${1:?Usage: store-screenshots.sh path/to/lise.app}"
MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$MOBILE_DIR/fastlane/screenshots/fr-FR"
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
  xcrun simctl spawn "$udid" defaults write .GlobalPreferences AppleLanguages -array fr-FR
  xcrun simctl spawn "$udid" defaults write .GlobalPreferences AppleLocale fr_FR
  xcrun simctl status_bar "$udid" override --time "$(date +%H:%M)" --dataNetwork wifi --wifiMode active \
    --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
  xcrun simctl install "$udid" "$APP_PATH"

  work_dir="$(mktemp -d)"
  "$MAESTRO" --device "$udid" test -e OUT="$work_dir" "$MOBILE_DIR/.maestro/store-screenshots.yaml"
  for file in "$work_dir"/*.png; do
    mv "$file" "$OUTPUT_DIR/$prefix-$(basename "$file")"
  done
  rmdir "$work_dir"
done

echo "Screenshots written to $OUTPUT_DIR"
