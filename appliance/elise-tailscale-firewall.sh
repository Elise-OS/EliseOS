#!/usr/bin/env bash
set -euo pipefail

nft delete table inet elise_remote 2>/dev/null || true
nft -f - <<'EOF'
table inet elise_remote {
  chain input {
    type filter hook input priority -5; policy accept;
    iifname "tailscale0" tcp dport { 8443, 8555 } accept
    iifname "tailscale0" udp dport 8555 accept
    iifname "tailscale0" reject
  }
  chain forward {
    type filter hook forward priority -5; policy accept;
    iifname "tailscale0" tcp dport 8555 accept
    iifname "tailscale0" udp dport 8555 accept
    iifname "tailscale0" reject
  }
}
EOF

admin_ipv4="${ELISE_TAILSCALE_ADMIN_IPV4:-}"
if [[ -n "$admin_ipv4" ]]; then
  [[ "$admin_ipv4" =~ ^100\.([0-9]{1,3}\.){2}[0-9]{1,3}$ ]] || {
    echo "ELISE_TAILSCALE_ADMIN_IPV4 must be a Tailscale IPv4 address." >&2
    exit 1
  }
  nft insert rule inet elise_remote input iifname "tailscale0" ip saddr "$admin_ipv4" tcp dport { 22, 443 } accept
fi
