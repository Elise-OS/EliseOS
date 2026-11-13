#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

profile="${1:-optimized}"
output="${2:-$root/test-results/jitsi-quality-$profile.json}"
case "$profile" in
  baseline|optimized) ;;
  *) echo "profile must be baseline or optimized" >&2; exit 2 ;;
esac

command -v docker >/dev/null
command -v tailscale >/dev/null
address="$(tailscale ip -4 | head -n 1)"
[[ -n "$address" ]]

free_tcp_port() {
  python3 - <<'PY'
import socket
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
}

free_udp_port() {
  BENCH_BIND_ADDRESS="$address" python3 - <<'PY'
import os, socket
with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
    sock.bind((os.environ['BENCH_BIND_ADDRESS'], 0))
    print(sock.getsockname()[1])
PY
}

http_port="$(free_tcp_port)"
https_port="$(free_tcp_port)"
jicofo_port="$(free_tcp_port)"
jvb_health_port="$(free_tcp_port)"
jvb_port="$(free_udp_port)"

bench_state="$(mktemp -d /tmp/elise-jitsi-bench.XXXXXXXX)"
project="elise-calls-engine-${profile}-$$"
bench_network="${project}-api"
firewall_table="elise_calls_bench_$$"
compose=(docker compose --project-name "$project" -f docker/jitsi/compose.yaml)

cleanup() {
  local rc=$?
  if ((rc != 0)); then
    "${compose[@]}" logs --no-color --tail 120 >&2 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker network rm "$bench_network" >/dev/null 2>&1 || true
  sudo -n nft delete table inet "$firewall_table" >/dev/null 2>&1 || true
  case "$bench_state" in
    /tmp/elise-jitsi-bench.*) sudo -n rm -rf -- "$bench_state" ;;
  esac
  return "$rc"
}
trap cleanup EXIT INT TERM

docker network create "$bench_network" >/dev/null
sudo -n nft add table inet "$firewall_table"
sudo -n nft add chain inet "$firewall_table" bench_input \
  '{ type filter hook input priority -5; policy accept; }'
sudo -n nft add chain inet "$firewall_table" bench_output \
  '{ type filter hook output priority -5; policy accept; }'
install -d -m 0777 \
  "$bench_state/config/web/crontabs" \
  "$bench_state/config/web/load-test" \
  "$bench_state/config/transcripts" \
  "$bench_state/config/prosody/config/data" \
  "$bench_state/config/prosody/prosody-plugins-custom" \
  "$bench_state/config/jicofo" \
  "$bench_state/config/jvb"

export CONFIG="$bench_state/config"
export ELISE_BENCH_NFT_TABLE="$firewall_table"
export ELISE_DOCKER_NETWORK="$bench_network"
export ELISE_JITSI_BIND_IP="$address"
export HTTP_PORT="$http_port"
export JICOFO_REST_PORT="$jicofo_port"
export JVB_COLIBRI_PORT="$jvb_health_port"
export JVB_PORT="$jvb_port"
export PUBLIC_URL="https://127.0.0.1:$https_port"
export DISABLE_HTTPS=1
export ENABLE_AUTH=0
export ENABLE_GUESTS=1
export AUTH_TYPE=internal
export JICOFO_AUTH_PASSWORD=benchmark-jicofo-password
export JVB_AUTH_PASSWORD=benchmark-jvb-password
export JVB_ADVERTISE_IPS="$address#$jvb_port"
export JVB_DISABLE_STUN=1
export ENABLE_PREJOIN_PAGE=0
export ENABLE_WELCOME_PAGE=0
export ENABLE_CLOSE_PAGE=0
export ENABLE_RECORDING=0
export ENABLE_LIVESTREAMING=0
export ENABLE_TRANSCRIPTIONS=0
export ENABLE_XMPP_WEBSOCKET=0
export MAX_PARTICIPANTS=2
export RESOLUTION=720
export RESOLUTION_WIDTH=1280
export TZ=UTC

