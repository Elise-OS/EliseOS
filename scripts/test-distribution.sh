#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash -n "$root/install/install-elise.sh" "$root/install/elise" \
  "$root/appliance/elise-firstboot.sh" "$root/appliance/build-raspberry-image.sh" \
  "$root/appliance/elise-minipc-firstboot.sh" "$root/appliance/build-minipc-installer.sh" \
  "$root/appliance/minipc-installer/install-target.sh" \
  "$root/appliance/elise-tailscale-firewall.sh" "$root/appliance/elise-screen-setup.sh" \
  "$root/scripts/install-complete.sh" "$root/scripts/install-screen.sh" \
  "$root/scripts/install-jitsi.sh" "$root/appliance/elise-screen-session.sh" \
  "$root/appliance/elise-zigbee-setup.sh"
bash "$root/scripts/detect-zigbee-adapter.test.sh"
python3 - <<PY
for path in ("$root/appliance/remote-access-agent.py", "$root/appliance/elise-update-agent.py", "$root/appliance/elise-zigbee-agent.py", "$root/appliance/elise-preparation.py", "$root/appliance/elise_install_state.py", "$root/appliance/elise_install_texts.py", "$root/appliance/elise_language.py", "$root/appliance/elise-install-screen.py", "$root/appliance/installer_ui/__init__.py", "$root/appliance/installer_ui/preview.py", "$root/appliance/installer_ui/texts.py", "$root/appliance/installer_ui/graphics.py", "$root/appliance/installer_ui/monitor.py", "$root/appliance/minipc-installer/select-target.py"):
    compile(open(path, encoding="utf-8").read(), path, "exec")
PY
python3 "$root/appliance/test_remote_access_agent.py"
python3 "$root/appliance/test_update_agent.py"
python3 "$root/appliance/test_zigbee_agent.py"
python3 "$root/appliance/test_screen_agent.py"
python3 "$root/appliance/test_install_screen.py"
python3 "$root/appliance/test_minipc_installer.py"
docker compose --env-file "$root/.env.example" -f "$root/compose.yaml" -f "$root/compose.release.yaml" config --quiet
docker compose --env-file "$root/.env.example" -f "$root/compose.yaml" -f "$root/compose.release.yaml" -f "$root/compose.raspberry.yaml" -f "$root/compose.raspberry.release.yaml" config --quiet
if grep -R -nE --exclude-dir=node_modules --exclude-dir=dist \
  'tailscale (funnel|logout)|tailscale serve reset' \
  "$root/apps" "$root/appliance" "$root/install" "$root/docker" "$root/compose"*; then
  echo "A forbidden public or destructive Tailscale command is present." >&2
  exit 1
fi
grep -q -- 'SERVE_PORT = 8443' "$root/appliance/remote-access-agent.py"
grep -q -- "8555" "$root/appliance/elise-tailscale-firewall.sh"
# os-release defines VERSION: sourcing it in the installer replaced the requested Élise version.
if grep -nE '^[[:space:]]*(\.|source) /etc/os-release' "$root/install/install-elise.sh"; then
  echo "install-elise.sh must read /etc/os-release in a subshell." >&2
  exit 1
fi
# Without it, MagicDNS answers arriving on tailscale0 are rejected and the host loses DNS.
[[ "$(grep -c -- 'ct state established,related accept' "$root/appliance/elise-tailscale-firewall.sh")" -eq 2 ]]
grep -q -- '^ELISE_SCREEN_ENABLED=true$' "$root/.env.example"
grep -q -- 'elise-screen-setup.timer' "$root/install/install-elise.sh"
grep -q -- 'api dashboard' "$root/appliance/elise-screen-setup.sh"
grep -q -- 'install -d -m 0750 -o 100 -g 102' "$root/scripts/install-jitsi.sh"
grep -qF -- 'chown -R 100:102 "$state/config/prosody/config/data"' "$root/scripts/install-jitsi.sh"
grep -q -- 'up -d --force-recreate jvb' "$root/scripts/install-jitsi.sh"
# Élise draws its own call screen: the Jitsi watermark is switched off by the web container.
grep -qF -- './custom-interface_config.js:/config/custom-interface_config.js:ro' "$root/docker/jitsi/compose.yaml"
grep -q -- 'SHOW_JITSI_WATERMARK = false' "$root/docker/jitsi/custom-interface_config.js"
# An update from the app runs the previous release's installer: it must hand over to the
# new one, and the new release must refuse to finish while its host files are missing.
grep -qF -- 'ELISE_INSTALLER_HANDOFF=true ELISE_UPDATE_LOCK_HELD=true' "$root/install/install-elise.sh"
grep -qF -- 'until host_files_current; do' "$root/install/install-elise.sh"
# Every host file the app relies on must be in the installer's list.
for host_file in appliance/elise-zigbee-agent.py appliance/systemd/elise-zigbee-agent.service \
  appliance/elise-zigbee-adapters.json appliance/elise-update-agent.py appliance/elise_install_state.py \
  appliance/elise_install_texts.py appliance/elise_language.py appliance/elise-preparation.py \
  appliance/systemd/elise-preparation.service appliance/elise-zigbee-setup.sh \
  appliance/systemd/elise-zigbee-setup.service appliance/udev/90-elise-zigbee.rules; do
  grep -qF -- " $host_file " "$root/install/install-elise.sh" \
    || { echo "$host_file manque dans la liste des fichiers système." >&2; exit 1; }
