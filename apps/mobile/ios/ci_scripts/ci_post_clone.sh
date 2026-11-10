#!/bin/bash
set -euo pipefail

repository_root="${CI_PRIMARY_REPOSITORY_PATH:?Xcode Cloud did not provide the repository path}"
exec "$repository_root/ci_scripts/ci_post_clone.sh"