if [[ "$profile" == optimized ]]; then
  export ENABLE_P2P=1
  export ENABLE_LOBBY=0
  export ENABLE_BREAKOUT_ROOMS=0
  export DISABLE_LOCAL_RECORDING=1
  export DISABLE_AUDIO_LEVELS=1
  export ENABLE_AUDIO_PROCESSING=1
  export ENABLE_AUTOMATIC_GAIN_CONTROL=1
  export ENABLE_NO_AUDIO_DETECTION=0
  export ENABLE_NOISY_MIC_DETECTION=0
  export ENABLE_OPUS_RED=1
  export ENABLE_SIMULCAST=1
  export ENABLE_ADAPTIVE_MODE=1
  export DISABLE_DEEP_LINKING=1
  export DISABLE_POLLS=1
  export DISABLE_PRIVATE_CHAT=1
  export DISABLE_REACTIONS=1
  export ENABLE_CODEC_AV1=0
  export ENABLE_CODEC_VP9=0
  export ENABLE_CODEC_VP8=1
  export ENABLE_CODEC_H264=1
  export ENABLE_CODEC_OPUS_RED=1
  export CODEC_ORDER_JVB='["VP8", "H264"]'
  export CODEC_ORDER_JVB_MOBILE='["VP8", "H264"]'
  export CODEC_ORDER_P2P='["VP8", "H264"]'
  export CODEC_ORDER_P2P_MOBILE='["VP8", "H264"]'
  export VIDEOQUALITY_BITRATE_VP8_LOW=180000
  export VIDEOQUALITY_BITRATE_VP8_STANDARD=500000
  export VIDEOQUALITY_BITRATE_VP8_HIGH=1200000
  export VIDEOQUALITY_BITRATE_H264_LOW=180000
  export VIDEOQUALITY_BITRATE_H264_STANDARD=500000
  export VIDEOQUALITY_BITRATE_H264_HIGH=1200000
else
  export ENABLE_P2P=0
fi

"${compose[@]}" up -d
for _ in $(seq 1 90); do
  if curl -fs "http://127.0.0.1:$http_port/config.js" >/dev/null \
    && curl -fs "http://127.0.0.1:$jvb_health_port/about/health" >/dev/null; then
    break
  fi
  sleep 1
done
curl -fs "http://127.0.0.1:$http_port/config.js" >/dev/null
curl -fs "http://127.0.0.1:$jvb_health_port/about/health" >/dev/null

if [[ "$profile" == optimized ]]; then
  server_config="$(curl -fs "http://127.0.0.1:$http_port/config.js")"
  for expected in \
    'enabled: true' \
    'config.hideAddRoomButton = true' \
    'config.enableOpusRed = true' \
    'config.disableAudioLevels = true' \
    'config.enableNoisyMicDetection = false' \
    'config.videoQuality.codecPreferenceOrder = ["VP8", "H264"]' \
    'config.videoQuality.vp8.low = 180000' \
    'config.videoQuality.vp8.high = 1200000'; do
    grep -Fq "$expected" <<<"$server_config" || {
      echo "generated Jitsi config is missing: $expected" >&2
      exit 1
    }
  done
fi

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$bench_state/benchmark.key" \
  -out "$bench_state/benchmark.crt" \
  -days 1 \
  -subj /CN=127.0.0.1 \
  -addext subjectAltName=IP:127.0.0.1 \
  >/dev/null 2>&1

corepack pnpm --filter @elise/contracts build >/dev/null
mkdir -p "$(dirname "$output")"
node scripts/jitsi-quality-benchmark.mjs \
  --profile "$profile" \
  --jitsi "https://127.0.0.1:$https_port" \
  --jitsi-backend "http://127.0.0.1:$http_port" \
  --tls-key "$bench_state/benchmark.key" \
  --tls-cert "$bench_state/benchmark.crt" \
  --output "$output"

echo "Jitsi benchmark written to $output"
