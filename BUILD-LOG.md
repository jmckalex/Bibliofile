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
| C1 | `core/tex` — TeXify/deTeXify codec | ⏳ pending |
| C2 | `core/names` — BibTeX name splitting + display variants | ⏳ pending |
| C7 | `core/config` — TypeInfo/Preferences → JSON config | ⏳ pending |
| T1 | golden round-trip test harness + fixtures (`core/bibtex/test`) | ⏳ pending |
| C3 | `core/model` — BibItem/ComplexValue/TypeManager/MacroResolver/crossref | ⏳ pending |
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

## Next step

Spawn Wave 1 (C1, C2, C7, T1) in parallel — disjoint package dirs.
