#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash -n "$root/install/install-elise.sh" "$root/install/elise" \
  "$root/appliance/elise-firstboot.sh" "$root/appliance/build-raspberry-image.sh" \
  "$root/appliance/elise-tailscale-firewall.sh" "$root/appliance/elise-screen-setup.sh" \
  "$root/scripts/install-complete.sh" "$root/scripts/install-screen.sh" \
  "$root/scripts/install-jitsi.sh" "$root/appliance/elise-screen-session.sh"
python3 - <<PY
for path in ("$root/appliance/remote-access-agent.py", "$root/appliance/elise-update-agent.py", "$root/appliance/elise-preparation.py"):
    compile(open(path, encoding="utf-8").read(), path, "exec")
PY
python3 "$root/appliance/test_remote_access_agent.py"
python3 "$root/appliance/test_update_agent.py"
python3 "$root/appliance/test_screen_agent.py"
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
grep -q -- '^ELISE_SCREEN_ENABLED=true$' "$root/.env.example"
grep -q -- 'elise-screen-setup.timer' "$root/install/install-elise.sh"
grep -q -- 'api dashboard' "$root/appliance/elise-screen-setup.sh"
grep -q -- 'install -d -m 0750 -o 100 -g 102' "$root/scripts/install-jitsi.sh"
grep -q -- 'up -d --force-recreate jvb' "$root/scripts/install-jitsi.sh"
# cloud-final.service is ordered after multi-user.target: depending on it from the
# first-boot unit creates an ordering cycle that systemd breaks by dropping a job.
if grep -Eq '^(After|Wants|Requires)=.*cloud-final' "$root/appliance/systemd/elise-firstboot.service"; then
  echo "elise-firstboot.service must wait for cloud-init in its script, not through unit ordering." >&2
  exit 1
fi
grep -q -- '^Type=simple$' "$root/appliance/systemd/elise-firstboot.service"
grep -q -- 'stub-resolv.conf' "$root/appliance/build-raspberry-image.sh"
grep -q -- '/api/v1/auth/bootstrap' "$root/docker/dashboard/Caddyfile"
grep -q -- '/api/docs\*' "$root/docker/dashboard/Caddyfile"
if grep -Eq -- '/api/v1/(equipment|sensor-devices)/' "$root/docker/dashboard/Caddyfile"; then
  echo "The private gateway must leave equipment and sensor routes to application role checks." >&2
  exit 1
fi
echo "Distribution checks passed."