done
# Plugging any Zigbee key back in (Pi and mini PC alike) must run the detection that restarts
# Zigbee2MQTT, and an update must start the stack even when the configured key is unplugged.
grep -qF -- 'KERNEL=="ttyUSB[0-9]*|ttyACM[0-9]*"' "$root/appliance/udev/90-elise-zigbee.rules"
grep -qF -- 'start elise-zigbee-setup.service' "$root/appliance/udev/90-elise-zigbee.rules"
grep -qF -- 'systemctl enable elise-zigbee-setup.service' "$root/install/install-elise.sh"
grep -qF -- 'if ! "${compose[@]}" "${stack_up[@]}"; then' "$root/install/install-elise.sh"
# cloud-final.service is ordered after multi-user.target: depending on it from the
# first-boot unit creates an ordering cycle that systemd breaks by dropping a job.
if grep -Eq '^(After|Wants|Requires)=.*cloud-final' "$root/appliance/systemd/elise-firstboot.service"; then
  echo "elise-firstboot.service must wait for cloud-init in its script, not through unit ordering." >&2
  exit 1
fi
grep -q -- '^Type=simple$' "$root/appliance/systemd/elise-firstboot.service"
grep -q -- 'stub-resolv.conf' "$root/appliance/build-raspberry-image.sh"
# A stock image must have no known or expired password. Imager replaces
# user-data and merges its singular `user:` entry over the locked default.
grep -q -- '^ssh_pwauth: false$' "$root/appliance/user-data"
grep -A1 -q -- '^chpasswd:$' "$root/appliance/user-data"
grep -q -- '^    lock_passwd: true$' "$root/appliance/cloud-init.cfg"
if grep -Eq -- '(^|[[:space:]])(password|passwd):[[:space:]]*ubuntu([[:space:]]|$)' \
  "$root/appliance/user-data" "$root/appliance/cloud-init.cfg"; then
  echo "The Raspberry Pi image must not contain the ubuntu/ubuntu password." >&2
  exit 1
fi
grep -qF -- 'install -m 0644 "$ROOT_DIR/appliance/user-data" "$work_dir/root/boot/firmware/user-data"' \
  "$root/appliance/build-raspberry-image.sh"
# Package installation gets temporary room, then the distributed image keeps a
# measured 700 MiB available margin until cloud-init growpart/resize_rootfs runs.
grep -q -- 'ELISE_IMAGE_FINAL_FREE_MIB:-700' "$root/appliance/build-raspberry-image.sh"
grep -q -- 'resize2fs -M' "$root/appliance/build-raspberry-image.sh"
grep -q -- 'zerofree' "$root/appliance/build-raspberry-image.sh"
grep -q -- '^growpart:$' "$root/appliance/cloud-init.cfg"
grep -q -- '^resize_rootfs: true$' "$root/appliance/cloud-init.cfg"
# The TV installation screen: in the image from the first boot, never in the resident screen's way.
grep -q -- 'python3-pil python3-qrcode' "$root/appliance/build-raspberry-image.sh"
grep -q -- 'python3-pil python3-qrcode fonts-dejavu-core' "$root/install/install-elise.sh"
grep -q -- 'ELISE_FRESH_INSTALL' "$root/install/install-elise.sh"
grep -q -- '^preparation_owns_port()' "$root/install/install-elise.sh"
[[ "$(grep -c -- 'preparation_owns_port' "$root/install/install-elise.sh")" -eq 3 ]]
grep -q -- 'elise-install-screen.py --detect-display' "$root/install/install-elise.sh"
grep -q -- 'disable --now elise-install-screen.service elise-preparation.service' "$root/install/install-elise.sh"
for host_file in appliance/elise-install-screen.py appliance/elise_install_state.py appliance/elise_install_texts.py \
  appliance/elise_language.py appliance/systemd/elise-install-screen.service; do
  grep -qF -- "$host_file" "$root/appliance/build-raspberry-image.sh" \
    || { echo "$host_file manque dans l’image Raspberry Pi." >&2; exit 1; }
