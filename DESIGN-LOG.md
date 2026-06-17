# Design Log — bibdesk-electron

A running record of **design choices** made while building the BibDesk replacement,
so they can be reviewed and challenged. Reference for truth: the original BibDesk
source at `/Users/jalex/Source/BibDesk/bibdesk/` (read-only) — but it is old; we
modernize rather than copy. Newest entries at the bottom. See also `BUILD-LOG.md`
(progress/status), `FEATURE-SURVEY.md` (keep/drop), and `docs/help/` (user manual).

Format per decision: **what** we chose, **why**, **alternatives considered**, and
**how to revisit** (the single place to change it).

---

## Architecture (locked early; recorded here for review)

- **Monorepo, pure core + thin Electron shell.** All bibliography logic lives in
  framework-free `core/*` packages and one pure `app/src/main/document-service.ts`;
  Electron `main`/`preload`/`renderer` are thin. *Why:* testable headless core,
  portability, and a clean seam for the plugin API. *Revisit:* the package split in
  `pnpm-workspace.yaml`.
- **Custom BibTeX parser/serializer** (not a 3rd-party lib) with a byte-faithful
  round-trip property + golden tests. *Why:* BibDesk's on-disk nuances (BibDesk
  group records, `Bdsk-File-N` base64 plists, macro/`@string`, brace/quote rules)
  must round-trip exactly. *Revisit:* `core/bibtex/`.
- **UI = React + Zustand + TanStack Table (virtualized).** *Why:* a single-store
  data flow, virtualization for 10k+ rows, minimal ceremony. *Revisit:* `app/src/renderer`.
- **Typed IPC contract** (`shared/`): one source of truth maps each channel to its
  request/response; `IpcHandlers` enforces full coverage. *Why:* end-to-end type
  safety across the process boundary. *Revisit:* `shared/src/{channels,contract,api}.ts`.
- **Preferences = JSON in userData** (replaces NSUserDefaults), merged over
  `DEFAULT_SETTINGS` on load so new keys are forward-compatible. *Revisit:*
  `app/src/main/settings.ts`.

## Notable library/format choices

- **MathJax** (Apache-2.0) for math, per the user (over KaTeX).
- **citation-js** for CSL formatted citations — it bundles **citeproc-js (CPAL/AGPL)**,
  the one non-permissive dependency, user-accepted. Single swap point: `app/src/main/csl.ts`.
- **FontAwesome Free** SVG icons (table columns), per the user. Code MIT, icons CC BY 4.0.
- **better-sqlite3 FTS5** for full-text search (incl. extracted PDF text via pdfjs-dist).
  Native addon is ABI-specific → `scripts/rebuild-native.mjs` switches Node/Electron ABI;
  FTS degrades to "unavailable" (client-side substring filter) if it can't load.
- **Handlebars** as the template engine (per the user) for HTML export; RIS/CSV are
  hand-rolled for full control. *Revisit:* `app/src/main/export.ts`.

## Feature design choices (this autonomous session)

- **Table icon columns.** key=keywords, paperclip(+count)=attachments, checkbox=Read
  (tri-state: ✓ on / empty box off / blank unset). Amber key vs blue check so they read
  distinctly. *Alt:* text columns — rejected as cluttered.
- **Full menus via a typed `MenuCommand` event.** Main owns the native menu (Electron
  requirement); renderer-state items forward a typed command; file-level actions
  (Open/Save As/Revert/Export/Import dialog) run in main directly. *Why:* keep the store
  authoritative without dozens of IPC channels.
- **Paste / drag-drop import.** A bare paste of `@type{…}` text imports (editable fields
  keep normal paste); `.bib` merges, `.ris` RIS-imports, other files → an entry titled by
  the filename + the file attached. Pasted cite keys are kept and disambiguated on
  collision (`a`→`a-1`) rather than regenerated. *Why:* preserve the source key identity
  (Google Scholar workflow). File paths via Electron `webUtils.getPathForFile`.
