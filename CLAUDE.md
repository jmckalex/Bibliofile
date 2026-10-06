# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Bibliofile** is a cross-platform Electron rewrite of the macOS BibDesk bibliography manager.
It is a pnpm monorepo. The user's `.bib` file is the **single source of truth**. SQLite only
holds a search index and caches.

## Ground rules

- The original Obj-C BibDesk at `/Users/jalex/Source/BibDesk/bibdesk/` is **read-only reference**.
  Consult it, never edit it, and modernize rather than copy. It has settled real questions,
  such as menu wording and the exact bookmark API and link-resolution order.
- Never clobber the user's real bibliography. Never **write** to the real app userData at
  `~/Library/Application Support/Bibliofile`; reading it for diagnosis is fine.
- Commit and push only when the user asks. `main` has **linear history**: build on a branch,
  `git merge --ff-only`, then delete the branch. Every commit on `main` must build.
- `HANDOVER.md` is the per-session resume doc. It is **untracked and gitignored**, so never
  `git add` it. Read it at the start of a session, but run `git status` before trusting its
  STATE block. Longer history lives in `BUILD-LOG.md`. Design decisions and their rationale are
  in `DESIGN-LOG.md`, and the keep/drop list against BibDesk is in `FEATURE-SURVEY.md`.
- Before claiming a feature is missing, check `shared/src/dto.ts` and `shared/src/channels.ts`.
  Features have turned out to exist under a different menu name.
- Keep Electron/CDP smoke runs to a minimum, because they leak Electron processes. Prefer logic
  that can be checked in Node, plus unit tests. The user runs the app themselves.

## Commands

```bash
pnpm install
pnpm dev                 # electron-vite dev
pnpm build               # typecheck every package (tsc --noEmit; app runs tsconfig.node + tsconfig.web)
pnpm build:app           # electron-vite bundle — catches errors tsc misses
pnpm test                # vitest across core/shared/plugins-sdk/app (root vitest.config.ts)
pnpm test core/names/src/parseName.test.ts     # one file
pnpm exec vitest run -t "test name"            # by test name
pnpm lint                # eslint; baseline is 0 errors / 16 warnings — anything more is yours
pnpm format              # prettier (single quotes, semis, width 100, trailing commas)
```

**Verify each change** with `pnpm build`, `pnpm build:app`, `pnpm test` and `pnpm lint`. CI
(`.github/workflows/ci.yml`, macOS, Node 22) runs the same steps after a cold
`pnpm install --frozen-lockfile`.

**Run the real app** with `bash scripts/run-bibliophile.sh [library.bib]` after `pnpm build:app`.
It quits any stale instance first. Without that, the single-instance lock routes the launch into
the old process and a rebuild silently has no effect. You can also open a library with
`BIBDESK_OPEN=/abs/path.bib` or a CLI argument. `docs/math-demo.bib` is a small fixture.

**Dev bundle patching.** `bash scripts/dev-applescript.sh` patches the dev `Electron.app`: it
renames it, enables AppleScript, installs the sdef and claims the `.bib` document type.
`pnpm install` resets the bundle, so re-run the script afterwards. Without it, File → Open Recent
stays empty in dev.

### Native addons: the ABI dance

| | `better-sqlite3` (FTS5) | `app/native/bookmark` |
|---|---|---|
| kind | NAN/V8, **ABI-specific** | Node-API, ABI-stable (one binary serves Node and Electron) |
| build | `pnpm --filter @bibdesk/app rebuild:node` / `rebuild:electron` | `pnpm build:bookmark` / `build:bookmark:node` |
| tests self-skip when | built for the other ABI | not built |

The local checkout is normally built for **Electron**, so the FTS tests skip
(`describe.runIf(idx.available)`). To run the full suite:

1. Run `pnpm --filter @bibdesk/app rebuild:node`.
2. Run `pnpm test`.
3. Run **`pnpm --filter @bibdesk/app rebuild:electron`**. Without this step the user's dev app
   loses full-text search.

To check which ABI is loaded, use `new Database(':memory:')`. A bare `require('better-sqlite3')`
does not dlopen the addon, so it tells you nothing. `scripts/rebuild-native.mjs` forces the Xcode
toolchain over any Anaconda shims on PATH.

The AppleScript addon (`app/native/scripting`) is ABI-specific and is **not** bundled into
packaged builds.

### Packaging and releases

- Use `pnpm pack:dir` for an unsigned build and `pnpm dist:mac` for a signed and notarized one.
  `SIGNING.md` has the details.
- If the `APPLE_*` env vars are set, the notarize hooks fire. For an unsigned build, run
  `env -u APPLE_ID -u APPLE_APP_SPECIFIC_PASSWORD -u APPLE_TEAM_ID pnpm pack:dir`.
