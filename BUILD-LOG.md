# BUILD LOG — bibdesk-electron foundations

Resume anchor for the autonomous build driven by
`/Users/jalex/Source/BibDesk/port-analysis/BUILD-CHARTER.md`.
Session goal: **Core (Phase 0+1) + read-only Electron viewer.**

Times are local. Newest entries appended at the bottom of each section.

---

## Status board

| Task | What | State |
|------|------|-------|
| B1 | Bootstrap monorepo (pnpm workspace, TS strict, Vitest, ESLint/Prettier, stubs, deps) | ✅ done |
| C1 | `core/tex` — TeXify/deTeXify codec | ✅ done (719 tests) |
| C2 | `core/names` — BibTeX name splitting + display variants | ✅ done (88 tests) |
| C7 | `core/config` — TypeInfo/Preferences → JSON config | ✅ done (26 tests) |
| T1 | golden round-trip test harness + fixtures (`core/bibtex/test`) | ✅ done (56 + 14 skip) |
| C3 | `core/model` — BibItem/ComplexValue/TypeManager/MacroResolver/crossref | ✅ done (120 tests) |
| C4 | `core/bibtex` — custom round-trip parser + serializer (keystone) | ✅ done (70 tests, T1 green) |
| C5 | `core/formats` — cite-key/autofile mini-language, CRC32 | ✅ done (94 tests) |
| C6 | `core/groups` — taxonomy + smart-group predicate evaluator | ✅ done (106 tests) |
| A1 | `shared` — IPC contract + types | ✅ done (12 tests) |
| A2 | `app/src/main` — Electron main, open .bib, read API over IPC | ⏳ pending |
| A3 | `app/src/renderer` — React + Zustand + TanStack viewer | ⏳ pending |

Dependency graph: B1 → {C1, C2, C7, T1} → C3 → {C4, C5, C6} → {A1 → A2 → A3}.
C4 gated on C1+C3.

---

## Log

### B1 — Bootstrap (done)

Created `/Users/jalex/Source/BibDesk/bibdesk-electron/` (git init, local only — no remote).

Layout (pnpm workspace; `core/*`, `shared`, `plugins-sdk`, `app`):
- `core/tex`, `core/names`, `core/config`, `core/model`, `core/bibtex`, `core/formats`, `core/groups` — each `@bibdesk/<name>`, platform-agnostic, ESM, TS strict.
- `shared` (`@bibdesk/shared`), `plugins-sdk` (`@bibdesk/plugins-sdk`), `app` (`@bibdesk/app`, electron-vite: `src/main` + `src/preload` + `src/renderer`).

Toolchain verified working:
- `pnpm install` → 279 pkgs, exit 0.
- `pnpm -r build` (each pkg `tsc --noEmit`) → **exit 0**.
- `pnpm test` (root vitest) and `pnpm -r test` → **exit 0** (passWithNoTests on empty stubs).
- Cross-package imports resolve in **both** Vitest (runtime) and tsc (types) via the
  internal-packages pattern: each pkg's `package.json` `exports`/`main`/`types` point
  straight at `./src/index.ts`; `moduleResolution: "Bundler"`. **No build step for libs** —
  Vitest/Vite bundle the TS source of workspace deps. Verified with a throwaway cross-import test.

Stub API contract locked for T1↔C4 handoff: `core/bibtex/src/index.ts` exports
`parse(text): BibLibrary` and `serialize(lib): string` (throw `NotImplementedError` until C4).
The golden harness (T1) targets these names; C4 must keep them + the round-trip property.

Key config decisions (see "Decisions made" below): config is its own package `core/config`
(not a subdir of `core/model`) for clean ownership; `app` is a single electron-vite package
(not separate `main`/`renderer` workspace packages) to match electron-vite's layout.

Deps declared (permissive only): react/react-dom 18.3, zustand 5, @tanstack/react-table 8 +
react-virtual 3, electron 33 + electron-vite 2 + vite 5, bplist-parser/bplist-creator (C4
bdsk-file blobs), TS 5.9, Vitest 2.1, ESLint 9 flat + typescript-eslint 8 + prettier 3.