- **Drag-out `\cite{}`.** Rows are `draggable`; dragstart writes the cite command from a
  configurable template (`%K` → comma-joined keys). *Alt:* a floating BibDesk-style
  Citations drawer + live TeX service — dropped as heavyweight legacy.
- **Find & Replace.** Operates on raw field values, scoped to the current group; preview
  (no mutation) vs Replace All; literal or regex; skips `Bdsk-File-N` blobs. Invalid regex
  is reported, never thrown.
- **Find Duplicates.** Bucket by the model's `equivalenceKey` (type + required/optional
  field hash) then confirm pairwise with `itemsEquivalent` so hash collisions don't make
  false groups; plus identical-cite-key groups. *Why:* fast + precise.
- **Configurable columns.** `Settings.columns` is an ordered list of keys; builtins render
  with bespoke cells, any other key is a BibTeX field text column (main computes a
  de-TeXified `row.extra`). Toggle via **View → Columns** (native checkboxes, BibDesk-style)
  AND a Preferences manager (reorder/add). *Why:* both the quick menu toggle and full reorder.
- **Multi-format export.** BibTeX (serializer), RIS (TY/ER tag map), CSV (quoted), HTML
  (Handlebars styled bibliography, values escaped). RTF deferred. Subset-or-whole-library.
- **AutoFile.** Moves `Bdsk-File-N` files into a Papers folder, named by the AutoFile
  format (`parseFormat` with local-file sanitization); cross-volume copy fallback;
  unique-path dedupe; rewrites the stored relative path. *Revisit:* `Settings.papersFolder`/
  `autoFileFormat`, `document-service.autoFile`.
- **Plugin API (`plugins-sdk`).** A pure facade over a `BibLibrary` (query/mutate/macros/
  import/duplicates/events) + a `PluginManager`. It is the intended toolset for the future
  Claude assistant. *Why:* one stable surface for both third-party plugins and the agent.
- **Undo/redo = snapshot-based.** Before each mutation we snapshot the serialized library
  (deduped against the stack top so a multi-file op is one step); undo/redo re-parse a
  snapshot and rebuild the in-memory document. *Why:* simple and provably correct given the
  byte-faithful round-trip, vs. per-command inverses (complex for structural/import edits).
  *Trade-off:* re-parsing reassigns item UUIDs, so the renderer reloads (selection resets)
  via a `documentOpened` re-notify; `OpenedDocument.dirty` carries the post-undo dirty state.
  Menu Undo/Redo (⌘Z/⇧⌘Z) replace the text-field `role:undo` — document-level undo is the
  BibDesk behavior; field editors commit on blur so per-keystroke undo is less important.
  *Revisit:* `document-service` `snapshot`/`undo`/`redo`/`restoreSnapshot`.
- **Autosave** is opt-in (`Settings.autosave`): a 1.5 s debounce after the doc becomes
  dirty, driven by a renderer effect. *Why:* keep it simple/observable; explicit Save stays.

