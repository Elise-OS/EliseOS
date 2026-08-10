#!/bin/bash
set -euo pipefail
secret_dir="${MICHEL_SECRETS_DIR:-/run/michel-secrets}"
while [[ ! -f "$secret_dir/postgres_password" ]]; do sleep 1; done
password="$(cat "$secret_dir/postgres_password")"
export HA_DATABASE_URL="postgresql://michel:${password}@postgres:5432/homeassistant"
exec /init
