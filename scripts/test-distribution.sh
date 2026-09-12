#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash -n "$root/install/install-elise.sh" "$root/install/elise" \
  "$root/appliance/elise-firstboot.sh" "$root/appliance/build-raspberry-image.sh" \
  "$root/appliance/elise-tailscale-firewall.sh"
python3 - <<PY
for path in ("$root/appliance/remote-access-agent.py", "$root/appliance/elise-preparation.py"):
    compile(open(path, encoding="utf-8").read(), path, "exec")
PY
python3 "$root/appliance/test_remote_access_agent.py"
docker compose --env-file "$root/.env.example" -f "$root/compose.yaml" -f "$root/compose.release.yaml" config --quiet
docker compose --env-file "$root/.env.example" -f "$root/compose.yaml" -f "$root/compose.release.yaml" -f "$root/compose.raspberry.yaml" -f "$root/compose.raspberry.release.yaml" config --quiet
if rg -n 'tailscale (funnel|logout)|tailscale serve reset' "$root/apps" "$root/appliance" "$root/install" "$root/docker" "$root/compose"*; then
  echo "A forbidden public or destructive Tailscale command is present." >&2
  exit 1
fi
rg -q -- 'SERVE_PORT = 8443' "$root/appliance/remote-access-agent.py"
rg -q -- "8555" "$root/appliance/elise-tailscale-firewall.sh"
rg -q -- '/api/v1/auth/bootstrap' "$root/docker/dashboard/Caddyfile"
rg -q -- '/api/docs\*' "$root/docker/dashboard/Caddyfile"
if rg -q -- '/api/v1/(equipment|sensor-devices)/' "$root/docker/dashboard/Caddyfile"; then
  echo "The private gateway must leave equipment and sensor routes to application role checks." >&2
  exit 1
fi
echo "Distribution checks passed."
