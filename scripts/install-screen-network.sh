#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Lancer avec sudo.'; exit 1; }
# Explicit opt-in: leave Ethernet/Wi-Fi under their existing network manager.
install -d /etc/NetworkManager/conf.d
cat > /etc/NetworkManager/conf.d/80-elise-modem-only.conf <<'CONFIG'
[keyfile]
unmanaged-devices=type:ethernet;type:wifi;type:bridge;type:tun;type:wireguard
CONFIG
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y network-manager modemmanager
systemctl enable --now NetworkManager ModemManager
printf 'Support modem prêt. Activez le secours dans les réglages Écran d’Élise.\n'
