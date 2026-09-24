#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
command -v tailscale >/dev/null || { echo 'Activez Tailscale avant Jitsi.'; exit 1; }
if [[ "$EUID" -eq 0 ]]; then
  as_root=()
else
  command -v sudo >/dev/null || { echo 'Les droits administrateur sont requis.'; exit 1; }
  as_root=(sudo -n)
fi
address="$(tailscale ip -4)"
dns="$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
[[ -n "$address" && -n "$dns" ]] || exit 1
state="${ELISE_JITSI_STATE:-/var/lib/elise/jitsi}"
"${as_root[@]}" install -d -m 0750 -o "$(id -u)" -g "$(id -g)" "$state"
umask 077
export ELISE_INSTALL_ROOT="$root" ELISE_INSTALL_STATE="$state" ELISE_INSTALL_IP="$address" ELISE_INSTALL_DNS="$dns"
python3 - <<'PY'
import os,secrets,pathlib,subprocess,json
root=pathlib.Path(os.environ['ELISE_INSTALL_ROOT']); state=pathlib.Path(os.environ['ELISE_INSTALL_STATE'])
env=state/'jitsi.env'; values={}
if env.exists(): values=dict(line.split('=',1) for line in env.read_text().splitlines() if '=' in line and not line.startswith('#'))
for key in ['JICOFO_AUTH_PASSWORD','JVB_AUTH_PASSWORD','JWT_APP_SECRET']: values.setdefault(key,secrets.token_hex(32))
values.update(CONFIG=str(state/'config'),JITSI_IMAGE_VERSION='stable-10978',HTTP_PORT='18084',DISABLE_HTTPS='1',PUBLIC_URL='https://'+os.environ['ELISE_INSTALL_DNS']+':8444',ELISE_JITSI_BIND_IP=os.environ['ELISE_INSTALL_IP'],JVB_ADVERTISE_IPS=os.environ['ELISE_INSTALL_IP'],JVB_DISABLE_STUN='1',ENABLE_AUTH='1',AUTH_TYPE='jwt',ENABLE_GUESTS='0',JWT_APP_ID='elise',JWT_ACCEPTED_ISSUERS='elise',JWT_ACCEPTED_AUDIENCES='elise',JWT_ALLOW_EMPTY='0',ENABLE_P2P='0',ENABLE_PREJOIN_PAGE='0',ENABLE_WELCOME_PAGE='0',ENABLE_CLOSE_PAGE='0',ENABLE_RECORDING='0',ENABLE_LIVESTREAMING='0',ENABLE_TRANSCRIPTIONS='0',ENABLE_THIRD_PARTY_REQUESTS='0',DISABLE_LOCAL_RECORDING='1',ENABLE_XMPP_WEBSOCKET='1',XMPP_MUC_MODULES='elise_guard',MAX_PARTICIPANTS='2',JICOFO_MAX_MEMORY='512m',VIDEOBRIDGE_MAX_MEMORY='1024m',RESOLUTION='720',TZ='Europe/Paris',TOOLBAR_BUTTONS='microphone,camera,hangup')
# Use the existing Elise network rather than assuming the Compose project name.
cid=subprocess.check_output(['docker','ps','--filter','label=com.docker.compose.service=api','--filter','label=com.docker.compose.project=michel-os','-q'],text=True).strip()
if cid:
 networks=json.loads(subprocess.check_output(['docker','inspect',cid],text=True))[0]['NetworkSettings']['Networks']; values['ELISE_DOCKER_NETWORK']=next(iter(networks))
env.write_text(''.join(k+'='+v+'\n' for k,v in values.items()));env.chmod(0o600)
app=pathlib.Path(os.environ.get('ELISE_APPLICATION_ENV',str(root/'.env'))); content=app.read_text() if app.exists() else ''
updates={'ELISE_JITSI_URL':values['PUBLIC_URL'],'ELISE_JITSI_SECRET':values['JWT_APP_SECRET']}
lines=[l for l in content.splitlines() if l.split('=',1)[0] not in updates]
app.write_text('\n'.join(lines)+'\n'+''.join(k+'='+v+'\n' for k,v in updates.items()));app.chmod(0o600)
PY
for dir in web prosody/prosody-plugins-custom jicofo jvb storage/web storage/prosody storage/transcripts tmp/web-load-test tmp/web-crontabs transcripts web/crontabs web/load-test; do
  "${as_root[@]}" install -d -m 0750 -o 1000 -g 1000 "$state/config/$dir"
done
# The pinned Prosody image drops privileges to uid 100 / gid 102. Keeping the
# bind-mount root at uid 1000 prevents it from traversing /config and rejects
# every conference participant after JWT authentication.
"${as_root[@]}" install -d -m 0750 -o 100 -g 102 "$state/config/prosody/config"
"${as_root[@]}" chmod 0755 "$state/config/web" "$state/config/prosody/prosody-plugins-custom"
"${as_root[@]}" install -m 0644 docker/jitsi/mod_elise_guard.lua "$state/config/prosody/prosody-plugins-custom/mod_elise_guard.lua"
# Keep Jitsi's authentication secret out of command output.
compose=(docker compose --project-name elise-jitsi --env-file "$state/jitsi.env" -f docker/jitsi/compose.yaml)
"${compose[@]}" pull
"${compose[@]}" up -d
# A Docker restart can leave a running JVB without its Compose network. Compose
# otherwise considers that container healthy enough and does not reconnect it.
jvb_id="$("${compose[@]}" ps -q jvb)"
if [[ -z "$jvb_id" || "$(docker inspect -f '{{len .NetworkSettings.Networks}}' "$jvb_id" 2>/dev/null || echo 0)" == 0 ]]; then
  "${compose[@]}" up -d --force-recreate jvb
fi
"${as_root[@]}" tailscale serve --bg --https=8444 http://127.0.0.1:18084
# Add only Jitsi's rules and restore them after a reboot or base firewall restart.
"${as_root[@]}" install -d /usr/lib/elise
"${as_root[@]}" install -m 0755 appliance/elise-jitsi-firewall.sh /usr/lib/elise/elise-jitsi-firewall.sh
"${as_root[@]}" install -m 0644 appliance/systemd/elise-jitsi-firewall.service /etc/systemd/system/
"${as_root[@]}" systemctl daemon-reload
"${as_root[@]}" systemctl enable --now elise-jitsi-firewall.service
for attempt in $(seq 1 60); do
  prosody_id="$("${compose[@]}" ps -q prosody)"
  jvb_id="$("${compose[@]}" ps -q jvb)"
  if curl -fs http://127.0.0.1:18084/config.js >/dev/null \
    && curl -fs http://127.0.0.1:18085/about/health >/dev/null \
    && [[ -n "$prosody_id" && -n "$jvb_id" ]] \
    && docker exec --user 100:102 "$prosody_id" test -r /config/prosody.cfg.lua \
    && [[ "$(docker inspect -f '{{len .NetworkSettings.Networks}}' "$jvb_id")" -gt 0 ]]; then
    echo "Jitsi prêt : https://$dns:8444"
    exit 0
  fi
  sleep 2
done
echo 'Jitsi ne répond pas complètement (web, Prosody ou pont vidéo) ; consultez les journaux.' >&2
exit 1
