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

## Dropped (legacy / mac-only / superseded) — see FEATURE-SURVEY.md
Separate per-entry editor windows; TeX-task PDF preview; Z39.50/SRU + MARC/MODS importers
(kept RIS); macOS Services / Spotlight / QuickLook; color labels; web/script groups.