- **Claude scripting assistant (#4).** A docked chat panel (Tools → Claude Assistant, ⌘J) over
  the open library. *Key storage:* the user's Anthropic key is encrypted with Electron
  `safeStorage` and written to `userData/agent-key.bin` — never in settings/plaintext, never sent
  to the renderer. *Loop:* a provider-agnostic turn loop (`agent.ts`, unit-tested with injected
  `callModel`/`executeTool`/`approve`) issues Anthropic tool-use rounds; the Electron glue in
  `index.ts` supplies the real HTTPS call (`fetch` → `api.anthropic.com/v1/messages`), tool
  dispatch, and approval. *Tools:* read freely (list/get/search/find_duplicates/export); every
  **mutation** (set_field/add_entry/delete_entry/generate_cite_key) is gated on a **native
  approval dialog**. *Why native dialog* over a renderer approval protocol: simplest correct gate,
  and it keeps the loop in main. *Tool execution* goes through `document-service` (applyEdit/
  importEntry/…) — NOT raw `plugins-sdk` — so dirty/undo/reindex stay consistent; `plugins-sdk`
  remains the conceptual/stable API. Conversation history lives in main per-document; on a mutating
  turn the renderer reloads. Default model `claude-opus-4-8` (editable in Preferences). *Revisit:*
  `app/src/main/agent.ts` (loop + tool schema) + the agent glue in `index.ts`.

- **Smart / static group EDITOR (#10) — DONE (resolved the earlier deferral).** First I found the
  real on-disk format in the synthesized fixtures (`bd-static-groups.bib`, `bd-all-groups.bib`,
  which DO have golden round-trip coverage): a `@comment{BibDesk <Kind> Groups{…}}` block decodes
  to ONE `GroupRecord` whose `data` is an **`<array>` of group dicts** (static `{group name, keys}`;
  smart `{group name, conditions:[{comparison,key,value,version}], conjunction}`). The pre-existing
  `buildGroup`/`listGroups` read that array AS a single dict → parsed static/smart groups had blank
  names and no members (only computed *category* groups worked; no fixture had ever exercised it).
  **Fix (a real bug):** `dictsOf` normalizes `record.data` to its dict array; `buildGroupFromDict`
  builds one typed group per dict; `groupsFromLibrary`/`listGroups` (new `parsedGroupNodes`, stable
  `g#record#dict` ids)/`listPublications`/`membersOf` (new `resolveParsedGroup`) all iterate dicts —
  verified against `bd-all-groups.bib`. Serialization untouched, so the byte-faithful round-trip is
  preserved. **Editor:** a single `groupEdit(GroupCommand)` IPC (create static/smart, rename, delete,
  static add/remove members); smart integers use `plistInteger()` so they round-trip. *UI:* sidebar
  ＋Group (inline-named) / ⚙Smart (a small condition builder — field + BDSKComparison + value, AND/OR;
  `window.prompt` is disabled in Electron so all editing is inline/modal); rename on double-click,
  delete ×, and **drag a row onto a static group** to add it (rows carry an
  `application/x-bibdesk-citekeys` flavor). Verified by tests (incl. serialize→re-parse for both
  kinds) + GUI. *Revisit:* `document-service.groupEdit` + `GroupsSidebar`/`SmartGroupDialog`.

## Post-port gap-closing (BibDesk parity batch)

- **More internet importers.** Added OpenAlex, PubMed (NCBI eutils esearch+efetch),
  DOI lookup (CrossRef `/works/{doi}`), and ISBN (Open Library) to the online search,
  reusing the `OnlineResult` shape + `makeResult`. Pure parsers exported + tested.
- **Merge duplicates.** `mergeEntries` EditCommand (one undo step): primary keeps its
  values + gains missing ones, Keywords unioned, attachments carried over, others
  deleted. Merge button per group in Find Duplicates.
- **Rich field editors.** `ItemField.kind` (TypeManager-classified) drives per-type
  widgets: rating stars, boolean checkbox, tri-state select. *Deferred within this:*
  a date picker (timestamp-clobbering risk on Date-Added/Modified) and a full
  author/person editor — left as text + autocomplete.
- **Automation (native by design).** Two layers: (1) `x-bibdesk://` URL scheme for
  fire-and-forget commands; (2) a **loopback, token-authed HTTP bridge** (`bridge.json`
  discovery) that returns data, so queries work — AppleScript/shell drive it today
  (`bibdesk-bridge.sh`); native helper apps (macOS `.sdef`, Windows PowerShell, Linux)
  are thin translators on top. *Native helper apps are scaffolded/designed only* —
  compiling+signing needs platform toolchains (see `docs/automation/native-helpers.md`).
  `app.setName('BibDesk')` so userData/`bridge.json` sit at a predictable path.
- **RTF.** `rtf.ts` (htmlToRtf + wrapRtf); Copy Citation as RTF (clipboard) + RTF
  bibliography export. *Why main-side:* `clipboard.writeRTF` is main-only.
- **PDF → DOI import.** Dropped PDFs: extract text (pdfjs) → find a DOI → CrossRef
  lookup → import the real metadata + attach the PDF; no-DOI PDFs fall back to a stub.
- **Multi-select + batch ops.** Cmd/Shift-click selection; one-undo-step batch
  setField / add+remove keyword / delete via a floating BatchBar. *Design note:*
  detail-loading was split into `loadDetail` so it never clobbers `selectedIds`
  (fixed a race that dropped rows under rapid Cmd-clicks).
- **Journal thumbnails (data).** Two background agents downloaded **309 covers**
  (philosophy + top-tier science/social-science) into `app/resources/journals/covers/`
  + a manifest, with `philosophy.json`/`top-journals.json` metadata indexes. *Honest
  finding:* big subscription publishers (Elsevier/Wiley/ACS/OUP/APA) serve JS
  bot-challenges or logo favicons, not cover art; the manifest tags each by `kind` so
  the view panel can prefer real `og:image` covers and fall back to a generated
  typographic cover.
- **Journal thumbnails (view panel).** `journal-covers.ts` resolves an entry to a
  bundled cover by ISSN-L → any alternate ISSN → journal name (pure `resolveCover`,
  unit-tested); the `journalCover` IPC handler reads the bytes (basename-guarded) and
  the detail card shows the image floated by the title. *Design choice:* every entry
  gets art — when no real cover exists, the renderer draws a deterministic hue +
  abbreviation placeholder (`GeneratedCover`) rather than leaving a gap. *Revisit:*
  `main/journal-covers.ts`, `DetailPane` JournalCover/GeneratedCover.
- **Edit existing smart groups.** Smart groups were write-once (create only). Added a
  `GroupCommand` `editSmart` + a read-back `groupConditions` so the smart-group dialog
  re-opens pre-filled (name/conjunction/conditions) and rewrites the stored dict in
  place (serializer round-trips it). A ✎ button on smart-group sidebar rows opens it.
  *Design choice:* an unknown stored condition field (e.g. `Date-Added`, not in the
  preset list) is preserved by prepending it to the field `<select>` so editing never
  silently drops it. *Revisit:* `document-service.groupConditions`/`groupEdit`,
  `SmartGroupDialog` (editGroupId mode).

- **Print.** `File → Print…` (⌘P) renders a **CSL-formatted** bibliography (the
  detail-pane citation style, hanging-indented) to a print-ready HTML doc
  (`print.ts buildPrintHtml`, pure + unit-tested), loads it into an offscreen
  window, and invokes the OS print dialog (macOS also gives Save-as-PDF for free).
  *Design choices:* (1) **renderer-driven** so it respects the current view — the
  multi-selection if >1 is selected, else the current group's rows — whereas
  Export always writes the whole library; (2) reuses the existing CSL formatter
  (same path as RTF export) rather than the HTML-export Handlebars template, so a
  printout matches the user's chosen reference style; (3) a temp file (not a
  data: URL) avoids URL-length limits for large libraries; a user-cancelled dialog
  counts as success. *Revisit:* `main/print.ts`, `printItems` in `index.ts`,
  `store.print`.

- **EndNote import.** `endnote.ts` parses the two formats people actually export:
  the **Refer/tagged `.enw`** (Google Scholar's "EndNote" button, journal-site
  "download citation → EndNote") and **EndNote XML** (`.xml`/`.enl`), both into the
  same `{ entryType, fields }` records the RIS importer already produced. Wired into
  the drag-drop + file-dialog import path (`.enw`/`.enl`/`.xml` extensions) and the
  document store (`importEndnoteText`, sharing `addParsedRecords` with RIS). *Design
  choices:* (1) sniff XML vs tagged by leading `<?xml`/`<xml`; (2) a recursive text
  extractor unwraps EndNote XML's `<style>` runs (its text nodes are wrapped); (3)
  reuse the RIS record→BibItem loop rather than duplicating it. *Why these formats:*
  EndNote XML's binary `.enl` *library* needs EndNote itself, but its XML/tagged
  *exports* are the realistic migration path — Z39.50/MARC/MODS stay dropped (see
  FEATURE-SURVEY). *Revisit:* `main/endnote.ts`, `importEndnoteText`/`importFiles`.

- **Find & repair broken file links.** `Publication → Find Broken Links…` scans
  every entry's file attachments and lists those whose target is missing on disk
  (`document-service.findBrokenLinks`, read-only). For managed `Bdsk-File-N`
  attachments the modal offers **Locate…** (`relocateAttachment` rewrites the
  stored relative path to a user-picked file) and **Remove**; the row's cite key
  selects the entry. *Design choices:* (1) reuse the existing `itemFiles`
  resolver so "broken" means exactly "what the detail pane would fail to open";
  (2) report plain field-links (`Local-Url`) for awareness but only offer
  Locate/Remove on field-backed managed attachments (those have a `Bdsk-File-N`
  to rewrite); (3) re-scan after each repair so the list shrinks live. Mirrors
  BibDesk's broken-link finding; complements AutoFile (bulk re-file when originals
  still exist). *Revisit:* `findBrokenLinks`/`relocateAttachment`, `BrokenLinks.tsx`.

