#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-/target}"
MEDIA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing Élise OS bootstrap in $TARGET"
tar -xzf "$MEDIA/elise-bootstrap.tar.gz" -C "$TARGET"

# The language chosen before disk confirmation is a deliberate family choice.  Keep it in the
# persistent state directory so the first TV screen and the app use it instead of detection.
install -d -m 0755 "$TARGET/var/lib/elise"
install -m 0644 /run/elise-installer/language.json "$TARGET/var/lib/elise/language.json"

# These small packages make the TV and local preparation page available from the first boot.
curtin in-target --target="$TARGET" -- env DEBIAN_FRONTEND=noninteractive \
  apt-get -o DPkg::Lock::Timeout=900 install -y --no-install-recommends \
  avahi-daemon python3-pil python3-qrcode

curtin in-target --target="$TARGET" -- groupadd --system --force elise-agent
agent_gid="$(curtin in-target --target="$TARGET" -- getent group elise-agent | cut -d: -f3)"
printf 'ELISE_AGENT_GID=%s\n' "$agent_gid" > "$TARGET/etc/elise/agent.env"
sed -i "s/^ELISE_AGENT_GID=.*/ELISE_AGENT_GID=$agent_gid/" "$TARGET/etc/elise/elise.env"

# The TV progress screen does not bind a network port and can start immediately.  The signed
# installer starts the preparation web page itself after its port preflight; pre-starting it here
# would make older, otherwise valid release installers mistake their own page for a conflict.
for service in elise-install-screen.service elise-minipc-firstboot.service; do
  ln -sfn "../$service" "$TARGET/etc/systemd/system/multi-user.target.wants/$service"
done

# A locked local account exists only for system ownership and emergency recovery with a key
# added later. Password authentication remains disabled.
install -d -m 0755 "$TARGET/etc/ssh/sshd_config.d"
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' \
  > "$TARGET/etc/ssh/sshd_config.d/60-elise-no-password.conf"

# Subiquity's live network may use a PCI-specific name.  Keep DHCP on any predictable wired
# Ethernet name after reboot, when removing the ISO can change the emulated/physical PCI path.
find "$TARGET/etc/netplan" -maxdepth 1 -type f -name '*.yaml' -delete
cat > "$TARGET/etc/netplan/60-elise-ethernet.yaml" <<'YAML'
network:
  version: 2
  ethernets:
    all-ethernet:
      match:
        name: "en*"
      dhcp4: true
      optional: true
YAML
chmod 0600 "$TARGET/etc/netplan/60-elise-ethernet.yaml"

# Keep installation and first-boot evidence available on a hardware serial port and in VMs.
install -d -m 0755 "$TARGET/etc/default/grub.d"
printf 'GRUB_CMDLINE_LINUX="$GRUB_CMDLINE_LINUX console=tty0 console=ttyS0,115200n8"\n' \
  > "$TARGET/etc/default/grub.d/60-elise-serial.cfg"
curtin in-target --target="$TARGET" -- update-grub

echo "ELISE_INSTALLER: target bootstrap installed"
