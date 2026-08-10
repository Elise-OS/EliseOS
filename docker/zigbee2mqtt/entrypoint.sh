#!/bin/sh
set -eu
secret_dir="${MICHEL_SECRETS_DIR:-/run/michel-secrets}"
while [ ! -f "$secret_dir/mqtt_password" ]; do sleep 1; done
export ZIGBEE2MQTT_CONFIG_MQTT_PASSWORD="$(cat "$secret_dir/mqtt_password")"
cd /app
exec node index.js
