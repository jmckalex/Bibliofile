# bibdesk-electron

Cross-platform Electron rewrite of [BibDesk](https://bibdesk.sourceforge.io/).
Working title — to be renamed.

**Status:** the headless core (BibTeX read/write + model) and a **read-only viewer with
a rich, themed preview** are built and tested. `pnpm test` → **1254 tests** green;
`pnpm -r build` typechecks clean. See `BUILD-LOG.md` for the full build journal and
`/Users/jalex/Source/BibDesk/port-analysis/` for the analysis + plan driving it.

![Viewer with MathJax preview (light)](docs/viewer-stage6-light.png)
![Viewer (dark) with category groups](docs/viewer-category-groups.png)

## What works today

- **Byte-faithful BibTeX round-trip** — a custom parser + serializer reproducing BibDesk's
  exact on-disk format, including `@string` macros, `@preamble`, the Static/Smart/URL/Script
  group `@comment` blocks, `@bibdesk_info`, and `bdsk-file-N` base64 binary-plist blobs.
  Proven against a golden corpus (incl. a real BibDesk-authored file).
- **Headless core** (platform-agnostic, Vitest-tested): TeX↔Unicode codec, BibTeX name
  parsing + display variants, the BibItem/ComplexValue/macro/crossref model, cite-key/
  autofile format language, and the smart-group predicate evaluator.
- **Read-only viewer** (Electron + React + Zustand + TanStack): virtualized publications
  table (sortable columns), groups sidebar with **dynamic Author/Keyword category groups**,
  live **search/filter**, and a detail pane.
- **Beautiful preview pane** — typographic entry cards with entry-type accent colours,
  DOI/URL/attachment chips, keyword tags, **MathJax** math in titles/abstracts, **dark mode**,
  and **clickable** DOI/URL/attachment links (open externally).

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

Editing + round-trip **save** (turn read-only → read-write) is the next stage — the
serializer already round-trips; see `BUILD-LOG.md` → "Stage 7". No GPL/AGPL/CC-BY-NC
dependencies are used (a CSL citation engine is deferred pending a permissive choice).
