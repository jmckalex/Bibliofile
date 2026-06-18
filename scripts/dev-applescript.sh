#!/usr/bin/env bash
#
# Make the LIVE app scriptable for development. AppleScript needs a real .app
# bundle with the sdef + Info.plist keys, but `electron-vite dev`/`preview` run
# the dev Electron.app. This patches THAT bundle (renames it "Bibliophile",
# enables AppleScript, installs the sdef) and ad-hoc re-signs, then builds the
# native addon. After running this, the live app exposes the dictionary:
#
#   bash scripts/dev-applescript.sh
#   pnpm build:app && pnpm --filter @bibdesk/app start   # or: pnpm dev
#   # open a .bib, then in Script Editor / osascript:
#   tell application "Bibliophile" to get cite key of every publication of document 1
#
# Side effect: the shared dev Electron.app is renamed/re-signed (reset by
# `pnpm install`). macOS only.
set -euo pipefail
cd "$(dirname "$0")/.."

ADDON_DIR="app/native/scripting"
ELECTRON_APP=$(/usr/bin/find node_modules -maxdepth 7 -name Electron.app -type d 2>/dev/null | head -1)
[ -n "$ELECTRON_APP" ] || { echo "Electron.app not found (run pnpm install)"; exit 1; }
ELECTRON_VER=$(printf '%s' "$ELECTRON_APP" | grep -oE 'electron@[0-9][0-9.]*' | head -1 | sed 's/electron@//')

# Build the native addon for the Electron ABI.
NODE_GYP=$(node -e "const{resolve}=require('path'),{existsSync}=require('fs');console.log([resolve(process.execPath,'../../lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js'),resolve(process.execPath,'../../libexec/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js')].find(existsSync)||'')")
echo "Building native addon for Electron ${ELECTRON_VER} ..."
( cd "$ADDON_DIR" && PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH" \
  node "$NODE_GYP" rebuild --release --target="$ELECTRON_VER" --arch="$(node -p process.arch)" \
  --dist-url=https://electronjs.org/headers >/tmp/bibliophile-addon-build.log 2>&1 ) \
  || { echo "addon build FAILED:"; tail -15 /tmp/bibliophile-addon-build.log; exit 1; }

# Patch the dev Electron.app bundle.
PLIST="$ELECTRON_APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
echo "Patching $(basename "$(dirname "$(dirname "$ELECTRON_APP")")")/Electron.app -> Bibliophile (scriptable) ..."
$PB -c "Set :CFBundleName Bibliophile" "$PLIST"
$PB -c "Add :CFBundleDisplayName string Bibliophile" "$PLIST" 2>/dev/null || $PB -c "Set :CFBundleDisplayName Bibliophile" "$PLIST"
$PB -c "Add :NSAppleScriptEnabled bool true" "$PLIST" 2>/dev/null || $PB -c "Set :NSAppleScriptEnabled true" "$PLIST"
$PB -c "Add :OSAScriptingDefinition string Bibliophile.sdef" "$PLIST" 2>/dev/null || $PB -c "Set :OSAScriptingDefinition Bibliophile.sdef" "$PLIST"
cp app/scripting/Bibliophile.sdef "$ELECTRON_APP/Contents/Resources/Bibliophile.sdef"
codesign --force --deep --sign - "$ELECTRON_APP" >/dev/null 2>&1

echo "Done. The live app is now scriptable as \"Bibliophile\"."
echo "Run it (built):  pnpm build:app && pnpm --filter @bibdesk/app start"
echo "or (dev server): pnpm dev"
echo "Then open a .bib and script it, e.g.:"
echo "  osascript -e 'tell application \"Bibliophile\" to get cite key of every publication of document 1'"
