#!/usr/bin/env bash
# Local, private Jitsi for the call UI captures (scripts/calls-ui-capture.mjs).
#
#   bash scripts/calls-ui-jitsi.sh up     # starts Jitsi on http://127.0.0.1:18383 (TLS proxy 18384)
#   bash scripts/calls-ui-jitsi.sh down   # stops it and removes its state
#
# Same pinned images and the same web settings as scripts/install-jitsi.sh (no prejoin, no
# welcome page, TOOLBAR_BUTTONS=microphone,camera,hangup, XMPP websocket), except:
# - guests are allowed (no JWT): the Elise guard needs the real API to authorise a seat;
# - everything listens on 127.0.0.1 only (web 18383, colibri 18385, jicofo 18398, JVB UDP 11300).
# Override the project name or ports with ELISE_CALLS_PROJECT / ELISE_CALLS_HTTP_PORT.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="${ELISE_CALLS_PROJECT:-elise-calls}"
http_port="${ELISE_CALLS_HTTP_PORT:-18383}"
state="${ELISE_CALLS_STATE:-/tmp/$project-jitsi}"
network="$project-api"
compose=(docker compose --project-name "$project" -f docker/jitsi/compose.yaml)

export CONFIG="$state/config"
export ELISE_DOCKER_NETWORK="$network"
export ELISE_JITSI_BIND_IP=127.0.0.1
export HTTP_PORT="$http_port"
export JICOFO_REST_PORT="${ELISE_CALLS_JICOFO_PORT:-18398}"
export JVB_COLIBRI_PORT="${ELISE_CALLS_COLIBRI_PORT:-18385}"
export JVB_PORT="${ELISE_CALLS_JVB_PORT:-11300}"
export JVB_ADVERTISE_IPS="127.0.0.1#$JVB_PORT"
export JVB_DISABLE_STUN=1
# The External API always opens https://<domain>/<room>: calls-ui-capture.mjs serves a TLS
# proxy (with websocket upgrades) on this port in front of the plain HTTP web container.
export PUBLIC_URL="https://127.0.0.1:${ELISE_CALLS_TLS_PORT:-18384}"
export DISABLE_HTTPS=1
export ENABLE_AUTH=0
export ENABLE_GUESTS=1
export AUTH_TYPE=internal
export JICOFO_AUTH_PASSWORD=calls-ui-jicofo
export JVB_AUTH_PASSWORD=calls-ui-jvb
# Production values (scripts/install-jitsi.sh).
export ENABLE_P2P=0
export ENABLE_PREJOIN_PAGE=0
export ENABLE_WELCOME_PAGE=0
export ENABLE_CLOSE_PAGE=0
export ENABLE_RECORDING=0
export ENABLE_LIVESTREAMING=0
export ENABLE_TRANSCRIPTIONS=0
export DISABLE_LOCAL_RECORDING=1
export ENABLE_XMPP_WEBSOCKET=1
export MAX_PARTICIPANTS=2
export RESOLUTION=720
export TOOLBAR_BUTTONS=microphone,camera,hangup
export TZ=Europe/Paris

case "${1:-up}" in
  up)
    docker network inspect "$network" >/dev/null 2>&1 || docker network create "$network" >/dev/null
    install -d -m 0777 "$state/config/web/crontabs" "$state/config/web/load-test" \
      "$state/config/transcripts" "$state/config/prosody/config/data" \
      "$state/config/prosody/prosody-plugins-custom" "$state/config/jicofo" "$state/config/jvb"
    "${compose[@]}" up -d
    for _ in $(seq 1 90); do
      if curl -fs "http://127.0.0.1:$http_port/config.js" >/dev/null &&
        curl -fs "http://127.0.0.1:$JVB_COLIBRI_PORT/about/health" >/dev/null; then
        echo "Jitsi ready: http://127.0.0.1:$http_port"
        exit 0
      fi
      sleep 1
    done
    "${compose[@]}" logs --no-color --tail 80 >&2
    exit 1
    ;;
  down)
    "${compose[@]}" down --volumes --remove-orphans
    docker network rm "$network" >/dev/null 2>&1 || true
    # Prosody and the web container write files as their own users.
    case "$state" in
      /tmp/*) sudo -n rm -rf -- "$state" 2>/dev/null || rm -rf -- "$state" ;;
    esac
    ;;
  *)
    echo "usage: $0 up|down" >&2
    exit 2
    ;;
esac
