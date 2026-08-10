#!/bin/sh
set -eu

secret_dir="${MICHEL_SECRETS_DIR:-/run/michel-secrets}"
while [ ! -f "$secret_dir/postgres_password" ]; do sleep 1; done

postgres_password="$(cat "$secret_dir/postgres_password")"
export DATABASE_URL="postgresql://${POSTGRES_USER:-michel}:${postgres_password}@${POSTGRES_HOST:-postgres}:5432/${POSTGRES_DB:-michel}?schema=public"
export MQTT_PASSWORD="$(cat "$secret_dir/mqtt_password")"
export AI_SHARED_SECRET="$(cat "$secret_dir/ai_shared_secret")"
export SESSION_SECRET="$(cat "$secret_dir/session_secret")"

exec "$@"
