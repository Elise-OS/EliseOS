#!/bin/bash
set -euo pipefail
secret_dir="${MICHEL_SECRETS_DIR:-/run/michel-secrets}"
while [[ ! -f "$secret_dir/postgres_password" ]]; do sleep 1; done
password="$(cat "$secret_dir/postgres_password")"
postgres_host="${POSTGRES_HOST:-postgres}"
postgres_port="${POSTGRES_PORT:-5432}"
export HA_DATABASE_URL="postgresql://michel:${password}@${postgres_host}:${postgres_port}/homeassistant"
exec /init
