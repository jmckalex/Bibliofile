# BibDesk feature survey — keep / drop / done

Decided 2026-06-16 while building the Electron port. Goal: full support for the BibDesk
features worth preserving; drop legacy/mac-only cruft. "Done" = already shipped in this repo.

## Already shipped
- Byte-faithful BibTeX parse/serialize round-trip; @string macros (+ editor).
- Virtualized publications table: sort, live filter, FontAwesome icon columns
  (keywords/attachments/Read).
- Groups sidebar: library, **static**, **smart**, category, author — parsed, conditions
  evaluated, table filtered, counts. (Smart groups are *read/filter-complete*; editor pending.)
- Detail/preview pane: CSL citation (citation-js), field editors, markdown abstract (MathJax),
  markdown notes with `[[citeKey]]` cross-refs + inline `<iframe>`, attachments, in-app PDF.js
  preview.
- Editing: add/duplicate/delete entry, set field/type/cite key, generate cite key; round-trip
  save (+ `.bak`), Save As, Revert, Export BibTeX.
- Online search/import: CrossRef + arXiv.
- Attachments: `Bdsk-File-N` (multiple), add/remove, open; FTS5 full-text search incl. PDF text.
- Preferences pane; comprehensive Help manual; full native menu bar; light/dark theme.

## KEEP — worth preserving (added to the implementation list)
1. **Paste BibTeX + drag-and-drop import** *(user-requested)* — paste a BibTeX entry from the
   clipboard (Google Scholar etc.) into the library; drop `.bib` files to merge; drop PDFs to
   create entries and auto-attach. HIGH.
2. **Drag-out citations + Copy `\cite{}`** — the worthwhile core of BibDesk's "custom citation"
   panel: drag rows to a TeX editor to insert `\cite{key}` (configurable cite command/template),
   and a "Copy `\cite{…}`" command. We drop the heavyweight floating Citations drawer + live TeX
   service; the drag-out + copy + template covers the real use. HIGH.
3. **Smart / static group editor** — create/edit/delete smart groups (condition builder over the
   existing `@bibdesk/groups` engine) and static groups (add/remove items, incl. via drag);
   persist to the `.bib` (serializer already writes groups). MEDIUM-HIGH.
4. **Handlebars templates → preview + export** — replace BibDesk's custom `.template` language
   with Handlebars; user-editable templates; export HTML/RTF/CSV/RIS. MEDIUM. *(task #2)*
5. **Editing depth** — undo/redo stack + autosave option; richer per-field-type editors. *(task #6)*
6. **Find & Replace across fields** — scoped search/replace (the useful part of BibDesk's Find
   panel). MEDIUM.
7. **Find Duplicates** — select duplicate cite keys + fuzzy title/author duplicates. MEDIUM.
8. **Column configuration** — choose any field as a column, show/hide/reorder. MEDIUM.
9. **Field-value autocomplete** — complete keywords/journals/crossref keys from existing values
   while editing. MEDIUM.
10. **RIS import** (+ generic tagged-format import) — the config mapping tables already exist
    (`BibTeXFieldNamesForRISTags`, Refer, PubMed, Dublin Core…). Implement RIS now; others later.
    MEDIUM.
11. **AutoFile** — move attachments into a Papers folder via the format language. *(task #5)*
12. **JS plugin API → Claude scripting assistant** — *(tasks #3, #4)*.
13. **Quick wins** — Reveal in Finder, Open With, Print (preview/list). LOW.

## DROP — legacy / mac-only / superseded
- Separate per-publication **editor windows** — our inline detail pane is the modern replacement.
- **TeX-task PDF preview** (spawns `bibtex`/`latex` to render a typeset bibliography) — needs a
  TeX install; superseded by the CSL + MathJax preview.
- Exotic importers: **Z39.50 / SRU library catalogs**, MARC/UNIMARC/MODS, EndNote binary —
  keep RIS (above); drop the rest (parsers can be revived from the config tables if ever needed).
- macOS **Services** ("Complete Citation" cite drawer), **Spotlight importer**, **QuickLook**
  generator, share/iCloud — OS-specific plugins, out of scope for the cross-platform app.
- **Color labels** — low value next to Read/rating/keywords.
- **Web groups / script groups / external search groups** — parsed but no members in-session;
  not worth a builder UI.

See BUILD-LOG.md for build order and progress.
