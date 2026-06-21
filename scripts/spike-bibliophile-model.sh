#!/usr/bin/env bash
#
# Phase 2 de-risk: prove the native Cocoa-Scripting PROXY MODEL against the real
# Bibliofile.sdef, using canned data (app/native/scripting/test/model-main.js).
# Drives genuine AppleScript object specifiers -- count / by-index / every /
# property reads / a write -- through native proxy objects that call `dispatch`.
# macOS only.
#
# Usage:  bash scripts/spike-bibliophile-model.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ADDON_DIR="app/native/scripting"
ELECTRON_APP=$(/usr/bin/find node_modules -maxdepth 7 -name Electron.app -type d 2>/dev/null | head -1)
[ -n "$ELECTRON_APP" ] || { echo "Electron.app not found (run pnpm install)"; exit 1; }
ELECTRON_VER=$(printf '%s' "$ELECTRON_APP" | grep -oE 'electron@[0-9][0-9.]*' | head -1 | sed 's/electron@//')
[ -n "$ELECTRON_VER" ] || { echo "could not determine Electron version"; exit 1; }

NODE_GYP=$(node -e "const{resolve}=require('path'),{existsSync}=require('fs');console.log([resolve(process.execPath,'../../lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js'),resolve(process.execPath,'../../libexec/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js')].find(existsSync)||'')")
echo "Building addon for Electron ${ELECTRON_VER} ..."
( cd "$ADDON_DIR" && PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH" \
  node "$NODE_GYP" rebuild --release --target="$ELECTRON_VER" --arch="$(node -p process.arch)" \
  --dist-url=https://electronjs.org/headers >/tmp/bibliophile-addon-build.log 2>&1 ) \
  || { echo "addon build FAILED:"; tail -15 /tmp/bibliophile-addon-build.log; exit 1; }
ADDON="$ADDON_DIR/build/Release/bibliophile_scripting.node"

BUNDLE_ID="org.bibdesk.bibliophile.model"
WORK="/tmp/bibliophile-model"
APP="$WORK/Bibliofile.app"
PLIST="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
cleanup() { osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
            pkill -f "bibliophile-model" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

rm -rf "$WORK"; mkdir -p "$WORK"
cp -R "$ELECTRON_APP" "$APP"
mkdir -p "$APP/Contents/Resources/app"
cp "$ADDON_DIR/test/model-main.js" "$APP/Contents/Resources/app/main.js"
printf '{"name":"bibliophile-model","main":"main.js","private":true}\n' > "$APP/Contents/Resources/app/package.json"
cp "$ADDON" "$APP/Contents/Resources/app/bibliophile_scripting.node"
cp app/scripting/Bibliofile.sdef "$APP/Contents/Resources/Bibliofile.sdef"
$PB -c "Set :CFBundleName Bibliofile" "$PLIST"
$PB -c "Set :CFBundleIdentifier $BUNDLE_ID" "$PLIST"
$PB -c "Add :NSAppleScriptEnabled bool true" "$PLIST" 2>/dev/null || $PB -c "Set :NSAppleScriptEnabled true" "$PLIST"
$PB -c "Add :OSAScriptingDefinition string Bibliofile.sdef" "$PLIST" 2>/dev/null || $PB -c "Set :OSAScriptingDefinition Bibliofile.sdef" "$PLIST"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1

open -g "$APP"
# wait until scriptable
for _ in $(seq 1 30); do
  r=$(osascript -e "tell application id \"$BUNDLE_ID\" to count documents" 2>&1 || true)
  case "$r" in 1) break;; esac
done

as() { osascript -e "tell application id \"$BUNDLE_ID\"" -e "$1" -e "end tell" 2>&1; }
pass=1
check() { # desc, expr, expected
  local got; got=$(as "$2")
  if [ "$got" = "$3" ]; then echo "  ok   $1 => $got"; else echo "  FAIL $1 => got [$got] want [$3]"; pass=0; fi
}

echo "Driving real AppleScript object specifiers (canned data):"
check "count documents"                         "count documents" "1"
check "name of document 1"                      "get name of document 1" "sample.bib"
check "count publications of document 1"        "count publications of document 1" "2"
check "cite key of publication 1 of document 1" "get cite key of publication 1 of document 1" "smith2020"
check "type of publication 1 of document 1"     "get type of publication 1 of document 1" "article"
check "cite key of publication 2 of document 1" "get cite key of publication 2 of document 1" "jones2019"
check "cite key of every publication of doc 1"  "get cite key of every publication of document 1" "smith2020, jones2019"
# a write, then read back
as "set cite key of publication 1 of document 1 to \"Smith:2020\"" >/dev/null
check "write then read cite key"                "get cite key of publication 1 of document 1" "Smith:2020"

[ "$pass" = 1 ] && { echo "PASS - native proxy model works over real AppleScript."; exit 0; } \
                 || { echo "FAIL - one or more specifiers did not resolve."; exit 1; }