---

## Decisions made (autonomous, within charter §0 latitude — implementation details)

1. **`core/config` is its own package** (`@bibdesk/config`), not `core/model/config/` as the
   charter sketched. Reason: clean single-owner package boundary (C7 owns it; C3 and C4 depend
   on it) avoids two agents sharing `core/model/package.json`. Reversible.
2. **Single `app` package** using electron-vite (`src/main`, `src/preload`, `src/renderer`)
   instead of separate `main`/`renderer` workspace packages. Reason: matches electron-vite's
   expected project layout; A2/A3 work in disjoint subdirs. Reversible.
3. **Internal-packages pattern** (workspace `exports` → `.ts` source, no lib build step).
   Reason: simplest correct monorepo setup for Vitest + Vite; avoids project-reference/composite
   friction with `noEmit`. Verified working.
4. **pnpm settings:** `verifyDepsBeforeRun: false` in `pnpm-workspace.yaml` so `pnpm -r test`
   doesn't re-trigger an install whose ignored-build-script warning returns exit 1. esbuild's
   native binary is present via its platform package, so its skipped postinstall is harmless.

## Decisions to confirm (flagged for the user — none block the build)

- Working title/package scope is `bibdesk-electron` / `@bibdesk/*` (placeholder per charter §2).
- electron-builder `appId` is a placeholder (`org.placeholder.bibdesk-electron`).
- **electron** runtime binary: its postinstall download was skipped (pnpm build-script gate).
  Will be resolved before the Wave-4 GUI smoke test; core waves don't need it.

## Blockers

- None.

### Wave 1 (in progress)

- **C1 `core/tex` — DONE & committed (`d9450c9`).** detexify/texify codec; ported
  CharacterConversion.plist (221 entries) + accent algorithm via NFC/NFD; reserved-char
  handling; math-span passthrough. 719 tests pass, tsc clean. Public API: `detexify`,
  `texify` (+ lower-level `texifyCore`/`detexifyCore`, `texifyChar`, dictionaries/tables).
  One-way/lossy by design: ligatures, smart quotes, en/em dashes, `°`/`±`/`•`, NBSP.
- **C2 `core/names` — DONE & committed (`1c821da`).** `splitNameList`, `parseName`
  (first/von/last/jr), `makeAuthor` (normalized/sortable/abbreviated/fuzzy variants),
  author equality/equivalence/sort. 88 tests, tsc clean. Uses `@bibdesk/tex` detexify.
  **Integration notes for C3/C4:** (a) `compareAuthorsForSort` compares only
  `sortableName` — add Author-vs-Editor field tiebreaker + empty-author-last when the
  BibItem layer wires authors to fields; (b) only the fuzzy equivalence path exists —
  add the `matchAuthorNamesExactly` exact-mode branch when the preferences layer lands.
- **C7 `core/config` — DONE & committed (`b1a3bfc`).** `typeinfo.json` (types, required/
  optional fields, 22 tag maps) + the 8 field-type default arrays + typed case-insensitive
  accessors. 26 tests, tsc clean. **Handoff to C3 (TypeManager):** field-type arrays are
  factory defaults (layer user values on top via `fieldTypeSetMeta` keys); C3 owns the
  hardcoded code-level sets (noteFields/numericFields/titleFields/containerFields/
  invalidGroupFields/singleValuedGroupFields); URL/local-file fields must NOT be TeXified
  on save; C3 implements the user-TypeInfo overlay (15 standard types stay protected).

### Wave 2 (in progress)

- **C3 `core/model`** — launched (background). Builds BibItem, FieldValue/ComplexValue/
  StringNode, TypeManager (from C7), MacroResolver (3-tier + topological + events),
  crossref inheritance (+ booktitle workaround, chain/cycle guard), equality/equivalence/
  hash, pure-TS change-event layer. Depends on tex+names+config (all committed).
