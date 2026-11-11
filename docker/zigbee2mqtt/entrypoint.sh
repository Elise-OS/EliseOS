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
# Boxes installed before these settings keep their own configuration file: force the two
# settings Élise depends on (offline sensors, button presses) without touching their network.
export ZIGBEE2MQTT_CONFIG_AVAILABILITY_ENABLED=true
export ZIGBEE2MQTT_CONFIG_HOMEASSISTANT_EXPERIMENTAL_EVENT_ENTITIES=true
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
# Speed and flow control of the key, chosen when it was installed (empty: Zigbee2MQTT's own defaults).
case "${ELISE_ZIGBEE_BAUDRATE:-}" in
  '') ;;
  38400 | 57600 | 115200 | 230400 | 460800 | 921600)
    export ZIGBEE2MQTT_CONFIG_SERIAL_BAUDRATE="$ELISE_ZIGBEE_BAUDRATE"
    ;;
  *)
    echo "Débit Zigbee inconnu : $ELISE_ZIGBEE_BAUDRATE" >&2
    exit 1
    ;;
esac
case "${ELISE_ZIGBEE_RTSCTS:-}" in
  '') ;;
  true | false) export ZIGBEE2MQTT_CONFIG_SERIAL_RTSCTS="$ELISE_ZIGBEE_RTSCTS" ;;
  *)
    echo "Contrôle de flux Zigbee inconnu : $ELISE_ZIGBEE_RTSCTS" >&2
    exit 1
    ;;
esac
cd /app
exec node index.js
