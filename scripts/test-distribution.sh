#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash -n "$root/install/install-elise.sh" "$root/install/elise" \
  "$root/appliance/elise-firstboot.sh" "$root/appliance/build-raspberry-image.sh" \
  "$root/appliance/elise-tailscale-firewall.sh" "$root/appliance/elise-screen-setup.sh" \
  "$root/scripts/install-complete.sh" "$root/scripts/install-screen.sh" \
  "$root/scripts/install-jitsi.sh" "$root/appliance/elise-screen-session.sh" \
  "$root/appliance/elise-zigbee-setup.sh"
bash "$root/scripts/detect-zigbee-adapter.test.sh"
python3 - <<PY
for path in ("$root/appliance/remote-access-agent.py", "$root/appliance/elise-update-agent.py", "$root/appliance/elise-zigbee-agent.py", "$root/appliance/elise-preparation.py", "$root/appliance/elise_install_state.py", "$root/appliance/elise-install-screen.py"):
    compile(open(path, encoding="utf-8").read(), path, "exec")
PY
python3 "$root/appliance/test_remote_access_agent.py"
python3 "$root/appliance/test_update_agent.py"
python3 "$root/appliance/test_zigbee_agent.py"
python3 "$root/appliance/test_screen_agent.py"
python3 "$root/appliance/test_install_screen.py"
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
# An update from the app runs the previous release's installer: it must hand over to the
# new one, and the new release must refuse to finish while its host files are missing.
grep -qF -- 'ELISE_INSTALLER_HANDOFF=true ELISE_UPDATE_LOCK_HELD=true' "$root/install/install-elise.sh"
grep -qF -- 'until host_files_current; do' "$root/install/install-elise.sh"
# Every host file the app relies on must be in the installer's list.
for host_file in appliance/elise-zigbee-agent.py appliance/systemd/elise-zigbee-agent.service \
  appliance/elise-zigbee-adapters.json appliance/elise-update-agent.py appliance/elise_install_state.py; do
  grep -qF -- " $host_file " "$root/install/install-elise.sh" \
    || { echo "$host_file manque dans la liste des fichiers système." >&2; exit 1; }
done
# cloud-final.service is ordered after multi-user.target: depending on it from the
# first-boot unit creates an ordering cycle that systemd breaks by dropping a job.
if grep -Eq '^(After|Wants|Requires)=.*cloud-final' "$root/appliance/systemd/elise-firstboot.service"; then
  echo "elise-firstboot.service must wait for cloud-init in its script, not through unit ordering." >&2
  exit 1
fi
grep -q -- '^Type=simple$' "$root/appliance/systemd/elise-firstboot.service"
grep -q -- 'stub-resolv.conf' "$root/appliance/build-raspberry-image.sh"
# The TV installation screen: in the image from the first boot, never in the resident screen's way.
grep -q -- 'python3-pil python3-qrcode' "$root/appliance/build-raspberry-image.sh"
for host_file in appliance/elise-install-screen.py appliance/elise_install_state.py appliance/systemd/elise-install-screen.service; do
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
grep -q -- '/api/v1/auth/bootstrap' "$root/docker/dashboard/Caddyfile"
grep -q -- '/api/docs\*' "$root/docker/dashboard/Caddyfile"
if grep -Eq -- '/api/v1/(equipment|sensor-devices)/' "$root/docker/dashboard/Caddyfile"; then
  echo "The private gateway must leave equipment and sensor routes to application role checks." >&2
  exit 1
fi
echo "Distribution checks passed."
