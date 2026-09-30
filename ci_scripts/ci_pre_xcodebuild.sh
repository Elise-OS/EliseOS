#!/bin/bash
set -euo pipefail

if [[ "${CI_PRODUCT_PLATFORM:-}" != "iOS" || "${CI_XCODEBUILD_ACTION:-}" != "archive" ]]; then
  exit 0
fi

repository_root="${CI_PRIMARY_REPOSITORY_PATH:?Xcode Cloud did not provide the repository path}"
build_number="${CI_BUILD_NUMBER:?Xcode Cloud did not provide the build number}"
node_binary="$(brew --prefix node@24)/bin/node"

if [[ ! "$build_number" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid Xcode Cloud build number: $build_number" >&2
  exit 1
fi
if [[ ! -x "$node_binary" ]]; then
  echo "Node.js 24 is unavailable at $node_binary." >&2
  exit 1
fi

version_name="$("$node_binary" -e '
const fs = require("node:fs");
const current = JSON.parse(fs.readFileSync("apps/mobile/app.json", "utf8")).expo.version;
const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(current);
if (!match) throw new Error(`Invalid mobile app version: ${current}`);
console.log(`${match[1]}.${match[2]}.${Number(match[3]) + 1}`);
')"

cd "$repository_root/apps/mobile/ios"
xcrun agvtool new-marketing-version "$version_name"
xcrun agvtool new-version -all "$build_number"
echo "iOS archive version: $version_name (build $build_number)"
