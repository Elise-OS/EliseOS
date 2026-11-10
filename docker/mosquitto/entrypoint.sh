#!/bin/sh
set -eu
secret_dir="${ELISE_SECRETS_DIR:-/run/elise-secrets}"
while [ ! -f "$secret_dir/mqtt_password" ]; do sleep 1; done
password="$(cat "$secret_dir/mqtt_password")"
mosquitto_passwd -b -c /mosquitto/data/passwords zigbee2mqtt "$password"
mosquitto_passwd -b /mosquitto/data/passwords homeassistant "$password"
mosquitto_passwd -b /mosquitto/data/passwords elise_core "$password"
cp /mosquitto/config/acl /mosquitto/data/acl
chmod 600 /mosquitto/data/passwords /mosquitto/data/acl
chown mosquitto:mosquitto /mosquitto/data/passwords /mosquitto/data/acl
exec mosquitto -c /mosquitto/config/mosquitto.conf