- **Rename / merge authors.** Double-clicking an author in the sidebar renames
  that person across every entry's `Author` and `Editor` field
  (`document-service.renameAuthor`, one undo step) — and thereby **merges** two
  name forms (rename `Smith, J.` → `Smith, John` and the two author categories
  collapse). *Design choices:* (1) match by `@bibdesk/names` **canonical
  normalized name**, not fuzzy first-initial equivalence — predictable, never
  silently fuses two people who share a surname (the user picks the exact target
  spelling); (2) operate on the raw field via `splitNameList` and replace only
  the matched token, re-joining with ` and `, so every other name is byte-stable;
  (3) reuse the existing inline-rename affordance from group rows (author rows
  become `RENAMABLE`; `commitRename` routes author kind → `renameAuthor`).
  *Revisit:* `document-service.renameAuthor`, `GroupsSidebar` commitRename.
  Added a reusable `BIBDESK_SMOKE_DBLCLICK` dev hook to verify inline-rename UIs.

- **Export selected entries.** `File → Export → Selected Entries (BibTeX)…` writes
  just the highlighted rows (or the single selected entry) to a `.bib`, closing the
  documented "Export always writes the whole library" gap. *Design choices:* (1)
  renderer-driven (it knows the selection) → `exportSelection` IPC does the save
  dialog + write, reusing the already-tested `exportText('bibtex', itemIds)` subset
  serialization; (2) BibTeX-only — "give me these references" almost always means a
  `.bib` for a paper, and a per-format submenu would need a command per format
  (MenuCommand carries no payload). The five whole-library Export formats are
  unchanged. *Revisit:* `exportSelectionAs` in `index.ts`, `store.exportSelection`.

