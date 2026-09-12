#!/bin/sh
set -eu

backup="${1:?Usage: scripts/restore.sh BACKUP_FILE}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
case "$backup" in
  *.age)
    age --decrypt "$backup" > "$work_dir/archive.tar"
    ;;
  *)
    cp "$backup" "$work_dir/archive.tar"
    ;;
esac

if tar -tf "$work_dir/archive.tar" >/dev/null 2>&1; then
  tar -C "$work_dir" -xf "$work_dir/archive.tar"
  docker compose exec -T postgres pg_restore -U michel --clean --if-exists --dbname=michel < "$work_dir/database.dump"
  if [ -d "$work_dir/media" ]; then
    docker compose exec -T api mkdir -p /var/lib/elise/media
    docker compose cp "$work_dir/media/." api:/var/lib/elise/media/
  fi
  if [ -d "$work_dir/ai-models" ]; then
    docker compose cp "$work_dir/ai-models/." ai:/var/lib/michel-ai/
  fi
  if [ -d "$work_dir/homeassistant" ]; then
    docker compose cp "$work_dir/homeassistant/." homeassistant:/config/
  fi
  if [ -d "$work_dir/zigbee2mqtt" ]; then
    docker compose cp "$work_dir/zigbee2mqtt/." zigbee2mqtt:/app/data/
  fi
else
  docker compose exec -T postgres pg_restore -U michel --clean --if-exists --dbname=michel < "$work_dir/archive.tar"
fi
