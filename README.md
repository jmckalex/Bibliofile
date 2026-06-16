# bibdesk-electron

Cross-platform Electron rewrite of [BibDesk](https://bibdesk.sourceforge.io/).
Working title — the user renames later.

**Status:** foundations build in progress. See `BUILD-LOG.md` for the running log,
and `/Users/jalex/Source/BibDesk/port-analysis/` for the analysis + plan that drives it.

## Layout

```
core/tex      TeXify/deTeXify codec
core/names    BibTeX name splitting + display variants
core/config   ported BibDesk type/field configuration (JSON)
core/model    BibItem / ComplexValue / TypeManager / MacroResolver / crossref
core/bibtex   custom byte-faithful round-trip parser + serializer (the keystone)
core/formats  cite-key / autofile format mini-language, CRC32, sanitizers
core/groups   group taxonomy + smart-group predicate evaluator
shared        IPC contracts + shared types
plugins-sdk   JS plugin API surface (stub)
app           Electron shell (main + preload + React renderer)
```

`core/*` is platform-agnostic (no Electron/DOM; `fs` only behind an injected
interface) and runs headless under Vitest.

## Develop

```bash
pnpm install
pnpm test        # all unit tests
pnpm build       # typecheck every package
pnpm dev         # launch the Electron viewer (Wave 4+)
```
