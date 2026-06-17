# Handover — bibdesk-electron

> **Purpose.** This document lets a fresh session pick up the autonomous build of
> **bibdesk-electron** (a cross-platform Electron replacement for the classic
> macOS [BibDesk](https://bibdesk.sourceforge.io/)) without re-deriving project
> context. It records: the project goal and standing constraints, how to run /
> test / commit, the work shipped in the most recent session, and — most
> importantly — the **gap analysis** (what is still missing from BibDesk, and the
> recommended order to tackle it).

Last updated at commit `6da935d` (working tree clean; full suite green).

---

## 1. Project goal

Build a complete, cross-platform Electron **replacement for BibDesk** at
`/Users/jalex/Source/BibDesk/bibdesk-electron/`.

- The original Objective-C BibDesk at `/Users/jalex/Source/BibDesk/bibdesk/` is a
  **read-only reference for truth** — consult it to understand correct behaviour,
  but **modernize**. It is old and not what we want to deliver; do not port its UI
  or architecture verbatim.
- The user's `.bib` (BibTeX) file remains the **single source of truth**. No
  hidden database of record; SQLite is only a search index and caches.
- Work is **autonomous and multi-hour**: keep building, keep the logs aligned,
  commit as you go.

### Standing constraints (preserve these verbatim)

- `bibdesk/` is **read-only** — reference only, never edit, modernize rather than
  copy.
- The Anthropic API key is stored via Electron **safeStorage** (encrypted at
  `~/Library/Application Support/BibDesk/agent-key.bin`) — **never** in
  settings.json or anything reachable from the renderer.
- **Claude-agent mutations require user approval** before they touch the library.
- The automation bridge must be **loopback (127.0.0.1) + token only**.
- Journal covers are publisher-copyrighted; **the user explicitly authorized**
  downloading and bundling them. Keep them under `app/resources/journals/covers/`.
- When spawning subagents: **scope them to specific directories, do not let them
  touch code, and do not let them run git.**
- **Commit to local git only — never push.** Stay on `main` (the established
  autonomous-build history is linear on `main`). Commit trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## 2. Repository layout

pnpm workspace monorepo, TypeScript strict (`noUncheckedIndexedAccess`), Vitest.

- `app/` — the Electron application (electron-vite: `main` / `preload` / `renderer`).
  - `app/src/main/` — main process: `index.ts` (Electron shell, IPC registration,
    menus, windows), `document-service.ts` (the central **pure logic** — parsing,
    editing, search, indexing, all unit-tested), plus `pdf-text.ts`,
    `pdf-worker.ts`, `pdf-pool.ts`, `pdf-cache.ts`, `print.ts`, `endnote.ts`,
    `journal-covers.ts`.
  - `app/src/renderer/src/` — React renderer (Zustand store, three-pane UI).
  - `app/resources/journals/covers/` — bundled journal cover images +
    `wikipedia-index.json` manifest.
- `shared/` — the typed IPC contract: `channels.ts`, `contract.ts`, `api.ts`,
  `dto.ts`, `index.ts`. Defines `IpcChannels`, `IpcEvents`, `IpcContract`,
  `IpcEventMap`, `IpcHandlers`, and `BibDeskApi` (exposed on `window.bibdesk`).
- Internal packages under `packages/`: `@bibdesk/{tex,names,config,model,bibtex,formats,groups,plugins-sdk,shared}`.
- Logs / docs at repo root: `BUILD-LOG.md`, `DESIGN-LOG.md`, `FEATURE-SURVEY.md`,
  `README.md`, and the user-facing manual under `docs/help/00..09-*.md`.

### Key technical facts

- `app/package.json` is `type: module`; main is emitted as ESM `out/main/index.js`
  (with a `__dirname` shim); preload is `out/preload/index.mjs`.
- IPC is fully typed end-to-end; every channel has a handler in `IpcHandlers`.
- **better-sqlite3 FTS5** is the search backend. The native module is
  **ABI-specific**: switch with `node scripts/rebuild-native.mjs node|electron`.
  It is currently built for the **Electron ABI**. Vitest runs under the node ABI,
  so FTS tests are guarded with `it.runIf(FTS_AVAILABLE)` / skipped — this is
  expected, not a failure.
- There are **two FTS indexes**: `fts` (full, includes extracted PDF text) and
  `ftsFields` (BibTeX fields only). `ftsSearch(documentId, query, includePdf=false)`
  picks the index based on the toggle.
- PDF text extraction uses **pdfjs-dist legacy build** in a **worker pool**
  (`pdf-pool.ts`, size `min(4, cpus-1)`), with results cached across sessions
  (`pdf-cache.ts`, keyed by abs path + mtimeMs + size). Indexing is **deferred**
  (`setTimeout(…, 2000)` after open) so opening a large library stays fast.
- Rendering libs: MathJax (`tex-svg`) for math, citation-js (CSL) for formatted
  citations, Handlebars for HTML export, fast-xml-parser, FontAwesome.
- `app.setName('BibDesk')` → userData at `~/Library/Application Support/BibDesk/`
  (`settings.json`, `agent-key.bin`, `bridge.json`, `pdf-text-cache.json`).
- Multi-window: editing happens in a **separate editor window** per entry
  (`createEditorWindow(documentId, itemId)`); the main window's main pane is
  **read-only** (`ViewPane.tsx`). A `mutating(channel)` IPC wrapper broadcasts a
  `documentChanged` event to all other windows after any content-mutating channel,
  so the main window refreshes (`reloadAfterExternalChange`) when an editor saves.

### GUI smoke harness (env hooks in `app/src/main/index.ts`)

For headless verification: `BIBDESK_OPEN`, `BIBDESK_SMOKE`, `BIBDESK_SMOKE_DARK`,
`BIBDESK_OPEN_PDF`, `BIBDESK_SMOKE_PASTE`, `BIBDESK_SMOKE_MENU`,
`BIBDESK_SMOKE_MULTI`, `BIBDESK_SMOKE_CLICK`, `BIBDESK_SMOKE_DBLCLICK`.
(Several temporary `BIBDESK_SMOKE_EDITOR*` / `_EVAL` / `BIBDESK_PRINT_PDF` hooks
were added for one-off verification during the last session and have all been
**removed** — do not expect them to exist.)

---

## 3. Build / run / test / commit

Run everything from the **repo root** (`/Users/jalex/Source/BibDesk/bibdesk-electron`).

> **Bash-tool gotcha:** the working directory can reset between tool calls, and
> several commits silently failed last session because cwd was `app/` when paths
> were repo-relative. Use absolute paths, or `cd <root> && …` within a single
> command, and re-verify with `git status` after committing.

- **Install:** `pnpm install`
- **Run the app (dev):** `pnpm dev` (from `app/`, or the root script if present).
  The user runs this themselves — if you need them to run an interactive command,
  suggest they type `! pnpm dev` in the prompt so its output lands in the session.
- **Type-check / build:** `pnpm -r build` (or per-package `pnpm build`).
- **Test:** `pnpm -r test` (Vitest). Expect ≈141 passing / 2–3 skipped (the
  skipped ones are FTS tests under the node ABI — see above).
- **Switch native ABI:** `node scripts/rebuild-native.mjs electron` before running
  the app; `node scripts/rebuild-native.mjs node` before running tests that need
  FTS under node. Leave it on **Electron** when handing back to the user.
- **Commit:** local only, on `main`, with the co-author trailer. Never push.

---

## 4. What shipped in the most recent session

In rough order, with commit hashes (newest last within each cluster):

- `766f48e` feat(app): rename & merge authors across the library
- `6ceeb4d` docs: bring BUILD-LOG current with the post-port parity batch
- `d14da27` feat(app): export selected entries to BibTeX
- `5c7ea7b` perf(app): keep the UI responsive while indexing PDF text on open
- `b922056` perf(app): extract PDF text in a worker pool + cache it across sessions
- `46e7567` fix(app): silence pdfjs "standardFontDataUrl" warnings during indexing
- `7d563c1` feat(app): resizeable + drag-reorderable table columns
- `b49f972` feat(app): resolve journal covers by name (Wikipedia cover support)
- `eb04c1a` fix(app): keep header aligned with body when columns overflow + scroll
- `d9c6e15` feat(app): toggleable full-text (PDF) search
- `5b71d5c` assets: add 10 Wikipedia-sourced journal covers + manifest
- `250dcff` feat(app): render math in publication titles in the table
- `418c531` feat(app): collapsible Author/Keyword sidebar sections
- `c826513` feat(app): move editing into a separate window; main pane read-only
- `459af37` assets: 113 Wikipedia journal covers (infobox→imageinfo pass)
- `81e1dd8` feat(app): citation style as a preference; nicer field add/remove
- `5fd2391` style(app): make the field +/- circle buttons smaller + vertically centred
- `c7ca1bc` feat(app): welcome screen when no bibliography is open
- `209d9b7` fix(app): don't count Url/Doi links as file attachments
- `6da935d` fix(app): open attachments in the system viewer; clickable files chip; cover nudge

### Themes of the session

- **Performance:** large-library open is fast again — the table was already
  virtualized; the real cost was synchronous PDF indexing (347 PDFs ≈ 19s on the
  main thread). Fixed with the worker pool + persistent cache + deferred start.
- **Editing UX overhaul:** editing moved to per-entry windows; main pane is
  read-only; cross-window refresh via `documentChanged`; green ＋ / red − field
  add/remove with required-field protection; citation style is now a Preference
  (fixed a dropdown overflow); welcome screen when no library is open.
- **Table UX:** resizeable + drag-reorderable columns (replaced the Preferences
  reorder UI); fixed header/body horizontal-scroll desync; math rendered in title
  cells; collapsible Author/Keyword sidebar sections.
- **Journal covers:** 113 Wikipedia-sourced covers bundled and resolved by
  name/ISSN (the user authorized this).
- **Attachment correctness:** DOI/URL no longer counted as file attachments;
  files vs links split in the detail pane; PDFs open in the **system** viewer (the
  in-app `PdfViewer.tsx` was deleted); the attachment chip is clickable (one →
  opens, many → dropdown).
- Plus earlier in the session: RIS + EndNote import, broken-link finder /
  relocate, smart-group condition editing, full-text search toggle.

---

## 5. Gap analysis — what is still missing from BibDesk

Grounded in two Explore-agent surveys (the reference Obj-C source, and the current
app). This is the prioritized backlog. **Capture these recommendations as written.**

### Biggest genuine gaps

1. **Multiple open libraries.** We are single-document — opening a library
   replaces the current one. (The editor window is per-*entry*, not per-*library*.)
   BibDesk lets you have several libraries open at once. This is the big
   architectural lift.
2. **Custom BibTeX entry-type / field editor.** BibDesk's Preferences → Defaults
   lets users define entry types plus their required/optional fields and field
   order. We have a fixed type model.
3. **`.aux`-file workflow** ("Select Publications from .aux file") — parse a
   LaTeX `.aux`, select/export only the entries actually cited. High value,
   self-contained.
4. **User-editable export / preview templates.** Ours are built-in Handlebars
   templates; BibDesk lets users author their own export and preview templates.

### Smaller gaps

- Secondary / multi-column sort.
- Labeled undo/redo ("Undo Set Field", etc.) — skipped earlier over native-menu
  refresh friction; worth revisiting.
- Bulk **AutoFile** / "Consolidate Linked Files".
- More "Copy As" formats: RIS, Minimal BibTeX, LaTeX/AmsRefs, Item URL, PDF.
- Person & date field editors (deferred — a date picker risks clobbering
  Date-Added / Date-Modified).
- Crossref niceties: New Publication with Crossref, Select Parent, Sort for
  Crossrefs.
- "Edit field as raw BibTeX" / complex-value (macro) editor — only partial today.
- Select Incomplete Publications.

### Deliberately dropped (by design — do not implement without a reason)

- Search groups (Z39.50 / SRU / Entrez / DBLP), web groups, script groups,
  shared / Bonjour groups (these are parsed-only / non-functional).
- Live TeX preview (superseded by our CSL + MathJax rendering).
- macOS-only integrations: Services, Spotlight importer, QuickLook, Share menu,
  Skim PDF-annotation notes, full-screen / font menus.
- Exotic importers: MARC / MODS / Dublin Core / COinS.
- Color labels.
- Localization (BibDesk ships 13+ languages; we are English-only for now).

### Beyond BibDesk (things we added that it never had)

- Journal cover thumbnails.
- Built-in Claude assistant.
- CSL + MathJax rendering.
- True cross-platform (macOS / Windows / Linux).
- JavaScript plugin SDK.
- Cross-platform automation bridge + native helpers (vs BibDesk's mac-only
  AppleScript).

### Recommended next order

1. **Multi-column sort** — quick win.
2. **Bulk AutoFile / consolidate** — quick win.
3. **`.aux` workflow** — high value, self-contained.
4. **Custom entry-type / field editor** — gets us closest to "BibDesk-complete".
5. **Multiple open libraries** — the big architectural lift; do it last.

---

## 6. Where to resume

- Read this file, then `BUILD-LOG.md` and `DESIGN-LOG.md` for the running
  narrative and design rationale.
- Confirm `git status` is clean and you are on `main` at `6da935d` (or later).
- Confirm the native module ABI matches your intent (Electron to run, node to test
  FTS).
- Pick up the backlog at **§5 → Recommended next order**, starting with
  multi-column sort.