- **T1 golden harness — DONE & committed (`4ea0fe7`).** 12 fixtures (6 btparse +
  `BD test.bib` copied read-only; 5 synthesized BibDesk-canonical). Reusable runner
  (`test/roundtrip.ts`) with byte-exact/normalized/structural modes + normalizers per
  subsystem-12 §2. `harness.test.ts` 56 green; `roundtrip.test.ts` 14 `describe.skip`.
  `src/index.ts` stub intact.

### >>> C4 CONTRACT (what core/bibtex MUST satisfy to turn T1 green) <<<

- Keep exact entry points `parse(text): BibLibrary` and `serialize(lib): string`
  (harness imports from `../src/index`). `serialize(parse("")) === ""` (no header when empty).
- Canonical serializer write order & format (from `BibDocument.m`/`BibItem.m`):
  header template `%% This BibTeX bibliography file was created using BibDesk.\n%% https://bibdesk.sourceforge.io/`
  → `\n%% Created for … \n\n` → `\n%% Saved with string encoding … \n\n` →
  `@bibdesk_info{document_info,…}` → `\n@string{name = value}\n` (sorted) → entries
  (`\n\n`-separated; `,\n\t field = {value}`; field names lower-cased; fields sorted
  case-insensitively; `bdsk-file-N`/`bdsk-url-N` forced LAST; values always `{…}`-wrapped;
  empty fields dropped) → the 4 group `@comment` blocks → trailing `\n`.
- Group blocks order **Static, Smart, URL, Script**; each: prefix `\n\n@comment{BibDesk <LABEL> Groups{\n`
  + UTF-8 XML plist (`<?xml…><plist version="1.0"><array>…</array></plist>\n`) + suffix `}}`.
  Payload dict keys emitted ALPHABETICALLY. (Static: `{group name, keys}`; Smart:
  `{conditions:[{comparison,key,value,version}], conjunction, group name}`; URL: `{URL, group name}`;
  Script: `{group name, script arguments, script path, script type}`.)
- `bdsk-file-N` = base64 of a binary plist (`YnBsaXN0` prefix) — decode/encode via bplist libs.
- The 5 synthesized fixtures are tagged **byte-exact** assuming the SAME volatile header
  (user/date/encoding). If C4 regenerates the header dynamically, flip those manifest entries
  to `normalized` — the harness already masks header lines via `stripVolatileHeader`.
- **Activate:** change `describe.skip` → `describe` in `core/bibtex/test/roundtrip.test.ts`
  (single edit, marked `TODO(C4)`).

### Wave 2 — DONE

- **C3 `core/model` — DONE & committed (`c4835e4`).** 120 tests. Full keystone domain layer
  (see API in the agent report). Repo-wide barrier check green: `pnpm -r build` exit 0 (all
  10 packages typecheck); `pnpm test` = 1009 passed | 14 skipped (T1 contract awaiting C4).

### Wave 3 (in progress) — launched in parallel (disjoint dirs)

- **C4 `core/bibtex`** (keystone) — custom parser+serializer; must flip T1's 14 skipped
  round-trip tests to green. Emits raw group records `{kind, data}` for C6/app to type.
- **C5 `core/formats` — DONE & committed (`4ec029b`).** Full specifier/modifier grammar,
  uniquifiers + CRC32 (Papers-compat, verified vs zlib vectors), lossyASCII + sanitizers,
  invalid-char sets from BDSKTypeManager, `generateCiteKey`/`validateFormat`. 94 tests.
  Imports `detexify` via `@bibdesk/names` re-export (no extra dep). Path lookups injected
  as callbacks (no `fs` in this layer — app provides them).
- **C4 `core/bibtex` (keystone) — DONE & committed (`cbfc95c`).** `parse → BibLibrary`,
  `serialize → string`; byte-faithful BibDesk write order incl. group `@comment` blocks
  (byte-faithful Apple XML-plist codec) and bdsk-file-N base64 bplist (byte-exact). Turned
  T1 green: `roundtrip.test.ts` un-skipped, 14/14 pass; 4 fixtures reclassified
  normalized→structural (stable-fixed-point reasons; runner/harness untouched). 70 tests.
  **A2/C6 consumption:** `lib.groups: GroupRecord[]` (`{kind, data}`, data = decoded plist
  array of dicts, **already unescaped**); macros in `lib.macroResolver.parent` (file tier);
  bdsk-file plists in `lib.bdskFiles` keyed `bdskFileKey(item.id, field)`; header re-emitted
  verbatim; empty lib → `""`.
  **⚠ C4↔C6 escaping seam (KNOWN, deferred — read-only this session):** C4 UNESCAPES group
  strings on parse; C6's `groupFromSerialized` ALSO unescapes (and `toSerialized` escapes).
  Feeding C4's already-unescaped data straight into C6 would double-process. NOT exercised by
  the smoke test (BD test.bib has no groups) and no save path this session. Wave-4 group
  adapter must apply escaping exactly once; full reconcile + a save path is a follow-up.

