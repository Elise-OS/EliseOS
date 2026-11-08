#!/usr/bin/env bash
# Install a pinned cosign without depending on a single GitHub release download.
#
# GitHub release downloads (github.com/.../releases/download/...) sometimes answer
# 504 for long stretches, which made sigstore/cosign-installer fail whole releases.
# 1. Download the pinned binary with retries and check its SHA-256.
# 2. If GitHub stays unavailable, build the same version from the Go module proxy
#    (proxy.golang.org, verified against sum.golang.org).
set -euo pipefail

COSIGN_VERSION="v2.5.2"
# sha256 of cosign-linux-amd64 for COSIGN_VERSION (from the official release assets).
COSIGN_LINUX_AMD64_SHA256="bcfeae05557a9f313ee4392d2f335d0ff69ebbfd232019e3736fb04999fe1734"
INSTALL_DIR="${COSIGN_INSTALL_DIR:-$HOME/.cosign}"
mkdir -p "$INSTALL_DIR"
echo "$INSTALL_DIR" >> "${GITHUB_PATH:-/dev/null}"

installed() {
  "$INSTALL_DIR/cosign" version 2>/dev/null | grep -q "${COSIGN_VERSION#v}"
}

if [[ "$(uname -s)-$(uname -m)" == "Linux-x86_64" ]]; then
  url="https://github.com/sigstore/cosign/releases/download/${COSIGN_VERSION}/cosign-linux-amd64"
  tmp="$(mktemp)"
  for attempt in 1 2 3 4 5 6; do
    if curl -fsSL --retry 4 --retry-all-errors --retry-delay 5 --connect-timeout 20 -o "$tmp" "$url" \
      && echo "${COSIGN_LINUX_AMD64_SHA256}  $tmp" | sha256sum -c --quiet -; then
      install -m 0755 "$tmp" "$INSTALL_DIR/cosign"
      break
    fi
    echo "cosign download attempt $attempt failed, retrying in $((attempt * 15)) s" >&2
    sleep $((attempt * 15))
  done
  rm -f "$tmp"
fi

if ! installed; then
  echo "Falling back to building cosign ${COSIGN_VERSION} from the Go module proxy" >&2
  command -v go >/dev/null || { echo "go is not available for the fallback" >&2; exit 1; }
  GOTOOLCHAIN=auto GOFLAGS=-mod=mod GOBIN="$INSTALL_DIR" \
    go install "github.com/sigstore/cosign/v2/cmd/cosign@${COSIGN_VERSION}"
fi

installed || { echo "cosign ${COSIGN_VERSION} could not be installed" >&2; exit 1; }
"$INSTALL_DIR/cosign" version | head -n 3
