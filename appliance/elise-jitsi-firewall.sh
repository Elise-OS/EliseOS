#!/usr/bin/env bash
set -euo pipefail
if nft list table inet elise_remote >/dev/null 2>&1; then
 for chain in input forward; do
  if ! nft list chain inet elise_remote "$chain" | grep -q 'udp dport.*10000.*accept'; then
   nft insert rule inet elise_remote "$chain" iifname tailscale0 udp dport 10000 accept
  fi
 done
 if ! nft list chain inet elise_remote input | grep -q 'tcp dport.*8444.*accept'; then
  nft insert rule inet elise_remote input iifname tailscale0 tcp dport 8444 accept
 fi
fi
