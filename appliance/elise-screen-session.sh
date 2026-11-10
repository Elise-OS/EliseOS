#!/usr/bin/env bash
set -euo pipefail
url="$(cat /etc/elise/screen-url)"
# Prefer a television connector, force a stable mode and disable stray local panels.
mapfile -t outputs < <(xrandr --query | awk '$2 == "connected" { p=3; if ($1 ~ /^HDMI/) p=0; else if ($1 ~ /^DP/) p=1; else if ($1 ~ /^(DVI|VGA)/) p=2; else if ($1 ~ /^(eDP|LVDS)/) p=4; print p, $1 }' | sort -k1,1n -k2,2 | awk '{print $2}')
output="${outputs[0]:-}"
if [[ -n "$output" ]]; then
  xrandr --output "$output" --mode 1920x1080 --primary --pos 0x0 \
    || xrandr --output "$output" --auto --primary --pos 0x0 \
    || true
  for other in "${outputs[@]:1}"; do xrandr --output "$other" --off || true; done
fi
xset s off || true
xset -dpms || true
xset s noblank || true
openbox &
unclutter -idle 2 &
pulseaudio --start || true
# Prefer the television speakers while keeping an available microphone input.
audio_card="$(pactl list short cards 2>/dev/null | awk 'NR == 1 { print $2 }' || true)"
if [[ -n "$audio_card" ]]; then
  pactl set-card-profile "$audio_card" output:hdmi-stereo+input:analog-stereo 2>/dev/null \
    || pactl set-card-profile "$audio_card" output:hdmi-stereo 2>/dev/null \
    || true
fi
hdmi_sink="$(pactl list short sinks 2>/dev/null | awk '$2 ~ /hdmi/ { print $2; exit }' || true)"
if [[ -n "$hdmi_sink" ]]; then
  pactl set-default-sink "$hdmi_sink" || true
  pactl set-sink-volume "$hdmi_sink" 30% || true
fi
usb_source="$(pactl list short sources 2>/dev/null | awk '$2 ~ /usb/ && $2 !~ /monitor$/ { print $2; exit }' || true)"
fallback_source="$(pactl list short sources 2>/dev/null | awk '$2 !~ /monitor$/ { print $2; exit }' || true)"
[[ -n "${usb_source:-$fallback_source}" ]] && pactl set-default-source "${usb_source:-$fallback_source}" || true
# The host agent owns CEC exclusively (native Linux on Pi/NAS, USB fallback).
browser="$(command -v chromium || command -v chromium-browser)"
# Resolve this appliance's private name locally even when host DNS uses public resolvers.
server="$(python3 -c 'import urllib.parse,sys;print(urllib.parse.urlsplit(sys.argv[1]).hostname)' "$url")"
address="$(tailscale ip -4 2>/dev/null || true)"
browser_args=()
if [[ -n "$address" ]]; then
  browser_args+=("--host-resolver-rules=MAP $server $address")
fi
while true; do
 token="$(python3 -c 'import json,pathlib; p=pathlib.Path.home()/".elise-token"; print(json.loads(p.read_text())["token"] if p.exists() else "")' 2>/dev/null || true)"
 geometry="$(xrandr --current 2>/dev/null | sed -n 's/.*current \([0-9][0-9]*\) x \([0-9][0-9]*\).*/\1,\2/p' | head -n 1 || true)"
 IFS=, read -r width height <<< "${geometry:-1920,1080}"
 "$browser" \
   "${browser_args[@]}" \
   --kiosk \
   --start-fullscreen \
   --start-maximized \
   --window-position=0,0 \
   --window-size="${width},${height}" \
   --force-device-scale-factor=1 \
   --autoplay-policy=no-user-gesture-required \
   --no-first-run \
   --disable-session-crashed-bubble \
   --password-store=basic \
   "$url/resident-screen#token=$token" || true
 sleep 2
done
