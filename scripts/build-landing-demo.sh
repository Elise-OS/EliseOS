#!/usr/bin/env bash
# Builds the public demo of the caregiver space into the landing site (eliselanding/public/demo).
# Run it again whenever the dashboard changes, then commit eliselanding.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${ELISE_DEMO_OUT_DIR:-$root/eliselanding/public/demo}"

cd "$root"
pnpm --filter @michel/contracts --filter @michel/ui build
ELISE_DEMO_OUT_DIR="$out" pnpm --filter @michel/dashboard build:demo
echo "Demo built in $out"
