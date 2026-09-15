#!/usr/bin/env bash
# One-command installation from a source checkout, including the resident TV package.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="${ELISE_VERSION:-dev}"

if [[ "$EUID" -ne 0 ]]; then
  exec sudo env ELISE_SOURCE_DIR="$root" ELISE_VERSION="$version" \
    bash "$root/install/install-elise.sh"
fi

ELISE_SOURCE_DIR="$root" ELISE_VERSION="$version" \
  bash "$root/install/install-elise.sh"
