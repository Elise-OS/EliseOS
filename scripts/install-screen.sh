#!/usr/bin/env bash
# Host display installation: Ubuntu PC (HDMI/DP) and Raspberry Pi (supported outputs).
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Lancer avec sudo.'; exit 1; }
url="${1:?Usage: sudo install-screen.sh https://elise.example.ts.net:8443}"
[[ "$url" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]] || { echo 'Adresse HTTPS Élise requise.'; exit 1; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { echo 'Le mode écran est validé pour Ubuntu 24.04.'; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends xserver-xorg xinit openbox lightdm unclutter pulseaudio alsa-utils x11-xserver-utils chromium-browser cec-utils v4l-utils python3
id elise-screen >/dev/null 2>&1 || useradd --create-home --shell /bin/bash elise-screen
usermod -a -G video,render,audio,input elise-screen
install -d -m 0755 /etc/elise /etc/lightdm/lightdm.conf.d /usr/share/xsessions /usr/lib/elise
printf '%s\n' "$url" > /etc/elise/screen-url
install -m 0755 "$root/appliance/elise-screen-session.sh" /usr/lib/elise/elise-screen-session
cat > /usr/share/xsessions/elise-screen.desktop <<'DESKTOP'
[Desktop Entry]
Name=Élise écran résident
Exec=/usr/lib/elise/elise-screen-session
Type=Application
DESKTOP
cat > /etc/lightdm/lightdm.conf.d/60-elise-screen.conf <<'LIGHTDM'
[Seat:*]
autologin-user=elise-screen
autologin-user-timeout=0
user-session=elise-screen
autologin-session=elise-screen
LIGHTDM
# Grant automatic media access only to the explicitly configured trusted origins.
install -d -m 0755 /etc/chromium/policies/managed /var/snap/chromium/current/policies/managed
ELISE_SCREEN_ORIGIN="$url" python3 - <<'PY'
import json,os,pathlib,urllib.parse
origin=os.environ['ELISE_SCREEN_ORIGIN']; u=urllib.parse.urlsplit(origin)
policy={'AudioCaptureAllowedUrls':[origin,f'https://{u.hostname}:8444'], 'VideoCaptureAllowedUrls':[origin,f'https://{u.hostname}:8444'], 'AutoplayAllowlist':[origin,f'https://{u.hostname}:8444','https://www.youtube.com'], 'BrowserSignin':0, 'PasswordManagerEnabled':False}
for target in ['/etc/chromium/policies/managed/elise.json','/var/snap/chromium/current/policies/managed/elise.json']:
 pathlib.Path(target).write_text(json.dumps(policy))
PY
if command -v snap >/dev/null; then
 snap connect chromium:camera || true
 snap connect chromium:audio-record || true
fi
getent group elise-agent >/dev/null || groupadd --system elise-agent
install -m 0755 "$root/appliance/elise-screen-agent.py" /usr/lib/elise/elise-screen-agent.py
install -m 0644 "$root/appliance/systemd/elise-screen-agent.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable elise-screen-agent
systemctl restart elise-screen-agent
systemctl enable lightdm
# Starting the manager does not terminate another active graphical session.
systemctl start lightdm
printf 'Écran Élise installé : %s/resident-screen\n' "$url"
printf 'Branchez la TV sur une sortie HDMI ou DisplayPort reconnue, puis associez l’écran depuis Élise.\n'
