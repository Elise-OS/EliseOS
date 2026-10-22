#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DETECTOR="$SCRIPT_DIR/detect-zigbee-adapter.sh"
TEST_DIR="$(mktemp -d)"
trap 'rm -r "$TEST_DIR"' EXIT

assert_classification() {
  local name="$1"
  local expected="$2"
  local actual
  actual="$($DETECTOR --classify "$name")"
  [[ "$actual" == "$expected" ]] || {
    echo "Classification incorrecte pour $name : $actual au lieu de $expected" >&2
    exit 1
  }
}

assert_classification usb-SONOFF_SONOFF_Dongle_Lite_MG21 ember
assert_classification usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_V2 ember
assert_classification usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_P zstack
assert_classification usb-Texas_Instruments_TI_CC2531_USB_CDC zstack
assert_classification usb-dresden_elektronik_ingenieurtechnik_GmbH_ConBee_II deconz
assert_classification usb-ZiGate_USB-TTL zigate
assert_classification usb-future_coordinator auto

serial_dir="$TEST_DIR/serial"
mkdir -p "$serial_dir"
touch "$TEST_DIR/ttyUSB0"
ln -s "$TEST_DIR/ttyUSB0" "$serial_dir/usb-SONOFF_SONOFF_Dongle_Lite_MG21-test"
env_file="$TEST_DIR/elise.env"
printf 'TZ=Europe/Paris\nZIGBEE_ADAPTER_MODE=auto\n' > "$env_file"

MICHEL_SERIAL_BY_ID_DIR="$serial_dir" ZIGBEE_ADAPTER_CACHE="$TEST_DIR/missing" "$DETECTOR" --write-env "$env_file" >/dev/null
grep -Fqx "ZIGBEE_ADAPTER=$serial_dir/usb-SONOFF_SONOFF_Dongle_Lite_MG21-test" "$env_file"
grep -Fqx 'ZIGBEE_ADAPTER_TYPE=ember' "$env_file"

printf 'ZIGBEE_ADAPTER_MODE=manual\nZIGBEE_ADAPTER=tcp://coordinator.local:6638\nZIGBEE_ADAPTER_TYPE=zstack\n' > "$env_file"
MICHEL_SERIAL_BY_ID_DIR="$serial_dir" ZIGBEE_ADAPTER_CACHE="$TEST_DIR/missing" "$DETECTOR" --write-env "$env_file" >/dev/null
grep -Fqx 'ZIGBEE_ADAPTER=tcp://coordinator.local:6638' "$env_file"
grep -Fqx 'ZIGBEE_ADAPTER_TYPE=zstack' "$env_file"

# A generic USB-serial name reuses the driver that elise-zigbee-setup verified.
generic_dir="$TEST_DIR/generic"
mkdir -p "$generic_dir"
ln -s "$TEST_DIR/ttyUSB0" "$generic_dir/usb-1a86_USB_Serial-if00-port0"
printf 'ZIGBEE_ADAPTER_MODE=auto\n' > "$env_file"
MICHEL_SERIAL_BY_ID_DIR="$generic_dir" ZIGBEE_ADAPTER_CACHE="$TEST_DIR/missing" "$DETECTOR" --write-env "$env_file" >/dev/null
grep -Fqx 'ZIGBEE_ADAPTER_TYPE=auto' "$env_file"
printf '%s=zigate\n' "$generic_dir/usb-1a86_USB_Serial-if00-port0" > "$TEST_DIR/adapters"
MICHEL_SERIAL_BY_ID_DIR="$generic_dir" ZIGBEE_ADAPTER_CACHE="$TEST_DIR/adapters" "$DETECTOR" --write-env "$env_file" >/dev/null
grep -Fqx 'ZIGBEE_ADAPTER_TYPE=zigate' "$env_file"

echo "Détection Zigbee : tests réussis."
