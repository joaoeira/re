#!/bin/bash
set -euo pipefail
screen="${1:?usage: launch.sh create|review}"
overlay_app="$(cd -- "$(dirname -- "$0")/.." && pwd)/dist/re Overlay.app"
if [[ ! -d "$overlay_app" ]]; then
  echo 'Build re Overlay first with bun run overlay:build.' >&2
  exit 1
fi
overlay_support="$HOME/Library/Application Support/re-overlay"
mkdir -p "$overlay_support"
overlay_request=$(mktemp "$overlay_support/launch.XXXXXX")
trap 'rm -f -- "$overlay_request"' EXIT
printf '%s\n' "$screen" > "$overlay_request"
mv -f -- "$overlay_request" "$overlay_support/launch-request"
open -a "$overlay_app"
