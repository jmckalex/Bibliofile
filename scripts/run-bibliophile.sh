#!/usr/bin/env bash
#
# Launch the LIVE, AppleScript-enabled app for testing. It runs the patched dev
# Electron.app via LaunchServices (`open`), which is REQUIRED for macOS to load
# the scripting dictionary -- a plain CLI spawn (`pnpm dev`/`preview`) does not.
#
# One-time setup:
#   bash scripts/dev-applescript.sh          # patch the bundle + build the addon
#   pnpm --filter @bibdesk/app run build:app # build out/
# Then:
#   bash scripts/run-bibliophile.sh [path/to/library.bib]
#   # quit normally with Cmd-Q when done. Then from Script Editor / osascript:
#   tell application "Bibliophile" to get cite key of every publication of document 1
#
# macOS only.
set -euo pipefail
cd "$(dirname "$0")/.."

EAPP=$(/usr/bin/find node_modules -maxdepth 7 -name Electron.app -type d 2>/dev/null | head -1)
[ -n "$EAPP" ] || { echo "Electron.app not found (run pnpm install)"; exit 1; }
[ -f app/out/main/index.js ] || { echo "Build first: pnpm --filter @bibdesk/app run build:app"; exit 1; }

APPDIR="$PWD/app"
BIB="${1:-}"
if [ -n "$BIB" ]; then
  open -n "$EAPP" --args "$APPDIR" "$BIB"
else
  open -n "$EAPP" --args "$APPDIR"
fi
echo "Launched Bibliophile via LaunchServices. Quit with Cmd-Q when done."
echo "Test it, e.g.:"
echo "  osascript -e 'tell application \"Bibliophile\" to count documents'"
echo "  osascript -e 'tell application \"Bibliophile\" to get cite key of every publication of document 1'"
