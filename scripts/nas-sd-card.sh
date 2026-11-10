#!/usr/bin/env bash
# Finds the SD card inserted in a USB or built-in reader of the NAS and writes an Élise image.
#   nas-sd-card.sh detect
#   nas-sd-card.sh flash IMAGE USER_DATA [NETWORK_CONFIG]
set -euo pipefail

MIN_BYTES=$((4 * 1000 * 1000 * 1000))
MAX_BYTES=$((256 * 1000 * 1000 * 1000))

system_disks() {
  # Disks holding a mounted filesystem (/, /boot, data volumes…) are never candidates.
  findmnt -rn -o SOURCE | grep '^/dev/' | while read -r source; do
    lsblk -nso NAME,TYPE "$source" 2>/dev/null | awk '$2 == "disk" { print $1 }'
  done | sort -u
}

# Prints "device size model" for every disk that can only be an SD card.
candidates() {
  local excluded
  excluded="$(system_disks | tr '\n' ' ')"
  lsblk -dnb -o NAME,TYPE,TRAN,SIZE,MODEL | while read -r name type tran size model; do
    [[ "$type" == disk ]] || continue
    [[ "$tran" == usb || "$name" == mmcblk* ]] || continue
    [[ "$size" =~ ^[0-9]+$ ]] && ((size >= MIN_BYTES && size <= MAX_BYTES)) || continue
    [[ " $excluded " == *" $name "* ]] && continue
    printf '/dev/%s %s %s\n' "$name" "$size" "${model:-carte}"
  done
}

single_card() {
  local list count
  list="$(candidates)"
  count="$(printf '%s' "$list" | grep -c . || true)"
  if ((count == 0)); then
    echo "Aucune carte SD détectée : insérez-la dans le lecteur du NAS." >&2
    return 1
  fi
  if ((count > 1)); then
    echo "Plusieurs cartes ou clés USB détectées, choix impossible :" >&2
    printf '%s\n' "$list" | sed 's/^/  - /' >&2
    return 1
  fi
  printf '%s\n' "$list"
}

describe() {
  local device size model
  read -r device size model <<< "$1"
  printf '%s (%s Go, %s)' "$device" "$((size / 1000000000))" "$model"
}

case "${1:-}" in
  detect)
    card="$(single_card)"
    echo "Carte SD prête : $(describe "$card")"
    ;;
  flash)
    image="${2:?Usage: nas-sd-card.sh flash IMAGE USER_DATA [NETWORK_CONFIG]}"
    user_data="${3:?Usage: nas-sd-card.sh flash IMAGE USER_DATA [NETWORK_CONFIG]}"
    network_config="${4:-}"
    [[ "$EUID" -eq 0 ]] || { echo "Lancer avec sudo." >&2; exit 1; }
    [[ -s "$image" ]] || { echo "Image absente : $image" >&2; exit 1; }
    card="$(single_card)"
    device="${card%% *}"
    # Detect again right before writing: the card must not have changed meanwhile.
    echo "→ Écriture de $(basename "$image") sur $(describe "$card")"
    case "$image" in
      *.xz) xz -T0 -dc "$image" | dd of="$device" bs=4M conv=fsync status=progress ;;
      *) dd if="$image" of="$device" bs=4M conv=fsync status=progress ;;
    esac
    sync
    partprobe "$device" 2>/dev/null || true
    udevadm settle
    boot_partition="$(lsblk -lnpo NAME,LABEL "$device" | awk '$2 == "system-boot" { print $1 }')"
    [[ -n "$boot_partition" ]] || { echo "Partition de démarrage introuvable après l’écriture." >&2; exit 1; }
    boot="$(mktemp -d)"
    mount "$boot_partition" "$boot"
    install -m 0644 "$user_data" "$boot/user-data"
    [[ -z "$network_config" ]] || install -m 0644 "$network_config" "$boot/network-config"
    sync
    umount "$boot"
    rmdir "$boot"
    echo "✓ Carte prête : retirez-la et démarrez le Raspberry Pi."
    ;;
  *)
    echo "Usage: nas-sd-card.sh {detect|flash IMAGE USER_DATA [NETWORK_CONFIG]}" >&2
    exit 2
    ;;
esac