- **PDF full-text indexing off the main thread + cached.** Opening a large
  library (measured: 1337 entries, ~100ms to parse+index+list) felt slow because
  background full-text indexing extracted ~347 PDFs via pdfjs *on the main
  process* (~19s of solid CPU), starving IPC/UI. Fixed in three steps: (1) a
  worker-thread **pool** (`pdf-pool.ts` + `pdf-worker.ts`) runs pdfjs off the main
  loop, parallel across cores (size = min(4, cores−1)) — the main thread never
  blocks; (2) a persistent **text cache** (`pdf-cache.ts`, keyed by abs path +
  mtime + size under userData) so reopening a library skips re-extraction
  entirely; (3) indexing is **deferred 2s** after open so the renderer's first
  load wins the thread. *Design choices:* `indexAttachments` takes an injectable
  `extract` (default = inline single-PDF extractor) so the store stays pure/
  testable and Electron-only concerns (workers, userData) live in `index.ts`; the
  pool always resolves (''-on-crash) and respawns dead workers so one bad PDF
  can't wedge the queue; cache validated against live file stat so a moved/edited
  PDF transparently re-extracts. *Known follow-up:* the JSON cache grows
  unbounded across libraries (~22MB for this one) — fine now, an LRU/size cap or
  sqlite store is the next step if it matters. *Revisit:* `pdf-pool.ts`,
  `pdf-cache.ts`, `pdfExtract`/`openPath` in `index.ts`, `indexAttachments`.

