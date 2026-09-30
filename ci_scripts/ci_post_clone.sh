#!/bin/bash
set -euo pipefail

repository_root="${CI_PRIMARY_REPOSITORY_PATH:?Xcode Cloud did not provide the repository path}"
cd "$repository_root"

if ! command -v brew >/dev/null 2>&1; then
  echo "Xcode Cloud did not provide Homebrew, which is required to install Node.js." >&2
  exit 1
fi

export HOMEBREW_NO_AUTO_UPDATE=1
if ! brew list --versions node@24 >/dev/null 2>&1; then
  brew install node@24
fi
if ! brew list --versions ruby >/dev/null 2>&1; then
  brew install ruby
fi

node_bin="$(brew --prefix node@24)/bin"
ruby_bin="$(brew --prefix ruby)/bin"
if [[ ! -x "$ruby_bin/bundle" ]]; then
  echo "Xcode Cloud could not find Bundler with the Homebrew Ruby installation." >&2
  exit 1
fi
export PATH="$node_bin:$ruby_bin:$PATH"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" != "24" ]]; then
  echo "Expected Node.js 24 for the mobile workspace, found $(node --version)." >&2
  exit 1
fi

if command -v corepack >/dev/null 2>&1; then
  pnpm_exec() { corepack pnpm "$@"; }
else
  pnpm_exec() { npx --yes --package=pnpm@11.10.0 pnpm "$@"; }
fi

pnpm_version="$(pnpm_exec --version)"
if [[ "$pnpm_version" != "11.10.0" ]]; then
  echo "Expected pnpm 11.10.0, found $pnpm_version." >&2
  exit 1
fi

pnpm_exec install --frozen-lockfile
pnpm_exec --filter @michel/contracts build

# React Native's Xcode phase needs the same Node installation used above.
printf 'export NODE_BINARY="%s/node"\n' "$node_bin" > apps/mobile/ios/.xcode.env.local

cd apps/mobile/ios

export BUNDLE_GEMFILE="$repository_root/apps/mobile/ios/Gemfile"
export BUNDLE_PATH="${CI_DERIVED_DATA_PATH:-${TMPDIR:-/tmp}}/eliseos-ios-ruby-bundle"
export BUNDLE_FROZEN=true
export BUNDLE_JOBS=4
export BUNDLE_RETRY=3

bundle install
bundle exec pod install --deployment
