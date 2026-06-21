#!/usr/bin/env bash
#
# Phase 0 de-risk spike for the Bibliofile AppleScript dictionary.
#
# Proves that an Electron app can expose a NATIVE AppleScript dictionary
# (`tell application "Bibliofile" to ...`) using only:
#   - Info.plist  NSAppleScriptEnabled = true
#   - Info.plist  OSAScriptingDefinition = Bibliofile.sdef
#   - the sdef dropped in Contents/Resources
#   - an ad-hoc code signature (required on Apple Silicon after editing a bundle)
#
# It rebrands a COPY of the dev Electron.app (no app code / no packaging needed),
# launches it, queries it via osascript, prints PASS/FAIL, then cleans up. This
# documents the proven pipeline until real packaging (electron-builder) produces
# Bibliofile.app for us. macOS only.
#
# Usage:  bash scripts/spike-bibliophile-applescript.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ELECTRON_APP=$(/usr/bin/find node_modules -maxdepth 7 -name Electron.app -type d 2>/dev/null | head -1)
[ -n "$ELECTRON_APP" ] || { echo "Electron.app not found under node_modules (run pnpm install)"; exit 1; }

BUNDLE_ID="org.bibdesk.bibliophile.spike"
WORK="/tmp/bibliophile-spike"
APP="$WORK/Bibliofile.app"
PLIST="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy

cleanup() { osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
            pkill -f "bibliophile-spike" >/dev/null 2>&1 || true
            rm -rf "$WORK"; }
trap cleanup EXIT

rm -rf "$WORK"; mkdir -p "$WORK"
cp -R "$ELECTRON_APP" "$APP"
$PB -c "Set :CFBundleName Bibliofile" "$PLIST"
$PB -c "Add :CFBundleDisplayName string Bibliofile" "$PLIST" 2>/dev/null || $PB -c "Set :CFBundleDisplayName Bibliofile" "$PLIST"
$PB -c "Set :CFBundleIdentifier $BUNDLE_ID" "$PLIST"
$PB -c "Add :NSAppleScriptEnabled bool true" "$PLIST" 2>/dev/null || $PB -c "Set :NSAppleScriptEnabled true" "$PLIST"
$PB -c "Add :OSAScriptingDefinition string Bibliofile.sdef" "$PLIST" 2>/dev/null || $PB -c "Set :OSAScriptingDefinition Bibliofile.sdef" "$PLIST"
cp app/scripting/Bibliofile.sdef "$APP/Contents/Resources/Bibliofile.sdef"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1

open -g "$APP"
ok=""
for _ in $(seq 1 25); do
  v=$(osascript -e "tell application id \"$BUNDLE_ID\" to get version" 2>&1 || true)
  case "$v" in ''|*error*|*"isn't running"*|*"Can"*) ;; *) ok=1; break;; esac
done

if [ -n "$ok" ]; then
  echo "PASS — Bibliofile AppleScript pipeline works:"
  echo "  name      = $(osascript -e "tell application id \"$BUNDLE_ID\" to get name")"
  echo "  version   = $v"
  echo "  frontmost = $(osascript -e "tell application id \"$BUNDLE_ID\" to get frontmost")"
  exit 0
else
  echo "FAIL — no AppleScript response. Last: $v"
  exit 1
fi