- **Resizeable + drag-reorderable columns.** Columns can now be **resized** by
  dragging a header's right-edge handle and **reordered** by dragging the header
  itself (drop = insert before target). *Design choices:* (1) a header cell is now
  a flex wrapper of a `.bd-th__label` (click=sort, draggable=reorder) + an
  absolute right-edge `.bd-th__resize` (mousedown=resize) so the three gestures
  never collide; (2) resize keeps the flex model — a resized column gets a stored
  `columnWidths[id]` and flips from grow→fixed (so the drag is exact, captured
  from the live `offsetWidth` to avoid a jump); Authors/Title still grow until
  pinned, and a trailing flex spacer fills slack only when nothing grows, so the
  header/body stay aligned with no horizontal-scroll machinery; (3) widths persist
  per-column in `settings.columnWidths`, saved on mouseup (not per-pixel). Reorder
  writes `settings.columns` (pure `reorderColumns`, unit-tested). The Preferences
  "Columns" panel loses its ↑/↓ reorder (now header drag) and keeps show/hide/add.
  *Revisit:* `PublicationsTable` (startResize/reorder/flexFor), `settings.columnWidths`.
  *Follow-up fix:* the first cut used flex-grow, which let the body overflow + scroll
  horizontally while the sticky header didn't follow (header/body desynced when scrolled
  past the window). Replaced with a **measured layout**: a ResizeObserver tracks the
  viewport width and every column gets an explicit px width (grow columns split the slack
  to fill; once base widths exceed the viewport the table scrolls). The header is an
  overflow-hidden clip whose inner row is kept at the body's `scrollLeft` on every scroll,
  so header + rows scroll in lockstep and stay aligned; row backgrounds span the full
  (possibly-scrolled) width. Verified header/body cells share position + width after a
  resize-to-overflow + horizontal scroll.

- **Toggleable full-text (PDF) search.** Searching used a single FTS index that
  folded in extracted PDF body text, so a query like "Alexander" matched papers
  that merely *mention* the name in their PDF — too noisy. Now the filter searches
  **fields only by default**, and a FontAwesome PDF button left of the search box
  toggles PDF-inclusive full-text. *Design:* the document keeps **two** FTS5
  indexes — `ftsFields` (field text only) and `fts` (fields + PDF) — kept in lock
  step by `reindex`/`dropFromIndex`; `ftsSearch(documentId, query, includePdf)`
  picks the index. The toggle is a persisted setting (`fullTextSearch`, default
  off); flipping it re-runs the active query. *Why two indexes, not query-time
  filtering:* FTS5 can't exclude a column subset cheaply, and the field-only index
  is small (PDF text is the bulk). *Revisit:* `OpenDoc.ftsFields`, `ftsSearch`,
  `store.setFullTextSearch`, `SearchBox`.