### 🏁 MILESTONE — Headless core (PLAN Phase 0 + Phase 1) COMPLETE

Repo-wide barrier GREEN: `pnpm -r build` exit 0 (all 10 packages typecheck); **`pnpm test`
= 1235 passed, 0 skipped, 33 files.** Byte-faithful BibTeX round-trip proven against the
golden corpus incl. `BD test.bib`, group `@comment` blocks, and bdsk-file bplists.
Per-package: tex 719 · names 88 · config 26 · model 120 · bibtex 70 · formats 94 · groups
106 · shared 12.
- **C6 `core/groups` — DONE & committed (`6b4a065`).** Group union + Filter/Condition
  evaluator; comparison enums ported from `BDSKCondition.h`; relative-date windows with
  injectable `now`; `groupFromSerialized`/`toSerialized` for Static/Smart/URL/Script.
  106 tests. **Notes:** (a) `@bibdesk/names` is NOT in core/groups' deps, so it reimplements
  `authorsEquivalent` locally against the structural `Author` shape — fine. (b) **C4↔C6
  reconcile:** C6 unescapes group-plist entities (`%25 %7B %7D %3C %3E %40`) on read /
  escapes on write; C4 must hand C6 **escaped** `value`/`group name` strings (NOT
  pre-unescaped), with integer `comparison`/`conjunction`/`version`. Verify when C4 lands;
  if C4 unescapes itself, drop C6's escape step to avoid double-processing.
- **A1 `shared` — DONE & committed (`d460936`).** Channel constants (`bibdesk:*`),
  `IpcContract` map + `RequestOf`/`ResponseOf` helpers, `BibDeskApi` bridge interface,
  DTOs (`PublicationRow`, `GroupNode`, `ItemDetail`, `OpenedDocument`). 12 tests.
  **A2/A3 notes:** main registers `ipcMain.handle(IpcChannels.X, …)`, keeps the
  publications array, does ALL formatting (authorsDisplay via names, title TeX-strip via
  tex, isInherited via model), returns `{rows,total}` for the virtualizer; renderer programs
  only against `window.bibdesk: BibDeskApi` + DTOs (never imports channel constants).
- Electron runtime binary downloaded (242M, `Electron.app`) — Wave-4 smoke test unblocked.

## Next step — Wave 4 (read-only Electron viewer)

Core is done. Build the viewer in the `app` package:
- **A2 `app/src/main` + `src/preload`** — open a `.bib` via `@bibdesk/bibtex` parse →
  `BibLibrary`; hold items in main; implement the `@bibdesk/shared` `IpcHandlers` over
  `ipcMain.handle`; format `PublicationRow`s (authorsDisplay via names, title TeX-strip via
  tex, type lowercased, year from `Year`); build `GroupNode`s (Library + parsed groups via
  C6 adapter — apply escaping once); `getItemDetail` (fields + isInherited via model, files,
  optional previewHtml). Preload exposes `window.bibdesk: BibDeskApi`. file→open + CLI-arg +
  macOS `open-file`.
- **A3 `app/src/renderer`** — React + Zustand + TanStack virtual table (Cite Key, Type,
  Authors, Title, Year), groups sidebar (read-only), selection → detail panel + preview card.
- Orchestrator wires electron-vite and runs `dev` once to smoke-test loading
  `/Users/jalex/Source/BibDesk/bibdesk/Scripting/BD test.bib`. Electron binary is ready.
