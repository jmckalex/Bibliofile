# bibdesk-electron

Cross-platform Electron rewrite of [BibDesk](https://bibdesk.sourceforge.io/).
Working title — to be renamed.

**Status:** the headless core (BibTeX read/write + model) and a **working read/write editor
with a rich, themed preview and formatted citations** are built and tested. `pnpm test` →
**1261 tests** green; `pnpm -r build` typechecks clean. See `BUILD-LOG.md` for the full build
journal and `/Users/jalex/Source/BibDesk/port-analysis/` for the analysis + plan driving it.

![Editor with MathJax preview + CSL citation](docs/viewer-citation.png)
![Viewer (dark) with category groups](docs/viewer-category-groups.png)

## What works today

- **Byte-faithful BibTeX round-trip** — a custom parser + serializer reproducing BibDesk's
  exact on-disk format, including `@string` macros, `@preamble`, the Static/Smart/URL/Script
  group `@comment` blocks, `@bibdesk_info`, and `bdsk-file-N` base64 binary-plist blobs.
  Proven against a golden corpus (incl. a real BibDesk-authored file).
- **Headless core** (platform-agnostic, Vitest-tested): TeX↔Unicode codec, BibTeX name
  parsing + display variants, the BibItem/ComplexValue/macro/crossref model, cite-key/
  autofile format language, and the smart-group predicate evaluator.
- **Viewer** (Electron + React + Zustand + TanStack): virtualized publications table
  (sortable columns), groups sidebar with **dynamic Author/Keyword category groups**, live
  **search/filter**, and a detail pane.
- **Editor** — inline-edit fields, cite keys (+ generate), entry types; add / duplicate /
  delete entries; `@string` macro editor; **explicit Save** (Cmd+S, atomic write + `.bak`
  backup) round-tripping through the byte-faithful serializer.
- **Beautiful preview pane** — typographic entry cards with entry-type accent colours,
  DOI/URL/attachment chips, keyword tags, **MathJax** math in titles/abstracts, **dark mode**,
  and **clickable** DOI/URL/attachment links (open externally).
- **Formatted citations** — citeproc-js/CSL (APA/Vancouver/Harvard, offline) in the detail
  pane. citeproc-js is AGPL — the one intentionally non-permissive dependency.

## Layout

```
core/tex      TeXify/deTeXify codec (CharacterConversion + accent algorithm)
core/names    BibTeX name splitting (Patashnik) + display variants
core/config   ported BibDesk type/field configuration (JSON)
core/model    BibItem / ComplexValue / TypeManager / MacroResolver / crossref
core/bibtex   custom byte-faithful round-trip parser + serializer (the keystone)
core/formats  cite-key / autofile format mini-language, CRC32, sanitizers
core/groups   group taxonomy + smart-group predicate evaluator
shared        IPC contract + structured-clone-safe DTOs
plugins-sdk   JS plugin API surface (stub)
app           Electron shell: main (pure document-service + IPC) + preload + React renderer
```

`core/*` is platform-agnostic (no Electron/DOM; `fs` only at the app layer) and runs headless
under Vitest. The app's document logic lives in a pure, unit-tested `document-service`; the
Electron shell is a thin wrapper.

## Develop

```bash
pnpm install
pnpm test                 # all unit tests (core + app)
pnpm build                # typecheck every package
pnpm --filter @bibdesk/app dev   # launch the Electron viewer (electron-vite dev)
```

To open a library on launch, set `BIBDESK_OPEN=/abs/path/to/library.bib` (or pass the `.bib`
as a CLI arg / open via the File menu). `docs/math-demo.bib` is a small fixture that shows
the MathJax preview and category groups.

## Next

Possible next stages (see `PLAN.md` phases 4–9): SQLite FTS5 full-text search, export
(RTF/Docx/HTML), file-attachment auto-filing + thumbnails, online search servers, an undo
stack + autosave, and cross-platform packaging. The only non-permissive dependency is
citeproc-js (AGPL, used for CSL citations, accepted deliberately).
