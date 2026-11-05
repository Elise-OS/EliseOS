#!/bin/sh
set -eu

secret_dir="${ELISE_SECRETS_DIR:-/run/elise-secrets}"
while [ ! -f "$secret_dir/postgres_password" ]; do sleep 1; done

postgres_password="$(cat "$secret_dir/postgres_password")"
export DATABASE_URL="postgresql://${POSTGRES_USER:-elise}:${postgres_password}@${POSTGRES_HOST:-postgres}:5432/${POSTGRES_DB:-elise}?schema=public"
export MQTT_PASSWORD="$(cat "$secret_dir/mqtt_password")"
export AI_SHARED_SECRET="$(cat "$secret_dir/ai_shared_secret")"
export SESSION_SECRET="$(cat "$secret_dir/session_secret")"
export CAMERA_ENCRYPTION_KEY="$(cat "$secret_dir/camera_encryption_key")"
export CAMERA_TICKET_KEY="$(cat "$secret_dir/camera_ticket_key")"

exec "$@"
