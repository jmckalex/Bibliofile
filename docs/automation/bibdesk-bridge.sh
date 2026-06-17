#!/usr/bin/env bash
# Call a running BibDesk's local automation bridge (loopback, token-authed).
#
# The app writes its port + token to:
#   ~/Library/Application Support/BibDesk/bridge.json   (macOS)
#   $XDG_CONFIG_HOME/BibDesk/bridge.json or ~/.config/BibDesk/bridge.json (Linux)
#   %APPDATA%\BibDesk\bridge.json                       (Windows)
# Override the path with BIBDESK_BRIDGE_JSON.
#
# Usage:
#   bibdesk-bridge.sh ping
#   bibdesk-bridge.sh list
#   bibdesk-bridge.sh get   '&citeKey=knuth1984'
#   bibdesk-bridge.sh search '&q=bargaining'
#   bibdesk-bridge.sh export '&format=ris'
#   bibdesk-bridge.sh add    '&type=article&Title=Hello&Author=Ada%20Lovelace'
#   bibdesk-bridge.sh set    '&citeKey=knuth1984&field=Year&value=1984'
set -euo pipefail

CFG="${BIBDESK_BRIDGE_JSON:-$HOME/Library/Application Support/BibDesk/bridge.json}"
if [ ! -f "$CFG" ]; then
  echo '{"ok":false,"error":"BibDesk is not running (no bridge.json found)"}' >&2
  exit 1
fi

read_json() { /usr/bin/python3 -c "import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$CFG" "$1"; }
PORT="$(read_json port)"
TOKEN="$(read_json token)"
METHOD="${1:?usage: bibdesk-bridge.sh <method> [extra-query]}"
EXTRA="${2:-}"

curl -sS "http://127.0.0.1:${PORT}/${METHOD}?token=${TOKEN}${EXTRA}"
