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
| C3 | `core/model` — BibItem/ComplexValue/TypeManager/MacroResolver/crossref | 🔄 running |
| C4 | `core/bibtex` — custom round-trip parser + serializer (keystone) | ⏳ pending |
| C5 | `core/formats` — cite-key/autofile mini-language, CRC32 | ⏳ pending |
| C6 | `core/groups` — taxonomy + smart-group predicate evaluator | ⏳ pending |
| A1 | `shared` — IPC contract + types | ⏳ pending |
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

## Next step

Barrier on C3 (+ land T1). Then Wave 3: **C4 `core/bibtex`** (keystone parser/serializer;
gated on C1+C3; must turn T1's round-trip suite green) + **C5 `core/formats`** + **C6
`core/groups`** in parallel. A1 (`shared` IPC types) can start during Wave 3.
