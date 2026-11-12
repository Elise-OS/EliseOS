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

bench_state="$(mktemp -d /tmp/elise-jitsi-bench.XXXXXXXX)"
project="elise-calls-engine-${profile}-$$"
bench_network="${project}-api"
compose=(docker compose --project-name "$project" -f docker/jitsi/compose.yaml)

cleanup() {
  local rc=$?
  if ((rc != 0)); then
    "${compose[@]}" logs --no-color --tail 120 >&2 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker network rm "$bench_network" >/dev/null 2>&1 || true
  case "$bench_state" in
    /tmp/elise-jitsi-bench.*) sudo -n rm -rf -- "$bench_state" ;;
  esac
  return "$rc"
}
trap cleanup EXIT INT TERM

docker network create "$bench_network" >/dev/null
install -d -m 0777 \
  "$bench_state/config/web/crontabs" \
  "$bench_state/config/web/load-test" \
  "$bench_state/config/transcripts" \
  "$bench_state/config/prosody/config/data" \
  "$bench_state/config/prosody/prosody-plugins-custom" \
  "$bench_state/config/jicofo" \
  "$bench_state/config/jvb"

export CONFIG="$bench_state/config"
export ELISE_DOCKER_NETWORK="$bench_network"
export ELISE_JITSI_BIND_IP="$address"
export HTTP_PORT=18183
export JICOFO_REST_PORT=18988
export JVB_COLIBRI_PORT=18185
export JVB_PORT=11000
export PUBLIC_URL=https://127.0.0.1:18184
export DISABLE_HTTPS=1
export ENABLE_AUTH=0
export ENABLE_GUESTS=1
export AUTH_TYPE=internal
export JICOFO_AUTH_PASSWORD=benchmark-jicofo-password
export JVB_AUTH_PASSWORD=benchmark-jvb-password
export JVB_ADVERTISE_IPS="$address#11000"
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
  export DISABLE_AUDIO_LEVELS=1
  export ENABLE_NO_AUDIO_DETECTION=0
  export ENABLE_NOISY_MIC_DETECTION=0
  export ENABLE_SIMULCAST=1
  export ENABLE_ADAPTIVE_MODE=1
  export DISABLE_DEEP_LINKING=1
  export DISABLE_POLLS=1
  export DISABLE_PRIVATE_CHAT=1
  export DISABLE_REACTIONS=1
else
  export ENABLE_P2P=0
fi

"${compose[@]}" up -d
for _ in $(seq 1 90); do
  if curl -fs http://127.0.0.1:18183/config.js >/dev/null \
    && curl -fs http://127.0.0.1:18185/about/health >/dev/null; then
    break
  fi
  sleep 1
done
curl -fs http://127.0.0.1:18183/config.js >/dev/null
curl -fs http://127.0.0.1:18185/about/health >/dev/null

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
  --jitsi https://127.0.0.1:18184 \
  --jitsi-backend http://127.0.0.1:18183 \
  --tls-key "$bench_state/benchmark.key" \
  --tls-cert "$bench_state/benchmark.crt" \
  --output "$output"

echo "Jitsi benchmark written to $output"
