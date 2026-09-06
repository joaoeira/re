#!/bin/bash
set -euo pipefail
screen="${1:?usage: launch.sh create|review}"
pocket_app="$(cd -- "$(dirname -- "$0")/.." && pwd)/dist/re Pocket.app"
if [[ ! -d "$pocket_app" ]]; then
  echo 'Build re Pocket first with bun run overlay:build.' >&2
  exit 1
fi
pocket_support="$HOME/Library/Application Support/re-pocket"
mkdir -p "$pocket_support"
pocket_request=$(mktemp "$pocket_support/launch.XXXXXX")
trap 'rm -f -- "$pocket_request"' EXIT
printf '%s\n' "$screen" > "$pocket_request"
mv -f -- "$pocket_request" "$pocket_support/launch-request"
open -a "$pocket_app"
