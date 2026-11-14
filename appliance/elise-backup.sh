#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
BACKUP_DIR="${ELISE_BACKUP_DIR:-/var/lib/elise/backups}"
COMPOSE_DIR="${ELISE_COMPOSE_DIR:-/opt/elise/current}"
CONFIG_FILE="${ELISE_CONFIG_FILE:-/etc/elise/elise.env}"
COMPOSE_PROJECT="${ELISE_COMPOSE_PROJECT:-elise-os}"
META="$BACKUP_DIR/last.json"
mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"
write_meta() { python3 - "$META" "$@" <<'PY'
import datetime,json,os,sys,tempfile
path,ok,size,file,error=sys.argv[1:]
data={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ok':ok=='true','sizeBytes':int(size) if size else None,'file':file or None,'error':error or None}
fd,tmp=tempfile.mkstemp(dir=os.path.dirname(path)); os.write(fd,json.dumps(data).encode()); os.close(fd); os.replace(tmp,path)
PY
}
use=(docker compose --project-name "$COMPOSE_PROJECT" --env-file "$CONFIG_FILE" -f "$COMPOSE_DIR/compose.yaml" -f "$COMPOSE_DIR/compose.release.yaml")
usage=$(df -P "$BACKUP_DIR" | awk 'NR==2 {gsub("%","",$5); print $5}')
if [[ "${usage:-100}" -gt 92 ]]; then write_meta false '' '' 'Espace disque supérieur à 92 %'; exit 1; fi
name="elise-$(date -u +%Y%m%d-%H%M).dump"; tmp="$BACKUP_DIR/.$name.tmp"; final="$BACKUP_DIR/$name"
if "${use[@]}" exec -T postgres pg_dump -Fc -U elise elise > "$tmp" && "${use[@]}" exec -T postgres sh -c "cat > '/tmp/$name.verify' && pg_restore --list '/tmp/$name.verify' >/dev/null; result=\$?; rm -f '/tmp/$name.verify'; exit \$result" < "$tmp"; then
  mv "$tmp" "$final"; chmod 0600 "$final"; size=$(stat -c %s "$final"); write_meta true "$size" "$name" ''
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'elise-*.dump' -printf '%T@ %p\n' | sort -rn | awk 'NR>7 {print $2}' | xargs -r rm -f --
else
  rm -f "$tmp"; write_meta false '' '' 'La sauvegarde ou sa vérification a échoué'; exit 1
fi