done
grep -q -- '^ConditionPathExists=!/var/lib/elise/.screen-setup-complete$' "$root/appliance/systemd/elise-install-screen.service"
grep -q -- '^Conflicts=lightdm.service' "$root/appliance/systemd/elise-install-screen.service"
grep -q -- 'disable --now elise-install-screen.service' "$root/scripts/install-screen.sh"
# A fresh install must not mistake the missing current link for a previous release.
grep -q -- '-L "$ELISE_ROOT/current"' "$root/install/install-elise.sh"
# GitHub honours only the first Accept header; assets need octet-stream alone.
grep -q -- 'GITHUB_ACCEPT=application/octet-stream' "$root/install/install-elise.sh"
# The mini-PC installer must retain Ubuntu's boot images and gate every destructive install.
grep -q -- 'gpgv --keyring' "$root/appliance/build-minipc-installer.sh"
grep -q -- '-boot_image any replay' "$root/appliance/build-minipc-installer.sh"
grep -q -- '-volume_date uuid' "$root/appliance/build-minipc-installer.sh"
grep -q -- 'ds=nocloud' "$root/appliance/build-minipc-installer.sh"
grep -q -- 'MINIMUM_BYTES = 32_000_000_000' "$root/appliance/minipc-installer/select-target.py"
grep -q -- 'transport.*usb\|tran.*usb' "$root/appliance/minipc-installer/select-target.py"
grep -q -- 'allow-pw: false' "$root/appliance/minipc-installer/user-data"
grep -q -- 'password: "!"' "$root/appliance/minipc-installer/user-data"
grep -q -- 'install-elise.sha256' "$root/appliance/elise-minipc-firstboot.sh"
grep -q -- 'ELISE_TEST_INSTALLER_URL' "$root/appliance/build-minipc-installer.sh"
grep -q -- 'choose_language' "$root/appliance/minipc-installer/select-target.py"
grep -q -- 'wait_for_ethernet' "$root/appliance/minipc-installer/select-target.py"
grep -q -- 'confirm_erase' "$root/appliance/minipc-installer/select-target.py"
grep -q -- 'source.*installer' "$root/appliance/minipc-installer/select-target.py"
grep -q -- '/run/elise-installer/language.json' "$root/appliance/minipc-installer/install-target.sh"
grep -q -- 'name: "en\*"' "$root/appliance/minipc-installer/install-target.sh"
grep -q -- 'SOURCEFORGE_SSH_PRIVATE_KEY' "$root/.github/workflows/release.yml"
grep -q -- 'StrictHostKeyChecking=yes' "$root/.github/workflows/release.yml"
grep -q -- 'SHA256:209BDmH3jsRyO9UeGPPgLWPSegKmYCBIya0nR/AWWCY' "$root/.github/workflows/release.yml"
if grep -q -- 'dist/elise-os-.*minipc-amd64-installer.iso$' "$root/.github/workflows/release.yml"; then
  echo "The full mini-PC ISO must not be uploaded as a GitHub artifact." >&2
  exit 1
fi
grep -q -- '/api/v1/auth/bootstrap' "$root/docker/dashboard/Caddyfile"
grep -q -- '/api/docs\*' "$root/docker/dashboard/Caddyfile"
if grep -Eq -- '/api/v1/(equipment|sensor-devices)/' "$root/docker/dashboard/Caddyfile"; then
  echo "The private gateway must leave equipment and sensor routes to application role checks." >&2
  exit 1
fi
echo "Distribution checks passed."
