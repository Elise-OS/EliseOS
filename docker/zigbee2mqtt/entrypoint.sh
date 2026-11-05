#!/bin/sh
set -eu
secret_dir="${ELISE_SECRETS_DIR:-/run/elise-secrets}"
while [ ! -f "$secret_dir/mqtt_password" ]; do sleep 1; done

configuration_file=/app/data/configuration.yaml
configuration_template=/usr/local/share/elise/zigbee2mqtt-configuration.yaml
if [ ! -s "$configuration_file" ]; then
  cp "$configuration_template" "$configuration_file"
fi

export ZIGBEE2MQTT_CONFIG_MQTT_PASSWORD="$(cat "$secret_dir/mqtt_password")"
case "${ELISE_ZIGBEE_ADAPTER_TYPE:-auto}" in
  auto | '')
    # Zigbee2MQTT probes the mapped serial port when no driver is forced.
    unset ZIGBEE2MQTT_CONFIG_SERIAL_ADAPTER
    ;;
  zstack | ember | deconz | zigate | zboss)
    export ZIGBEE2MQTT_CONFIG_SERIAL_ADAPTER="$ELISE_ZIGBEE_ADAPTER_TYPE"
    ;;
  *)
    echo "Pilote Zigbee inconnu : $ELISE_ZIGBEE_ADAPTER_TYPE" >&2
    exit 1
    ;;
esac
cd /app
exec node index.js
