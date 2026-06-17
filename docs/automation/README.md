# Automation (`x-bibdesk://` URL scheme)

A running BibDesk registers the **`x-bibdesk://`** URL scheme, so AppleScript,
shell scripts, browser bookmarklets, and other apps can drive it.

> **Scope / honesty:** this is the cross-platform automation hook achievable in
> Electron. A full macOS AppleScript *dictionary* (`.sdef` — a scriptable object
> model whose commands return values, e.g. `tell application "BibDesk" to get
> title of publication 1`) requires a native Cocoa scripting bridge, which is a
> native-addon project rather than something pure Electron exposes. The URL scheme
> covers fire-and-forget **commands**; for **queries / data back out**, use the
> JS plugin API (`@bibdesk/plugins-sdk`) or the in-app Claude assistant. A
> query-capable command-line tool built on `plugins-sdk` is the planned next step.

## Commands

| URL | Effect |
|-----|--------|
| `x-bibdesk://open?file=<abs path>` | Open a `.bib` file |
| `x-bibdesk://import?doi=<doi>` | Look the DOI up (CrossRef) and import it into the open library |
| `x-bibdesk://import?bibtex=<url-encoded BibTeX>` | Import pasted BibTeX into the open library |
| `x-bibdesk://new?type=<type>&<Field>=<value>&…` | Add a new entry from the given fields |

Mutating commands act on the **currently open** document and refresh the window.

## AppleScript

```applescript
-- Open a library
open location "x-bibdesk://open?file=/Users/me/refs.bib"

-- Import a DOI
open location "x-bibdesk://import?doi=10.1023/A:1005239929271"

-- Add an entry from fields (values URL-encoded)
open location "x-bibdesk://new?type=article&Title=On%20Bullshit&Author=Harry%20Frankfurt&Year=2005"
```

See `bibdesk.applescript` for a runnable example, including how to URL-encode a
full BibTeX record before importing.

## Shell / anything

```sh
open "x-bibdesk://import?doi=10.1126/science.1058040"   # macOS
xdg-open "x-bibdesk://open?file=$PWD/refs.bib"          # Linux
```
