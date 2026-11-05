#!/bin/sh
set -eu

destination="${1:-./backups}"
recipient="${ELISE_BACKUP_RECIPIENT:-}"
allow_plaintext="${ELISE_BACKUP_ALLOW_PLAINTEXT:-false}"

if [ -z "$recipient" ] && [ "$allow_plaintext" != "true" ]; then
  echo "Refusing an unencrypted backup. Set ELISE_BACKUP_RECIPIENT to an age recipient." >&2
  exit 1
fi
if [ -n "$recipient" ] && ! command -v age >/dev/null 2>&1; then
  echo "The age command is required for encrypted backups." >&2
  exit 1
fi

mkdir -p "$destination"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$destination/elise-$timestamp.tar"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

docker compose exec -T postgres pg_dump -U elise --format=custom elise > "$work_dir/database.dump"
mkdir -p "$work_dir/media"
docker compose cp api:/var/lib/elise/media/. "$work_dir/media/" >/dev/null 2>&1 || true
mkdir -p "$work_dir/ai-models" "$work_dir/homeassistant" "$work_dir/zigbee2mqtt"
docker compose cp ai:/var/lib/elise-ai/. "$work_dir/ai-models/" >/dev/null 2>&1 || true
docker compose cp homeassistant:/config/. "$work_dir/homeassistant/" >/dev/null 2>&1 || true
docker compose cp zigbee2mqtt:/app/data/. "$work_dir/zigbee2mqtt/" >/dev/null 2>&1 || true
tar -C "$work_dir" -cf "$archive" database.dump media ai-models homeassistant zigbee2mqtt

if [ -n "$recipient" ]; then
  age --recipient "$recipient" --output "$archive.age" "$archive"
  rm "$archive"
  echo "Encrypted backup created at $archive.age"
else
  echo "Unencrypted development backup created at $archive"
fi