- `mac.notarize: false` in `electron-builder.yml` is **deliberate**. The `afterSign` hook
  (`scripts/notarize.cjs`) handles the `.app`, and `afterAllArtifactBuild`
  (`scripts/notarize-dmg.cjs`) separately signs and notarizes the `.dmg`.
- `fileAssociations` uses `rank: Alternate` on purpose. It declares `.bib` support without taking
  the extension away from BibDesk.
- The version lives in exactly two places: `package.json` and `app/package.json`. Artifact names
  include the version, so rebuilding at an unchanged version overwrites that release. Ask before
  reusing a version number.
- **electron-builder 24 collects only `app/package.json`'s DIRECT dependencies** out of pnpm's
  layout, and silently drops transitive ones. Every package listed in `main.build.rollupOptions.external`
  (`app/electron.vite.config.ts`, the OCR stack) or `createRequire`d by main must therefore have
  its whole runtime dependency tree declared in `app/package.json`, at the version its parent
  resolves. `app/src/main/packaged-deps.test.ts` enforces this rule.
- `scripts/verify-packaged-app.cjs` is the `afterPack` probe. It runs the packaged binary with an
  **allowlisted env**, because pnpm's bin shim exports a `NODE_PATH` that would resolve missing
  modules from the checkout. Any future "run the packaged binary from a hook" step must do the
  same.

### pnpm / toolchain gotchas

- pnpm 11 **ignores `onlyBuiltDependencies`**. Every package with a build script needs an
  explicit entry in `allowBuilds` in `pnpm-workspace.yaml`. Otherwise a cold
  `--frozen-lockfile` install fails, which only shows up in CI.
- `patches/electron-vite@2.3.0.patch` is permanent. Its ESM-shim injector false-matched `import`
  inside i18n string literals.
- `verifyDepsBeforeRun: false` keeps `pnpm -r test` from re-tripping the install check.
- The Electron 33 upgrade is deferred by the user as risky. Don't start it without a fresh
  go-ahead.

## Architecture

**Pure core, thin Electron shell.**

- `core/*` packages are platform-agnostic: no Electron, no DOM and no `fs`.
  - `tex` is the TeXify/deTeXify codec.
  - `names` does BibTeX name splitting.
  - `config` holds BibDesk's type/field config as JSON.
  - `model` has `BibItem`, `ComplexValue`, macros and crossref.
  - `bibtex` is the byte-faithful parser and serializer, the keystone.
  - `formats` is the cite-key/AutoFile format language.
  - `groups` has the smart-group predicates.
- Core packages export TS source directly (`main: ./src/index.ts`). There is no build step; each
  package's `build` script is just `tsc --noEmit`.
- `shared` holds the IPC contract, the structured-clone-safe DTOs and the i18n catalogs.
  `plugins-sdk` is the JS plugin API.

**`app/src/main/document-service.ts`** (`DocumentStore`) is the pure document layer. It parses
`.bib` text, holds open documents by `documentId`, and projects `BibItem`s into DTOs. All display
formatting happens on the main side of IPC. It has **zero Electron imports**, and its tests import
it with no electron mock, so keep it that way. When it needs something from Electron, inject it:
`renderCite` / `renderBibliography` and `fileChipLabel` (via `setEditConfig`) show the pattern.
Many other main modules (`ocr.ts`, `script-host.ts`, `pdf-index.ts`, …) are electron-free and
unit-tested the same way.

**`app/src/main/index.ts`** is the Electron shell: windows, menus, and one `ipcMain.handle` per
channel that forwards into the store. It has three rollup entry points: `index.ts`,
`pdf-worker.ts` and `migrate-worker.ts`. The workers are loaded by path from `__dirname`.
Menu accelerators must be unique. The menu bar dispatches to the first match, so a duplicate
silently breaks one of the commands. The only intended duplicate is `⌘N`. To check:
`grep -n "accelerator: '" app/src/main/index.ts | sed "s/.*accelerator: '\([^']*\)'.*/\1/" | sort | uniq -c | awk '$1>1'`

**Typed IPC is a full chain.** A new channel touches every link:

1. `shared/src/channels.ts`
2. `dto.ts`
3. `contract.ts`
4. `api.ts`
5. `shared/src/index.ts`, the **barrel** (easy to forget)
6. `app/src/preload/index.ts`
7. the handler in `main/index.ts`

`renderer/src/store.test.ts` mocks the full `BibDeskApi`, so update it too. `IpcEventMap`
exhaustiveness is checked by **tsc only**: `expectTypeOf` is a no-op at runtime, so a green
`pnpm test` without `pnpm build` proves nothing there. Features that live only in the main process
(menu plus dialog, such as Save As, Export or Clone Bibliography) need none of this chain. Prefer
that design when it fits.