- **Editing moved to a separate window (read-only main view).** The right pane is
  now a read-only `ViewPane` (preview, citation, fields-as-text, notes, attachments
  open-only) + an **✎ Edit…** button — so edits can't happen by accident. Editing
  opens a **separate BrowserWindow** (BibDesk-style): main `createEditorWindow`
  loads the same renderer with a `#editor=<doc>::<item>` hash; `main.tsx` mounts
  `EditorWindow` (which `initEditor`s this window's own store for the one item and
  renders the full `DetailPane`). Triggers: Edit button, **double-click** a row,
  **Publication → Edit Publication… (⌘E)**. *Cross-window sync:* a `mutating()`
  wrapper around content-changing IPC channels broadcasts `documentChanged` to all
  windows except the sender; the main window's listener reloads table + view +
  dirty, and editor windows reload their item. The editor's store runs in
  `editorMode` (skips table/sidebar reloads). Save stays on the main window (⌘S).
  *Design choices:* reuse the existing `DetailPane`/store in the editor window
  (lean `initEditor`) rather than a parallel edit UI; broadcast at the IPC layer so
  it's source-agnostic and future-proof for more windows. *Revisit:*
  `createEditorWindow`/`broadcastDocumentChanged`/`mutating` in `index.ts`,
  `EditorWindow`, `ViewPane`, `store.initEditor`/`reloadAfterExternalChange`.
  Verified end-to-end headless: editor opens with the full form; a title edit
  there updates the main table cell, preview, citation, and dirty flag.

- **Citation style is a preference, not a per-view picker.** The CitationBlock's
  per-view style `<select>` (which overflowed the narrow pane in both the view and
  editor) is gone; the block now formats with `settings.defaultCiteStyle` and just
  shows the style's name. The style is set once in Preferences → Citations and
  applies everywhere (re-renders reactively). *Revisit:* `CitationBlock`.
- **Field add/remove affordances + required-field protection.** The always-present
  empty "add field" row is replaced by a single green circular **＋** below the
  fields; clicking it adds an on-demand blank `NewFieldRow` (Enter saves, red **−**/
  Escape discards). Each existing field's remove control is a red circular **−**;
  **required fields for the entry's type cannot be deleted** — `toItemDetail` flags
  them (`ItemField.required`, from `sharedTypeManager.requiredFieldsForType`) and the
  row shows a small "req" marker instead of a **−**. Changing the entry Type changes
  the required set. *Revisit:* `toItemDetail` (required), `FieldRow`/`Fields`/
  `NewFieldRow` in `DetailPane`, `.bd-circbtn` styles.

- **Welcome / empty-state screen.** With no document open, the app rendered the
  full three-pane chrome over emptiness (stray table header, "0 rows", blank
  sidebar) — looked broken. Now `App` renders a centered `Welcome` screen instead
  when `!hasDoc`: app name + tagline + **Open a Bibliography…** and **New
  Bibliography** buttons + a drag hint. Two new renderer-triggerable IPCs:
  `openDialog` (main shows the Open dialog) and `newDocument` (main prompts for a
  save location, writes an empty `.bib`, then opens it — so the new doc has a real
  path and Save works without untitled-state handling). Dropping a `.bib` on the
  welcome screen opens it (drop handler routes to `openDocument` when no doc is
  open). The welcome screen respects the theme (loadSettings→applyTheme runs on
  mount regardless of document state). *Revisit:* `Welcome.tsx`, `App` no-doc
  branch + drop handler, `newDocument`/`openDialog` in `index.ts`.

- **Url/Doi are links, not attachments (count fix).** An entry with a `Doi` and a
  `Url` was reported as having "two attachments". Cause: `itemFiles` synthesizes
  remote Url/Doi as `url`-kind entries, and the preview card's "📎 N files" chip
  used the *total* `files.length` (incl. those links). Fix: (1) the preview chip
  now counts only `kind === 'file'` entries (the table paperclip already did —
  `attachmentCountOf` excludes Url/Doi); (2) the detail/editor **Attachments**
  section now lists only file attachments, and Url/Doi appear under a separate
  **Links** section (still clickable; they also have DOI/URL chips on the preview
  card). *Revisit:* `buildPreviewHtml` call in `toItemDetail`, `Attachments`
  component (files vs links split). Test: a DOI+URL entry → 0 file attachments,
  2 link entries, no "files" chip.

