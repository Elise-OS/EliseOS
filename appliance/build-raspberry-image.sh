#!/usr/bin/env bash
set -euo pipefail

[[ "${EUID}" -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
VERSION="${1:?Usage: build-raspberry-image.sh VERSION [OUTPUT]}"
OUTPUT="${2:-elise-os-${VERSION}-raspberry-pi-arm64.img.xz}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Pin the base image and its checksum together; override both for another point release.
BASE_URL="${UBUNTU_PI_IMAGE_URL:-https://cdimage.ubuntu.com/ubuntu/releases/24.04.5/release/ubuntu-24.04.5-preinstalled-server-arm64+raspi.img.xz}"
BASE_SHA256="${UBUNTU_PI_IMAGE_SHA256:-b23371a5c8d02f612c26e7c18cacb81c5a48f968c7c66a2645391320aa94351e}"
# Room for the appliance packages only; cloud-init grows the root filesystem on first boot.
EXTRA_SPACE="${ELISE_IMAGE_EXTRA_SPACE:-3G}"
ELISE_BUILD_WORKDIR="${ELISE_BUILD_WORKDIR:-}"
if [[ -n "$ELISE_BUILD_WORKDIR" ]]; then
  mkdir -p "$ELISE_BUILD_WORKDIR"
  work_dir="$(mktemp -d "$ELISE_BUILD_WORKDIR/elise-image-build-XXXXXXXX")"
else
  work_dir="$(mktemp -d)"
fi
loop_device=""
cleanup() {
  mountpoint -q "$work_dir/root/boot/firmware" && umount "$work_dir/root/boot/firmware" || true
  for directory in proc sys dev; do
    mountpoint -q "$work_dir/root/$directory" && umount -R -l "$work_dir/root/$directory" || true
  done
  mountpoint -q "$work_dir/root" && umount -l "$work_dir/root" || true
  [[ -n "$loop_device" ]] && losetup -d "$loop_device" || true
  rm -rf -- "$work_dir"
}
trap cleanup EXIT

for command in curl xz losetup parted e2fsck resize2fs rsync chroot qemu-aarch64-static sha256sum; do
  command -v "$command" >/dev/null || { echo "Missing build dependency: $command" >&2; exit 1; }
done

echo "→ Downloading Ubuntu Server 24.04 ARM64"
curl -fL "$BASE_URL" -o "$work_dir/base.img.xz"
echo "$BASE_SHA256  $work_dir/base.img.xz" | sha256sum -c - || { echo "Ubuntu base image checksum mismatch" >&2; exit 1; }
xz -T0 -d "$work_dir/base.img.xz"
image_path="$work_dir/base.img"
truncate -s "+$EXTRA_SPACE" "$image_path"
parted -s "$image_path" resizepart 2 100%
loop_device="$(losetup --find --show --partscan "$image_path")"
e2fsck -fy "${loop_device}p2"
resize2fs "${loop_device}p2"
mkdir -p "$work_dir/root"
mount "${loop_device}p2" "$work_dir/root"
mkdir -p "$work_dir/root/boot/firmware"
mount "${loop_device}p1" "$work_dir/root/boot/firmware"
for directory in dev proc sys; do
  mount --rbind "/$directory" "$work_dir/root/$directory"
done

echo "→ Installing appliance packages"
install -m 0755 "$(command -v qemu-aarch64-static)" "$work_dir/root/usr/bin/qemu-aarch64-static"
# The chroot borrows the builder's resolver; the image keeps systemd-resolved's stub link.
resolv_link="$(readlink "$work_dir/root/etc/resolv.conf" || true)"
rm -f "$work_dir/root/etc/resolv.conf"
cp --dereference /etc/resolv.conf "$work_dir/root/etc/resolv.conf"
# Services must not start inside the build chroot.
printf '#!/bin/sh\nexit 101\n' > "$work_dir/root/usr/sbin/policy-rc.d"
chmod 0755 "$work_dir/root/usr/sbin/policy-rc.d"
chroot "$work_dir/root" /bin/bash -euc '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq age ca-certificates curl gnupg avahi-daemon docker.io docker-compose-v2 nftables python3 xz-utils
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list
  apt-get update -qq && apt-get install -y -qq tailscale
  systemctl enable docker tailscaled avahi-daemon
  apt-get clean
  rm -rf /var/lib/apt/lists/*
'
rm -f "$work_dir/root/usr/sbin/policy-rc.d" "$work_dir/root/etc/resolv.conf"
ln -s "${resolv_link:-../run/systemd/resolve/stub-resolv.conf}" "$work_dir/root/etc/resolv.conf"

runtime="$work_dir/root/usr/share/elise/runtime"
mkdir -p "$runtime"
rsync -a \
  --include='/compose.yaml' --include='/compose.release.yaml' --include='/compose.raspberry.yaml' --include='/compose.raspberry.release.yaml' \
  --include='/.env.example' --include='/docker/***' --include='/scripts/***' \
  --include='/appliance/***' --include='/install/***' --exclude='*' \
  "$ROOT_DIR/" "$runtime/"
printf '%s\n' "$VERSION" > "$work_dir/root/usr/share/elise/version"
install -d -m 0755 "$work_dir/root/usr/lib/elise" "$work_dir/root/etc/elise"
install -m 0600 "$ROOT_DIR/.env.example" "$work_dir/root/etc/elise/elise.env"
sed -i 's/^MICHEL_HTTP_PORT=.*/MICHEL_HTTP_PORT=80/' "$work_dir/root/etc/elise/elise.env"
sed -i 's|^MICHEL_LOCAL_URL=.*|MICHEL_LOCAL_URL=http://elise.local|' "$work_dir/root/etc/elise/elise.env"
install -m 0755 "$ROOT_DIR/install/install-elise.sh" "$work_dir/root/usr/lib/elise/install-elise.sh"
install -m 0755 "$ROOT_DIR/appliance/elise-firstboot.sh" "$work_dir/root/usr/lib/elise/elise-firstboot.sh"
install -m 0755 "$ROOT_DIR/appliance/elise-preparation.py" "$work_dir/root/usr/lib/elise/elise-preparation.py"
install -m 0644 "$ROOT_DIR/appliance/systemd/elise-firstboot.service" "$work_dir/root/etc/systemd/system/elise-firstboot.service"
install -m 0644 "$ROOT_DIR/appliance/systemd/elise-preparation.service" "$work_dir/root/etc/systemd/system/elise-preparation.service"
chroot "$work_dir/root" groupadd --system elise-agent
agent_gid="$(chroot "$work_dir/root" getent group elise-agent | cut -d: -f3)"
printf 'ELISE_AGENT_GID=%s\n' "$agent_gid" > "$work_dir/root/etc/elise/agent.env"
sed -i "s/^ELISE_AGENT_GID=.*/ELISE_AGENT_GID=$agent_gid/" "$work_dir/root/etc/elise/elise.env"
ln -sf ../elise-preparation.service "$work_dir/root/etc/systemd/system/multi-user.target.wants/elise-preparation.service"
ln -sf ../elise-firstboot.service "$work_dir/root/etc/systemd/system/multi-user.target.wants/elise-firstboot.service"

# Ubuntu's cloud-init datasource and growpart configuration are deliberately
# retained so Raspberry Pi Imager can apply hostname, user, SSH, locale and Wi-Fi.
install -m 0644 "$ROOT_DIR/appliance/cloud-init.cfg" "$work_dir/root/etc/cloud/cloud.cfg.d/99-elise.cfg"
# Without Imager customisation, still answer on http://elise.local.
if ! grep -q '^hostname:' "$work_dir/root/boot/firmware/user-data"; then
  printf '\nhostname: elise\n' >> "$work_dir/root/boot/firmware/user-data"
fi
# The Pi has no RTC: start the clock at the build date so TLS works before NTP answers.
install -d "$work_dir/root/var/lib/systemd/timesync"
touch "$work_dir/root/var/lib/systemd/timesync/clock"
rm -f "$work_dir/root/etc/machine-id"
touch "$work_dir/root/etc/machine-id"
rm -f "$work_dir/root/usr/bin/qemu-aarch64-static"
sync
umount "$work_dir/root/boot/firmware"
for directory in proc sys dev; do umount -R -l "$work_dir/root/$directory"; done
umount -l "$work_dir/root"
losetup -d "$loop_device"
loop_device=""
if [[ "$OUTPUT" == *.img ]]; then
  echo "→ Writing uncompressed $OUTPUT"
  mv "$image_path" "$OUTPUT"
else
  echo "→ Compressing $OUTPUT"
  xz -T0 -6 -c "$image_path" > "$OUTPUT"
fi
echo "✓ Raspberry Pi 4/5 image: $OUTPUT"