**Renderer:**

- Built on React, a single Zustand store (`renderer/src/store.ts`) and TanStack Table/Virtual.
- There is **no DOM test infrastructure**, so renderer invariants are pinned by inspecting
  source. Follow the style of `editor-layout.test.ts` and `panes-layout.test.ts`.
- `.bd-panes` is a CSS grid whose inline `gridTemplateColumns` count must match its children:
  3 columns without the right pane, 5 with it.
- Idioms worth reusing:
  - commit-on-blur inputs (`defaultValue` + `onBlur`), not a `save()` per keystroke;
  - a post-await guard, so selection or detail is only written if it is still the targeted item;
  - with 2+ rows selected, refreshing the visible `multiPanel` too.

**Item identity.** Item ids are per-parse UUIDs and are not serialised into the `.bib`.
Undo/redo preserves them: each `UndoStep` carries `ids`, and `rebuildFromText` re-applies them
positionally, but only when the counts match. `BibItem.reassignId()` is for undo/redo only.
`library.bdskFiles` is keyed by item id and is re-keyed in the same pass.

**Full-text search is two indexes on purpose.**

- Field text lives in an in-memory `FtsIndex` (`fts.ts`), keyed by item id and rebuilt at open.
- PDF text lives in an on-disk `PdfTextIndex` (`pdf-index.ts`), keyed by **absolute file path**.
  That key is stable, which is what makes the index persistable.
- The FTS5 table is contentless.
- PDF indexing is gated on the `fullTextSearch` preference.
- If better-sqlite3 can't load, search degrades to a substring filter.

**BibDesk parity.**

- Attachments are BibDesk `Bdsk-File-N` base64 plists. `app/native/bookmark` writes the same
  bookmark blob BibDesk does.
- We **write** bookmarks but do not **read** them. `resolveBookmark()` has no production
  callers, and resolution is by relative path only. Don't document it as "bookmarks work".
- Copies use `copyfile(3)` with `COPYFILE_ALL|COPYFILE_EXCL`, which preserves xattrs and never
  overwrites.
- A cloned file gets a **fresh** bookmark.

**Settings** are JSON in userData. `loadSettings` deep-merges them over `DEFAULT_SETTINGS`
(`main/settings.ts`), so a new settings field needs no migration.

**Scripting.** `script-host.ts` runs user JavaScript in `node:vm` in the main process, with a
synchronous `bibliofile` API. Every mutation goes through `DocumentStore`, and a whole run is one
undo step. `vm` is scope isolation, not a sandbox, and that is acceptable because scripts are
user-authored. AppleScript support is in `scripting.ts`, the native addon and
`app/scripting/Bibliofile.sdef`.

**Security.**

- The CSP is in `app/src/security/csp.ts`. The prod policy is injected as a `<meta>` at build
  time, because the packaged renderer loads over `file://`.
- `url-guard.ts` combines an allowlist with a host guard, so `fetchPdfBytes` is not an open
  proxy. Redirects are followed by hand and revalidated per hop. Never reintroduce
  `redirect: 'follow'`.
- `x-bibdesk://` mutations require confirmation, with Cancel as the default.
  `open?file=` accepts `.bib` only.

**i18n.**

- `shared/src/i18n.ts` and `shared/src/locales/<code>.ts` hold 30 locales. `en.ts` is the source
  of truth. The others are machine-seeded and fall back to English per key.
- Use `useT` in React, and `tNow()` for custom elements and imperative DOM.
- `RichText.tsx`'s `Rich` component renders `**bold**`, `*italic*` and `` `code` `` from catalog
  strings without `dangerouslySetInnerHTML`. Use **one key per sentence**, never one key per
  formatted fragment. Never point it at user data.
- `RichText.test.ts` checks all catalogs. For example, `` `code` `` runs must match English
  verbatim.
- `t()` only interpolates when it is passed `params`.

**Help manual.** `docs/help/*.md` is rendered into one HTML page by `main/help.ts`. Heading ids
are chapter-prefixed GitHub-style slugs, so `Find & Replace` becomes `find--replace`.
`help.test.ts` asserts that every in-manual `#` link resolves. Write fragments to GitHub's slug
rules.

## Testing method

- Where a bug can be encoded as an invariant, prefer a test over a screenshot.
- Prove a new invariant test isn't vacuous: reintroduce the bug and watch the test fail. Break
  each invariant separately, so one failure doesn't mask another.
- Source-inspection tests are prone to over-matching. Anchor the patterns: match the
  `className="…"` attribute and its closing quote, not a substring that also hits a nearby
  comment.
- When the user reports something, measure the data before theorising. Several "bugs" have
  turned out to be correct behaviour.
