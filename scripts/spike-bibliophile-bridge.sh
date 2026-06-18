#!/usr/bin/env bash
#
# Phase 1 de-risk spike: prove the NATIVE AppleScript -> JS bridge.
#
# Assembles a throwaway Bibliophile.app from the dev Electron.app whose main
# process is app/native/scripting/test/main.js (registers a JS handler), bundles
# the native addon, declares a custom `bibliophile query` command in a test sdef,
# ad-hoc signs, launches, and sends `bibliophile query "hello"` via osascript.
# A PASS means the string came back transformed by the JS handler — i.e. an Apple
# Event round-tripped native -> JS -> native -> AppleScript. macOS only.
#
# Prereq: the addon is built for the Electron ABI. This script (re)builds it.
# Usage:  bash scripts/spike-bibliophile-bridge.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ADDON_DIR="app/native/scripting"
ELECTRON_APP=$(/usr/bin/find node_modules -maxdepth 7 -name Electron.app -type d 2>/dev/null | head -1)
[ -n "$ELECTRON_APP" ] || { echo "Electron.app not found (run pnpm install)"; exit 1; }
ELECTRON_VER=$(printf '%s' "$ELECTRON_APP" | grep -oE 'electron@[0-9][0-9.]*' | head -1 | sed 's/electron@//')
[ -n "$ELECTRON_VER" ] || ELECTRON_VER=$(node -e "console.log(require('electron/package.json').version)" 2>/dev/null || true)
[ -n "$ELECTRON_VER" ] || { echo "could not determine Electron version"; exit 1; }

# --- build the addon for the Electron ABI -----------------------------------
NODE_GYP=$(node -e "const{resolve}=require('path'),{existsSync}=require('fs');console.log([resolve(process.execPath,'../../lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js'),resolve(process.execPath,'../../libexec/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js')].find(existsSync)||'')")
[ -n "$NODE_GYP" ] || { echo "npm's node-gyp not found"; exit 1; }
echo "Building addon for Electron ${ELECTRON_VER} ..."
( cd "$ADDON_DIR" && PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH" \
  node "$NODE_GYP" rebuild --release --target="$ELECTRON_VER" --arch="$(node -p process.arch)" \
  --dist-url=https://electronjs.org/headers >/tmp/bibliophile-addon-build.log 2>&1 ) \
  || { echo "addon build FAILED (see /tmp/bibliophile-addon-build.log)"; tail -15 /tmp/bibliophile-addon-build.log; exit 1; }
ADDON="$ADDON_DIR/build/Release/bibliophile_scripting.node"
[ -f "$ADDON" ] || { echo "addon artifact missing"; exit 1; }

# --- assemble the test bundle ------------------------------------------------
BUNDLE_ID="org.bibdesk.bibliophile.bridge"
WORK="/tmp/bibliophile-bridge"
APP="$WORK/Bibliophile.app"
PLIST="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy

cleanup() { osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
            pkill -f "bibliophile-bridge" >/dev/null 2>&1 || true
            rm -rf "$WORK"; }
trap cleanup EXIT

rm -rf "$WORK"; mkdir -p "$WORK"
cp -R "$ELECTRON_APP" "$APP"
mkdir -p "$APP/Contents/Resources/app"
cp "$ADDON_DIR/test/main.js" "$ADDON_DIR/test/package.json" "$APP/Contents/Resources/app/"
cp "$ADDON" "$APP/Contents/Resources/app/bibliophile_scripting.node"
cp "$ADDON_DIR/test/Bridge.sdef" "$APP/Contents/Resources/Bridge.sdef"
$PB -c "Set :CFBundleName Bibliophile" "$PLIST"
$PB -c "Set :CFBundleIdentifier $BUNDLE_ID" "$PLIST"
$PB -c "Add :NSAppleScriptEnabled bool true" "$PLIST" 2>/dev/null || $PB -c "Set :NSAppleScriptEnabled true" "$PLIST"
$PB -c "Add :OSAScriptingDefinition string Bridge.sdef" "$PLIST" 2>/dev/null || $PB -c "Set :OSAScriptingDefinition Bridge.sdef" "$PLIST"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1

# --- launch + drive ----------------------------------------------------------
open -g "$APP"
out=""
for _ in $(seq 1 30); do
  r=$(osascript -e "tell application id \"$BUNDLE_ID\" to bibliophile query \"hello\"" 2>&1 || true)
  case "$r" in *"JS received"*) out="$r"; break;; esac
done

if [ -n "$out" ]; then
  echo "PASS — native AppleScript -> JS bridge works."
  echo "  sent:     bibliophile query \"hello\""
  echo "  received: $out"
  [ "$out" = "JS received [query] arg=[hello] len=5 upper=HELLO" ] \
    && echo "  (exact JS-computed result confirmed)" \
    || echo "  (note: result differs from expected literal)"
  exit 0
else
  echo "FAIL — no JS-bridged response. Last osascript output:"
  echo "  $r"
  exit 1
fi
