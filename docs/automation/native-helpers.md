# Automation architecture & native helper apps

Per the project decision, automation is **not** done purely in Electron. Instead the
Electron app exposes a small local **bridge**, and thin, OS-native helper apps
translate each platform's scripting world into bridge calls. This keeps the
hard, platform-specific surface (AppleScript dictionaries, COM, D-Bus) in tiny
native shims while all the real work stays in the shared TypeScript core.

```
AppleScript / PowerShell / D-Bus / shell
              │  (native, per-OS)
        ┌─────┴─────┐
        │  helper   │   reads bridge.json, calls the bridge
        └─────┬─────┘
              │  HTTP (127.0.0.1, token)
     ┌────────┴─────────┐
     │  BibDesk (Electron) bridge  │  dispatchBridge → DocumentStore
     └──────────────────┘
```

## The bridge (shipped, tested)

On launch the app starts a **loopback HTTP server** (127.0.0.1, ephemeral port) with
a per-launch token, and writes discovery info to `bridge.json` under userData
(`…/Application Support/BibDesk/bridge.json` on macOS). It is loopback-only and
token-authed, so it's off the network and isolated from other local users.

Methods (GET, `?token=…` + params; mutations return `"mutated": true`):

| Method | Params | Returns |
|--------|--------|---------|
| `ping` | — | `{ok, methods[]}` |
| `list` | — | `{ok, entries:[{citeKey,title,type,year}]}` |
| `get` | `citeKey` | `{ok, entry:{citeKey,type,fields}}` |
| `search` | `q` | `{ok, entries:[{citeKey,title}]}` |
| `export` | `format` (bibtex/ris/csv/html) | `{ok, text}` |
| `add` | `type`, `<Field>=…` | `{ok, mutated, citeKey}` |
| `set` | `citeKey`, `field`, `value` | `{ok, mutated}` |

`bibdesk-bridge.sh` is a ready shell client; AppleScript/automation can call it
via `do shell script`, or hit the bridge directly with `curl`.

## Native helpers — status & plan

These are the per-OS shims. They are **scaffolded/planned**, not yet compiled:
building + code-signing them requires each platform's toolchain (Xcode, MSVC,
etc.) and is follow-up work outside the pure-TS build.

- **macOS — AppleScript `.sdef` helper.** A tiny Swift/Cocoa agent app declaring a
  scripting dictionary (`make/get/set publication`, `search`, `export`). Each
  command reads `bridge.json` and forwards to the bridge, returning values back to
  AppleScript (which the one-way `x-bibdesk://` scheme can't). Today, the
  `bibdesk-bridge.sh` + `do shell script` path already gives working AppleScript
  control; the `.sdef` app is the polished `tell application "BibDesk" to …` form.
- **Windows — PowerShell module / COM shim.** A `BibDesk.psd1` module exposing
  `Get-BibDeskEntry`, `Add-BibDeskEntry`, etc., wrapping `Invoke-RestMethod` against
  the bridge. A COM shim can come later for VBA/Office.
- **Linux — D-Bus service or CLI.** A small D-Bus service (or just the shell client)
  bridging `gdbus`/scripts to the bridge.

## Why not a full Cocoa scripting bridge inside Electron?
Electron doesn't route Apple Events / `NSScriptCommand` into JS; a real `.sdef`
object model needs native Cocoa code. Rather than a brittle native addon embedded
in the renderer process, the bridge + small native helper apps keep the native
surface minimal and the logic shared.
