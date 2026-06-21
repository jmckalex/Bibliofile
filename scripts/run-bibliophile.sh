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
#   tell application "Bibliofile" to get cite key of every publication of document 1
#
# macOS only.
set -euo pipefail
cd "$(dirname "$0")/.."

EAPP=$(/usr/bin/find node_modules -maxdepth 7 -name Electron.app -type d 2>/dev/null | head -1)
[ -n "$EAPP" ] || { echo "Electron.app not found (run pnpm install)"; exit 1; }
[ -f app/out/main/index.js ] || { echo "Build first: pnpm --filter @bibdesk/app run build:app"; exit 1; }

APPDIR="$PWD/app"
BIB="${1:-}"

# Quit any already-running instance FIRST. The app holds a single-instance lock,
# so otherwise this launch would be routed into the existing (possibly stale)
# process and a rebuild would silently have no effect.
osascript -e 'tell application id "org.bibdesk.bibliophile" to quit' >/dev/null 2>&1 || true
pkill -f "MacOS/Electron .*/bibdesk-electron/app" >/dev/null 2>&1 || true
for _ in 1 2 3 4 5 6; do
  pgrep -f "MacOS/Electron .*/bibdesk-electron/app" >/dev/null 2>&1 || break
  sleep 0.3
done

if [ -n "$BIB" ]; then
  open -n "$EAPP" --args "$APPDIR" "$BIB"
else
  open -n "$EAPP" --args "$APPDIR"
fi
echo "Launched Bibliofile via LaunchServices. Quit with Cmd-Q when done."
echo "Test it, e.g.:"
echo "  osascript -e 'tell application \"Bibliofile\" to count documents'"
echo "  osascript -e 'tell application \"Bibliofile\" to get cite key of every publication of document 1'"