- **Attachments: open in the system viewer + clickable preview chip + cover nudge.**
  Three tweaks: (1) the journal cover thumbnail (`.bd-jcover`) was overlapping the
  preview card border — nudged down + in (margin 8/6/8/12). (2) PDFs no longer open
  in an in-app viewer — clicking any file attachment calls `openExternal(..,'file')`
  → `shell.openPath` (system default app); the `PdfViewer` component is removed.
  (3) The preview card's "📎 N files" chip is now a real button (`data-open-files`):
  one file opens immediately, several drop a small `PreviewCard` menu (`bd-filemenu`)
  to pick one. *Revisit:* `PreviewCard` (chip click + menu), `Attachments`
  (openExternal, no onPreview), `buildPreviewHtml` chip, `.bd-jcover`/`.bd-filemenu`.

- **Multi-column (secondary) sort.** The listing sort went from a single
  `SortSpec` to an ordered `readonly SortSpec[]` (`ListPublicationsRequest.sort`).
  `listPublications` now walks the keys in priority order and returns the first
  non-zero comparison; a stable sort preserves library order for rows equal on
  every key (no implicit cite-key tie-breaker is appended — the user builds the
  key list). UX (`PublicationsTable`): a plain header click sorts by that column
  alone, flipping direction only when it is already the *sole* key; **Shift-click**
  cycles a column within the multi-key sort (absent → asc → desc → removed, and
  never empty — removing the last key falls back to cite-key asc). Each sorted
  column shows its ▲/▼ arrow plus a small priority badge (`.bd-th__sort-rank`,
  "1/2/3…") that appears only when more than one column is active. Sort stays
  per-session (reset to the default on document open) — not persisted, matching
  prior behaviour. *Revisit:* `setSort(key, additive)` in `store.ts`, the
  comparator + `DEFAULT_SORT_SPECS` in `document-service.ts`, the header in
  `PublicationsTable.tsx`. Tests: store additive asc→desc→remove cycle + a
  secondary-key tie-break; service multi-key priority order.

- **Bulk AutoFile ("Consolidate Linked Files").** Extracted the per-item file-move
  loop out of `autoFile` into a private `autoFileItemFiles(doc, item, papers,
  baseDir)` helper, then added `consolidateLinkedFiles(documentId, itemIds?)` that
  runs it across the whole library (or an itemId subset) under a single undo
  snapshot, reindexing only items that actually moved a file and returning
  `{ scanned, itemsAffected, moved, dirty, errors }` (each error prefixed with its
  cite key). New IPC channel `consolidateLinkedFiles`; the main handler shows a
  native **confirm** dialog before moving anything (files move on disk — that part
  is not undone by the snapshot, which only restores the `.bib` pointers) and a
  **summary** dialog after, matching the native-dialog-in-handler pattern already
  used by relocate / chooseFolder. New `Publication → Consolidate Linked Files…`
  menu item + a `'consolidate'` MenuCommand; the renderer files the current
  multi-selection (2+ rows) or the whole library. **Fixed a latent idempotency bug**
  in the shared move path: `uniquePath` was applied before the "already filed"
  check, so re-filing an already-filed entry coined `name-1`, `name-2`, … each run;
  now we compare the source against the *intended* (pre-uniquified) target and skip
  when equal. Tests: bulk-file two entries + idempotent re-run; subset by `itemIds`
  leaves the others untouched. *Revisit:* `autoFileItemFiles` /
  `consolidateLinkedFiles` in `document-service.ts`, the handler in `index.ts`,
  `consolidateLinkedFiles` in `store.ts`.

## Dropped (legacy / mac-only / superseded) — see FEATURE-SURVEY.md
Separate per-entry editor windows; TeX-task PDF preview; Z39.50/SRU + MARC/MODS importers
(kept RIS); macOS Services / Spotlight / QuickLook; color labels; web/script groups.
