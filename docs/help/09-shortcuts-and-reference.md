# Shortcuts & Reference

This is the reference chapter: the complete menu bar, the keyboard shortcuts and
mouse actions, the Preferences, an explanation of the on-disk file format and
exactly how the app preserves and normalises it, a map of where every kind of
data is stored, a reference for the BibTeX fields the app treats specially, notes
on citations, the `x-bibdesk://` automation URLs, an honest account of current
limitations, a glossary, and general troubleshooting.

Use it as a lookup. The earlier chapters teach the workflows; this one nails
down the details.

## The menu bar

Every command lives in the application menu bar — on macOS in the system menu bar
at the top of the screen; on Windows and Linux attached to the window. The
toolbar duplicates a few of the most common commands, but the menus are the full
inventory. Items marked *(needs an open library)* are greyed out until a `.bib`
file is open.

### Bibliofile menu (macOS only)

On Windows and Linux these items live elsewhere: **Preferences…** and **Quit**
both move to the bottom of the **File** menu.

| Item | Shortcut | What it does |
| --- | --- | --- |
| About Bibliofile | — | Standard about box |
| Preferences… | ⌘, | Open [Preferences](#preferences) |
| Services / Hide / Quit | platform defaults | Standard macOS application roles |

### File menu

| Item | macOS | Win/Linux | What it does |
| --- | --- | --- | --- |
| New Publication | ⌘N | Ctrl+N | Add a new entry *(needs an open library)* |
| Open… | ⌘O | Ctrl+O | Open a `.bib` file |
| Open Recent | — | — | Re-open a recently used library; the submenu ends with an item that clears the list |
| Save | ⌘S | Ctrl+S | Write changes to disk *(needs an open library)* |
| Save As… | ⇧⌘S | Shift+Ctrl+S | Save the library under a new name and keep editing it there *(needs an open library)* |
| Clone Bibliography… | — | — | Write a **self-contained copy** — a new `.bib` plus copies of every attachment it links — and open it in its own window. Nothing in the original is touched. See [Importing & Exporting](07-importing-and-exporting.md#766-cloning-a-bibliography) *(needs an open library)* |
| Revert to Saved | — | — | Discard unsaved changes and reload the last saved version *(needs an open library)* |
| Text Encoding ▸ | — | — | Re-read the file under a chosen encoding, or **Convert to UTF-8** (see [Getting Started](01-getting-started.md#13-opening-a-library)) *(needs an open library)* |
| Show in Finder / Show in File Manager | — | — | Reveal the open `.bib` file in your file manager *(needs an open library)* |
| Import → From File (BibTeX / RIS / EndNote)… | ⇧⌘I | Shift+Ctrl+I | Import `.bib`/`.ris`/EndNote `.enw`/`.enl`/`.xml` files (see [Importing & Exporting](07-importing-and-exporting.md)) *(needs an open library)* |
| Import → Search Online (CrossRef / arXiv)… | ⇧⌘O | Shift+Ctrl+O | Open [online search](08-online-search.md) *(needs an open library)* |
| Export → BibTeX… / RIS… / CSV… / HTML… / RTF (formatted bibliography)… | — | — | Export the whole library to that format *(needs an open library)* |
| Export → Selected Entries (BibTeX)… | — | — | Export only the highlighted entries to a `.bib` file *(needs a selection)* |
| Export → *your templates* ▸ | — | — | One submenu per [export template](11-customizing-panels.md#1111-customizing-outputs) you have defined, each offering **Whole Library… / Shown Entries… / Selected Entries…** *(the submenu is absent when you have no templates)* |
| Select Publications from .aux File… | — | — | Pick a LaTeX `.aux` file and select every entry your document cites *(needs an open library)* |
| Print… | ⌘P | Ctrl+P | Print (or Save as PDF) a CSL-formatted bibliography — the multi-selection if there is one, otherwise every row currently shown (group **and** search filter) *(needs an open library)* |
| Preferences… | — | Ctrl+, | Windows and Linux only — on macOS it lives in the **Bibliofile** menu |
| Quit | — | platform default | Windows and Linux only — on macOS it lives in the **Bibliofile** menu |

### Edit menu

**Undo** (**⌘Z** / **Ctrl+Z**) and **Redo** (**⇧⌘Z** / **Shift+Ctrl+Z**) are
document-level: they step a library edit (a field change, a delete, a batch
operation, …) back and forth, and the menu labels name the action (e.g. *Undo
Delete*). Cut, Copy, Paste, Paste and Match Style, Delete, and Select All are the
standard platform editing roles with their usual system shortcuts and apply to
text fields. The app-specific commands are:

| Item | macOS | Win/Linux | What it does |
| --- | --- | --- | --- |
| Select Incomplete Publications | — | — | Select every entry with an empty **required** field for its type (a value inherited via `Crossref` counts as present); says so and changes nothing when there are none *(needs an open library)* |
| Paste Publication | ⇧⌘V | Shift+Ctrl+V | Import BibTeX from the clipboard as new entries *(needs an open library)* |
| Find… | ⌘F | Ctrl+F | Focus the search box *(needs an open library)* |
| Find & Replace… | ⌥⌘F | Alt+Ctrl+F | Open [Find & Replace](03-editing-entries.md#find--replace) across field values *(needs an open library)* |
| Copy Cite Key | ⌥⌘K | Alt+Ctrl+K | Copy the selected entry's bare cite key *(needs an open library)* |
| Copy Citation | — | — | Copy the formatted CSL citation as text *(needs an open library)* |
| Copy Citation as RTF | ⌥⌘R | Alt+Ctrl+R | Copy the selected entry's formatted citation as **styled** RTF, so italics survive a paste into a word processor *(needs an open library)* |
| Copy as BibTeX | ⌥⌘B | Alt+Ctrl+B | Copy the selected entry's BibTeX source *(needs an open library)* |
| Copy \cite{…} | ⌥⌘C | Alt+Ctrl+C | Copy a `\cite{…}` command using your cite-command template *(needs an open library)* |
| Copy As → RIS | — | — | Copy the **whole selection** as RIS *(needs an open library)* |
| Copy As → Minimal BibTeX | — | — | Copy the whole selection as BibTeX with the housekeeping fields dropped — `Bdsk-File-N`, `Date-Added`, `Date-Modified`, `Rating`, `Read`, `Local-Url` *(needs an open library)* |
| Copy As → LaTeX \bibitem | — | — | Copy the whole selection as `\bibitem{key} …` lines, each entry rendered in your default CSL style *(needs an open library)* |

### Publication menu

Every item needs an open library.

| Item | macOS | Win/Linux | What it does |
| --- | --- | --- | --- |
| New Publication | ⌘N | Ctrl+N | Add a new entry |
| New Publication with Crossref | — | — | Add a new entry whose `Crossref` already points at the selected entry (see [Crossref](#glossary)) |
| New Publications from Clipboard | ⌥⌘L | Alt+Ctrl+L | The same command as **Edit → Paste Publication** (⇧⌘V) under its discoverable name: read BibTeX from the clipboard and add the entries. See [Importing & Exporting](07-importing-and-exporting.md) |
| Edit Publication… | ⌘E | Ctrl+E | Open the selected entry in a separate editor window (also: ✎ Edit… / double-click a row / **Enter** with the table focused) |
| Duplicate | ⇧⌘D | Shift+Ctrl+D | Copy the selected entry under a new cite key |
| Delete Publication | — | — | Delete the **whole selection** (like Delete/Backspace with the table focused; the toolbar 🗑 button deletes only the focused row) |
| Generate Cite Key | ⌘K | Ctrl+K | Generate a cite key for the selection (regenerates **all** selected entries in one undo step, kept unique across the batch) |
| Select Crossref Parent | — | — | Jump the selection to the entry named in the selected entry's `Crossref` field |
| Color Label ▸ | — | — | Apply one of the seven [colour labels](02-browsing-and-searching.md#color-labels) (Red, Orange, Yellow, Green, Blue, Purple, Gray) to the selection, or **None** to clear it |
| Find Duplicates… | — | — | Open [Find Duplicates](02-browsing-and-searching.md#26-finding-duplicates) |
| Add File Attachment… | — | — | Attach a file to the selected entry |
| AutoFile Linked Files | — | — | [AutoFile](04-attachments.md#autofile-organising-linked-files) the attachments of every selected entry |
| Consolidate Linked Files… | — | — | AutoFile across the **whole library** (or just the selection when two or more rows are selected), and backfill macOS bookmarks on links that lack them. See [Attachments](04-attachments.md#compatibility-with-macos-bibdesk) |
| Find Broken Links… | — | — | Find attachments whose files are [missing on disk](04-attachments.md#finding-and-repairing-broken-links) and repair them |
| Find Open-Access PDFs… | — | — | Locate and attach [open-access PDFs](04-attachments.md#finding-open-access-pdfs) for the selected entries |
| OCR Scanned PDFs… | — | — | Add a searchable text layer to the selection's **image-only** PDFs, replacing each file in place after backing the original up. See [Attachments](04-attachments.md#ocr-making-scanned-pdfs-searchable) |
| Macros (@string)… | — | — | Open the `@string` macro editor |

### View menu

| Item | macOS | Win/Linux | What it does |
| --- | --- | --- | --- |
| Toggle Side Panel | ⌥⌘S | Alt+Ctrl+S | Show/hide the right (detail) pane (see [Configurable Panels](10-panels.md)) |
| Toggle Bottom Panel | ⇧⌘B | Ctrl+Shift+B | Show/hide the bottom panel |
| Side Panel → Details | ⌥⌘1 | Alt+Ctrl+1 | Show the read-only detail view in the side pane |
| Side Panel → Claude | ⌥⌘2 | Alt+Ctrl+2 | Show the 🤖 Claude assistant in the side pane |
| Bottom Panel → Annotation | ⌥⌘3 | Alt+Ctrl+3 | Show the annotation reader in the bottom panel |
| Bottom Panel → Tabbed | ⌥⌘4 | Alt+Ctrl+4 | Show the [Annotation · Abstract · Attachments tabs](10-panels.md#the-tabbed-view) in the bottom panel |
| Bottom Panel → LaTeX Preview | ⌥⌘5 | Alt+Ctrl+5 | Show the [LaTeX preview](10-panels.md#latex-preview) in the bottom panel |
| Columns → (submenu of checkboxes) | — | — | Show/hide table columns. The menu offers Cite Key, Type, Authors, Title, Year, Keywords, Attachments, Read, Rating, Journal, Booktitle, Publisher, DOI, URL and Month, plus any other column you have already added in Preferences (see [Configuring the columns](02-browsing-and-searching.md#226-configuring-the-columns)) *(needs an open library)* |
| Toggle Light / Dark Theme | ⇧⌘L | Shift+Ctrl+L | Switch between light and dark appearance |
| Actual Size / Zoom In / Zoom Out | ⌘0 / ⌘+ / ⌘− | Ctrl+0 / Ctrl+ / Ctrl− | Standard zoom roles |
| Toggle Full Screen / Reload / Toggle Developer Tools | platform defaults | platform defaults | Standard window roles |

> **Note:** Choosing a **Side Panel** or **Bottom Panel** content item also
> *reveals* that panel if it was hidden, so a single shortcut both shows the panel
> and selects its content.

### Tools menu

| Item | macOS | Win/Linux | What it does |
| --- | --- | --- | --- |
| Claude Assistant… | ⌘J | Ctrl+J | Open the 🤖 Claude assistant in the side pane *(needs an open library)* |
| Script Console… | ⌥⌘J | Alt+Ctrl+J | Open the [JavaScript Script Console](12-scripting.md) to automate the library *(needs an open library)* |
| Scripts ▸ | — | — | Your saved scripts *(each needs an open library)*, plus **New Script…** and **Open Scripts Folder**, which work with no library open — see [Scripting](12-scripting.md#running-scripts) |
| Download Missing Journal Covers… | — | — | Look up missing journal/book cover images online *(needs an open library)* |
| LaTeX Preview | — | — | Open the bottom panel's [LaTeX preview](10-panels.md#latex-preview) (true BibTeX/`.bst` typesetting of the selection) *(needs an open library)* |

### Window and Help menus

The **Window** menu holds Minimize and Zoom, then **Bring All to Front** on macOS
(**Close** on Windows and Linux), and finally a checkmarked list of every open
library — pick one to bring its window forward. The **Help** menu's **Bibliofile
Help** item (F1 on Windows/Linux) opens this manual in its own window.

## Keyboard shortcuts (quick list)

The app-specific accelerators, gathered in one place (macOS first; on Windows and
Linux ⌘ is Ctrl, ⌥ is Alt):

| Shortcut | Command |
| --- | --- |
| ⌘O | Open… |
| ⌘N | New Publication |
| ⌘S | Save |
| ⇧⌘S | Save As… |
| ⌘P | Print… |
| ⇧⌘I | Import → From File (BibTeX / RIS / EndNote)… |
| ⇧⌘O | Import → Search Online… |
| ⇧⌘V | Paste Publication |
| ⌥⌘L | New Publications from Clipboard (the same command) |
| ⌘F | Find (focus search) |
| ⌥⌘F | Find & Replace… |
| ⌥⌘K | Copy Cite Key |
| ⌥⌘R | Copy Citation as RTF |
| ⌥⌘B | Copy as BibTeX |
| ⌥⌘C | Copy \cite{…} |
| ⌘E | Edit Publication… (separate editor window) |
| ⇧⌘D | Duplicate |
| ⌘K | Generate Cite Key |
| Delete / Backspace | Delete the selected entries (with the table focused; undoable) |
| ⇧⌘L | Toggle Light / Dark Theme |
| ⌥⌘S | Toggle Side Panel |
| ⇧⌘B | Toggle Bottom Panel |
| ⌥⌘1 / ⌥⌘2 | Side panel content: Details / Claude |
| ⌥⌘3 / ⌥⌘4 / ⌥⌘5 | Bottom panel content: Annotation / Tabbed / LaTeX Preview |
| ⌘J | Claude Assistant (in the side pane) |
| ⌥⌘J | Script Console… (JavaScript automation) |
| ⌘, | Preferences… |
| Enter | Commit a single-line field edit / the cite key / the add-field row; run an online search; run a Find preview |

> **Note:** **Save** also works from anywhere in the window, including while the
> focus is in a field — the field you are typing in is committed first, so its
> value is part of that save. The standard Edit/View/Window roles (cut, copy,
> paste, zoom, minimize, and so on) keep their usual platform shortcuts.

### Keys in the publications table

These act on the table itself, so they need the table to have keyboard focus
(click a row once):

| Key | What it does |
| --- | --- |
| **↑ / ↓** | Move the selection one row up/down in the current sort order |
| **Page Up / Page Down** | Move roughly one screenful |
| **Home / End** | Jump to the first / last row |
| **Shift + any of the above** | Extend the selection to the new row instead of replacing it |
| **⌘A** / **Ctrl+A** | Select every row currently shown |
| **Enter** | Open the selected entry in its [editor window](03-editing-entries.md) |
| **Delete / Backspace** | Delete the selection (undoable) |
| **Any letter or digit** | Type-select: jump to the next row starting with what you type. Keep typing to refine; the buffer resets after a short pause. It matches on the column you are sorted by |

The list always scrolls to keep the moved-to row in view.

### Mouse and click actions

Plenty of behaviour is driven by the pointer rather than the keyboard. The
useful ones:

| Action | How |
| --- | --- |
| **Select an entry** | Click its row in the publications table; the detail pane updates |
| **Extend the selection** | **Cmd/Ctrl-click** a row to add/remove it; **Shift-click** for a range; **⌘A** / **Ctrl+A** for all. 2+ rows switch both panels to the [multi-select view](10-panels.md#working-with-multiple-selected-entries) |
| **Right-click a row** | Open the row [context menu](10-panels.md#the-row-context-menu): **Edit Annotation…** (opens the [standalone annotation editor](05-notes-and-abstracts.md#the-annotation-editor-window)), **Find Open-Access PDF…** ([locate + attach an OA PDF](04-attachments.md#finding-open-access-pdfs)), a strip of **colour-label** dots (and a **✕** to clear), and **Delete entry** / **Delete N entries**. A right-click outside the selection selects just that row first |
| **Delete the selection** | Press **Delete** / **Backspace** (table focused), or use the right-click **Delete** item; undoable |
| **Sort the table** | Click a **column header**; click the same header again to flip ascending/descending (a ▲/▼ marks the active column). **Shift-click** a header instead to add it as a secondary key — shift-clicking it again flips that key, and a third time drops it |
| **Open the editor window** | **Double-click** a row (or press **Enter** with the table focused) |
| **Drag out a citation** | Drag a row into a TeX editor (or any text field) to insert a `\cite{…}`. Dragging a row that is part of a multi-selection carries the **whole selection**, comma-joined (`\cite{key1,key2}`), in the table's visible order |
| **Filter by group** | Click a group in the left sidebar (Library, a Static/Smart group, or an Author/Keyword category) |
| **Clear the group filter** | Click **📚 Library** |
| **Filter by text** | Type in the **search box** at the top-right (full-text search; substring fallback) |
| **Edit a field** | In the [editor window](03-editing-entries.md#editing-fields) (the main window's detail pane is read-only), click its value, type, then press **Enter** (long values open a multi-line box — click away to commit); pick from the autocomplete list |
| **Add a field** | Click the green **＋** below the Fields list, name the field, and press **Enter** (moving focus out of the row commits it too) |
| **Remove a field** | Click the **−** at the end of its row (or clear the value and commit) |
| **Switch theme** | Click the **☾ / ☀** toggle in the header (light ⇄ dark) |
| **Open a link / file** | Click a DOI/URL chip, the **📎 N files** chip, or an attachment (files open in your OS default app) |
| **Jump to a cross-referenced note** | Click a `[[citeKey]]` link inside a rendered note |
| **Import by drag-and-drop** | Drag `.bib`/`.ris`/PDF/other files onto the **publications table** (the middle column) |

Cross-references for these: sorting, filtering, and columns are covered in
[Browsing & Searching](02-browsing-and-searching.md); field editing and the copy
commands in [Editing Entries](03-editing-entries.md); importing and exporting in
[Importing & Exporting](07-importing-and-exporting.md); links and `[[citeKey]]`
notes in [Notes & Abstracts](05-notes-and-abstracts.md) and
[Preview & Citations](06-preview-and-citations.md).

## File format & fidelity

Your library is a **standard `.bib` (BibTeX) text file**, and it is the **single
source of truth**. There is no sidecar metadata folder and no second copy of your
data — every fact about your library (entries, groups, macros, notes, attachment
links) is read from, and written back to, that one plain-text file. You can open
it in any text editor, version-control it with Git, and use it directly with
LaTeX.

The one thing the app keeps outside the file is a **derived cache**: the text it
extracts from your attached PDFs, so that [full-text search](02-browsing-and-searching.md#231-what-is-matched)
doesn't have to re-read every PDF on every launch. That lives in the app's own
per-user folder, never beside your `.bib`, and it is disposable — delete it and
it rebuilds. See [Where data is stored](#where-data-is-stored).

### Preserved BibDesk extensions

BibDesk stores a handful of things inside the `.bib` file using BibTeX comment
and string mechanisms, so that the file remains valid BibTeX while carrying
extra structure. The app reads, preserves, and rewrites all of them, so a
library round-trips faithfully — you can move it between this app and the
original macOS BibDesk without anything being mangled:

- **`@string` macros** — reusable abbreviations (for instance a short token that
  expands to a full journal name). Editable via the **@string…** toolbar button
  or **Publication → Macros (@string)…**.
- **`@preamble`** — a LaTeX preamble block, preserved verbatim.
- **Group blocks** — saved **Static**, **Smart**, **URL**, and **Script**
  groups, stored as specially structured `@comment` blocks. (Static and Smart
  groups filter the table in this app; URL and Script groups are *preserved on
  disk* but are not evaluated here — see
  [Limitations](#limitations--not-yet).)
- **`@bibdesk_info`** — BibDesk's document-info block (window/display state and
  similar), preserved verbatim.
- **`Bdsk-File-N` attachments** — file attachments encoded as numbered,
  base64 binary-plist blobs holding a relative path plus, on macOS, an Apple
  **bookmark** blob. Existing bookmarks are preserved untouched; on macOS this
  app now also *writes* one for every attachment it stores, so a library it
  created has the same moved-file recovery in macOS BibDesk that BibDesk's own
  files do. Off macOS the blob is relative-path-only, which BibDesk still reads.
  See [Attachments](04-attachments.md#compatibility-with-macos-bibdesk).

### Normalisations applied on save

The serializer reproduces BibDesk's own on-disk formatting rules, which means a
freshly saved file is *tidied* into a canonical shape rather than written back
byte-for-byte as you typed it. Expect these normalisations every time you save:

- **Field names are lower-cased** (`Author` → `author`, `Doi` → `doi`). This is
  cosmetic — BibTeX field names are case-insensitive.
- **Fields are sorted** within each entry, case-insensitively and
  numeric-aware, with the linked-file/URL fields (`bdsk-file-N`, `bdsk-url-N`)
  forced to the **end**.
- **Values are `{…}`-wrapped** (brace-delimited) consistently. The exception is
  a value built from `@string` macros or bare numbers, which stays unbraced so
  the macro reference survives.
- **Empty fields are dropped** — a field whose value you clear is removed
  entirely.
- **Unmatched braces in a value are escaped** — a stray `{` or `}` is written as
  `{\textbraceleft}` / `{\textbraceright}` and shown back to you as `{` / `}`
  (see [What survives a round trip](07-importing-and-exporting.md#741-what-survives-a-round-trip)).
- **Entry-type and keyword tokens are lower-cased** (`@Article` → `@article`).
- **TeXify-on-save** — text fields are converted to TeX where appropriate
  (accented and special characters become their TeX forms), so the file is
  portable through the LaTeX toolchain. URL, file, and note fields are *not*
  TeXified, so links survive intact.

> **Note:** Because of these normalisations, the *first* save of a file that was
> hand-formatted (or produced by a different tool) may show a large diff even
> though no content changed — the app is simply rewriting it into BibDesk's
> canonical layout. Subsequent saves are stable.

> **Note:** There is a hard guard: an entry with **98 or more fields** is
> rejected on write (this mirrors a BibDesk internal limit). You will never hit
> this in normal use.

### Saving and backups

Saving is **explicit by default** (there is no autosave unless you enable
**Preferences → General → Saving → Autosave**). Whether you save manually or
autosave does it for you, the write is the same. When you save:

1. The app checks whether the file **changed on disk** since it last read or
   wrote it — an edit in another program, a Git checkout, a cloud-sync client.
   If it did, the save stops and asks rather than silently overwriting the other
   version. See [Getting Started](01-getting-started.md).
2. The in-memory library is serialised to BibTeX text.
3. If the target file already exists, it is copied to **`<your-file>.bib.bak`**
   (a single rolling backup of the *previous* version).
4. The new text is written to a temporary file in the same folder, which is then
   **renamed over** the target. This rename is atomic on a normal filesystem, so
   the file is never left half-written even if the machine loses power
   mid-save.

The **•** beside the library name in the window header is your unsaved-changes
indicator; it reads *(saving…)* during the write and disappears once the file is
on disk. See [Getting Started → The header](01-getting-started.md#141-the-header).

> **Note:** The change-on-disk check is a size-and-timestamp comparison, not a
> content hash. It is deliberately biased towards silence: it can miss an
> external edit in a rare corner case, but it will not cry wolf over a file
> nobody touched. **Save As…** to a new path is not checked — the system save
> dialog already asks before it replaces a file.

## Where data is stored

Use this table to reason about portability, backups, and what travels with the
file.

| Data | Where it lives | Travels with the `.bib`? |
| --- | --- | --- |
| Entries (type, cite key, fields) | The `.bib` file | Yes |
| Static/Smart/URL/Script groups | Group `@comment` blocks in the file | Yes |
| `@string` macros | `@string{…}` lines in the file | Yes |
| Per-entry **notes** | Encoded in `Bdsk-Annotation` by default (or `Annote` in *Readable* mode) — see [Notes & Abstracts](05-notes-and-abstracts.md#how-the-fields-are-stored) | Yes |
| **Abstracts** | The `Abstract` field — plain by default, or brace-safe-escaped there, or a compressed `Bdsk-Abstract` blob, per **Preferences → Files → Abstract storage** | Yes |
| **Keywords** (the tag categories) | The `Keywords` field | Yes |
| **Colour labels** | The `Bdsk-Color` field (a palette index) | Yes |
| File **attachments** | `Bdsk-File-N` fields (relative path + a macOS bookmark) | Yes (move the files too — see [Attachments](04-attachments.md)) |
| Document window/display state | The `@bibdesk_info` block | Yes |
| **Preferences** (everything in the [Preferences](#preferences) pane) | A `settings.json` file in the per-user application-data folder | **No** — a per-installation preference |
| Installed **CSL styles** | A `csl-styles` folder beside `settings.json` | **No** |
| Your **scripts** | A `scripts` folder beside `settings.json` (**Tools → Scripts → Open Scripts Folder**) | **No** |
| Extracted **PDF text** (the full-text index) | A `pdf-index.db` SQLite file beside `settings.json`, keyed by each PDF's path | **No** — a rebuildable cache |
| **OCR** backups of pre-OCR PDFs | An `OCR Backups` folder beside `settings.json` | **No** |
| **Read** / **Rating** | The `Read` / `Rating` fields | Yes |
| **Search/filter** state | In memory only; nothing persisted | n/a |

> **Note:** Search uses **two** SQLite FTS5 indexes: your **field text** in
> memory, rebuilt each time a library opens, and the text extracted from your
> **attached PDFs** persisted to `pdf-index.db`, keyed by each file's path. Both
> are caches — the `.bib` file remains the source of truth, and deleting
> `pdf-index.db` only costs you a re-scan. PDFs are only extracted and indexed
> while the **PDF** toggle beside the search box is on; how much of each PDF is
> scanned is **Preferences → General → Full-text search**. Why the two are split
> this way is explained in
> [Performance notes for large libraries](02-browsing-and-searching.md#27-performance-notes-for-large-libraries).
> If the native search component isn't active for a build, the search box falls
> back to a client-side substring filter.

## Field reference

The app stores fields as raw BibTeX text and shows nearly all of them generically
in the editor. A few fields, however, get **special treatment** in display,
search, or citation. Knowing which is which helps you predict how an entry will
appear.

| Field(s) | Treated as | Notes |
| --- | --- | --- |
| `Author` | Person list | Parsed into individual people (BibTeX `Family, Given` / `Given Family`, `and`-separated; `and others` → "et al."). Drives the **Authors** column, the preview, the dynamic **Author** category groups, and citations. |
| `Editor` | Person list | Same parsing as `Author`; used for the display/authors line and citations when there is no author. |
| `Title` | Display text | De-TeXified for display; case-protection braces (`{C}alabi-{Y}au`) are stripped for the table and preview but kept on disk. `$…$` math is preserved and typeset. |
| `Journal`, `Booktitle` | Venue | Shown as the venue in the preview/results; mapped to CSL `container-title` for citations. |
| `Volume`, `Number`, `Pages` | Bibliographic detail | Shown in the preview venue line and used in citations. `Pages` uses BibTeX en-dash form (`120--135`). |
| `Year` | Date | The **Year** column and the citation date. |
| `Doi` | Remote link | Shown as a clickable **DOI** chip; bare DOIs are rewritten to `https://doi.org/…` when opened. Not TeXified. |
| `Url` | Remote link | Shown as a clickable **URL** chip; opens in your browser. Not TeXified. Only `http`/`https`/`mailto` schemes are honoured. |
| `Local-Url`, `Local-File`, `File` | Local link | Treated as a local file attachment in the detail pane (opens in the OS default app). Not TeXified. |
| `Bdsk-File-N` | Managed attachment | The app's own attachment links; shown in the **Attachments** section, hidden from the generic field list. |
| `Keywords` | Tag list | Split on `,`/`;` into pills in the preview, the dynamic **Keyword** category groups, and the 🔑 keyword column. |
| `Read` | Tri-state flag | Drives the **Read** icon column (read / unread / unset) and a checkbox in the editor. `yes`, `true`, `1` or `on` means read; any *other* non-empty value means explicitly unread; absent or empty means unset. |
| `Rating` | 0–5 number | Drives the optional **Rating** star column and a clickable star widget in the editor. Values outside 0–5 are clamped for display. |
| `Abstract` | Markdown | Rendered as Markdown (with math) in the preview card. Stored plain by default; **Preferences → Files → Abstract storage** can instead brace-escape it in place or move it to a compressed `Bdsk-Abstract` blob. Whichever is on disk, the editor shows one decoded **Abstract** row. |
| `Bdsk-Abstract` | Encoded abstract | The compressed abstract blob written by the *Compressed* storage mode; decoded transparently on read and hidden from the generic field list. |
| `Bdsk-Color` | Colour label | Holds the palette index set by **Publication → Color Label** and the row context menu. Hidden from the generic field list — set it from the palette, not as a raw field. |
| `Annote` | Markdown notes | Edited/rendered in the **Notes** section (with `[[citeKey]]` links and safe iframes); hidden from the generic field list. Holds the notes only in *Readable* storage mode — by default they live in `Bdsk-Annotation` instead. Drives the optional **Annotation** indicator column (a 📄 icon when the entry has an annotation). |
| `Bdsk-Annotation` | Encoded notes (default) | The lz-string-compressed, base64-encoded annotation written by the default *Compressed* storage mode (brace-safe; keeps `Annote` clean). Decoded transparently on read. See [Notes & Abstracts](05-notes-and-abstracts.md#how-the-fields-are-stored). |
| `Crossref` | Inheritance link | Names a parent entry's cite key; the child inherits the parent's fields (shown **(inherited)**). Editing an inherited value creates a local override. |

Everything else (`Publisher`, `Address`, `Edition`, `Series`, `ISBN`, `Note`,
custom fields, …) is stored and shown verbatim with no special handling.

> **Tip:** Text fields are edited as **raw BibTeX** (the exceptions — keywords,
> rating, boolean and tri-state fields — get purpose-built widgets). If you want
> braces, a `@string` macro reference, or TeX accents in the stored value, type
> them exactly as you want them written to the file. See
> [Editing Entries → Editing fields](03-editing-entries.md#editing-fields).

## Citations

The detail pane renders a live, formatted citation for the selected entry using
**CSL** (the Citation Style Language) via the **citeproc-js** engine, entirely
offline — no network call is made to format a citation.

- Pick a style from the dropdown: **APA**, **Vancouver**, or **Harvard**, plus
  any `.csl` style you have installed yourself. Set the one you start in under
  **Preferences → Citations → Default style**.
- The citation **updates as you edit** the entry's fields, so it always reflects
  the current data.
- It's meant for copying a properly formatted reference into an email, a
  document, or a reading list — use **Edit → Copy Citation** to put it on the
  clipboard as plain text, **Edit → Copy Citation as RTF** (⌥⌘R) to keep the
  italics, or **Edit → Copy as BibTeX** for the raw source.

Behind the scenes the app maps each entry to CSL-JSON (entry type → CSL type;
parsed authors/editors → CSL name objects; `Pages` en-dashes normalised; `Doi`,
`Url`, `Abstract`, and the venue carried across). Only the three styles above are
bundled. See [Preview & Citations](06-preview-and-citations.md).

## Preferences

Open **Preferences** with **⌘,** / **Ctrl+,** (the item is in the **Bibliofile**
menu on macOS, the **File** menu on Windows/Linux). All settings are saved in a
`settings.json` file in the per-user application-data folder, so they apply to
every library and persist across sessions — none of them is written into your
`.bib`. Changes take effect immediately; there is no OK/Apply button.

The pane has a left rail of nine sections. Below, **Section** is the rail entry
and **Group** the heading you will find it under.

| Section | Group → Setting | Default | What it controls |
| --- | --- | --- | --- |
| **General** | Appearance → Language | **System default** | The UI language; untranslated text falls back to English |
| **General** | Appearance → Theme | **System** | Light/Dark/System (System follows the OS) |
| **General** | Saving → Autosave | **off** | When on, saves automatically a moment after each edit |
| **General** | Full-text search → PDF pages to index | **At most 40** | How much of each PDF is scanned for the full-text index. **All** suits scanned books; the cap keeps indexing fast for articles. Changing it invalidates the stored text, so open libraries are re-indexed — but only while full-text search is on |
| **Display** | Columns (list + add/remove/reorder) | Cite Key, Type, Authors, Title, Year, Keywords, Attachments, Read | The table columns and their order (see [Browsing & Searching](02-browsing-and-searching.md#226-configuring-the-columns)) |
| **Citations** | Citations → Default style | **APA** | The CSL style used by the citation block, printing and RTF copy |
| **Citations** | Citations → Inline citation style | *(same as default)* | The style used to render `\cite{…}` commands inside notes |
| **Citations** | Citations → Link URLs & DOIs | **on** | Makes URLs and DOIs inside a formatted citation clickable |
| **Citations** | Citations → Contact email | *(empty)* | Sent to Unpaywall (which requires one) and Crossref when using [Find Open-Access PDFs](04-attachments.md#finding-open-access-pdfs) |
| **Citations** | Citation styles → Install CSL file… | (three bundled) | Add or remove your own `.csl` styles |
| **Citations** | Cite command (TeX) → Drag / Copy cite | `\cite{%K}` | The template used by drag-out and **Copy \cite{…}**; `%K` = the cite key(s) |
| **Citations** | LaTeX preview → BibTeX style (.bst) / TeX bin directory | `plain` / *(empty)* | Which `.bst` the [LaTeX preview](10-panels.md#latex-preview) typesets with, and where to find `pdflatex`/`bibtex` when they are not on `PATH` |
| **Cite keys** | Cite keys → Format | `%p[/][/etal1]2:%Y%u0` | The format **Generate Cite Key** uses: `Surname:Year` for one author, `Surname1/Surname2:Year` for two, `Surname1/etal:Year` for three or more, with a disambiguating letter only on a clash |
| **Files** | AutoFile → Papers folder | *(empty)* | Where [AutoFile](04-attachments.md#autofile-organising-linked-files) moves attachments (AutoFile is off until this is set) |
| **Files** | AutoFile → File name | `%p1/%T5` | The file-name format AutoFile applies (first author/editor folder, then the title's first words) |
| **Files** | AutoFile → AutoFile attachments when added | **off** | When on (and a Papers folder is set), files an attachment as soon as it's added |
| **Files** | Annotation storage → Write notes as | **Compressed** | Compressed `Bdsk-Annotation` blob, or readable `Annote` (see [Notes & Abstracts](05-notes-and-abstracts.md#how-the-fields-are-stored)) |
| **Files** | Abstract storage → Write abstracts as | **Plain text** | Plain, brace-safe *Readable*, or *Compressed* `Bdsk-Abstract` |
| **Fields** | New entries → Default type | `article` | The entry type the **New** button/command creates |
| **Fields** | Entry types | (15 standard types) | Define your own entry types with their required/optional fields; the standard types are read-only |
| **Fields** | Field types → Person / Remote URL / Local file / Rating / Boolean / Tri-state / Citation fields | (sensible defaults) | Which field names the app treats specially — which are people, which are links, which is the `Rating` field, which is the `Read` boolean |
| **Templates** | Export templates | *(none)* | Named Handlebars bodies that become **File → Export** entries. See [Customizing Panels](11-customizing-panels.md#1111-customizing-outputs) |
| **Panels** | Detail pane / Bottom panel templates | *(built-in default)* | Named forks of the panel templates, with a live preview. See [Customizing Panels](11-customizing-panels.md) |
| **Claude Assistant** | Model | `claude-opus-4-8` | The Anthropic model id the 🤖 assistant talks to |

> **Note:** The search box's **PDF** toggle — whether full-text search covers
> your PDFs at all, and therefore whether they are indexed — lives beside the
> search box, not in Preferences. Preferences only controls *how much* of each
> PDF is scanned.

## Automation: the `x-bibdesk://` URL scheme

Besides the [Script Console](12-scripting.md), the app registers a URL scheme so
other programs can drive it: AppleScript (`open location "x-bibdesk://…"`), a
shell script (`open` on macOS, `xdg-open` on Linux), a Shortcut, a text editor's
"run command" hook. It covers fire-and-forget *commands* only — a URL cannot ask
the app a question and get an answer back.

| URL | What it does |
| --- | --- |
| `x-bibdesk://open?file=<absolute path>` | Open a `.bib` file |
| `x-bibdesk://import?doi=<doi>` | Look the DOI up online and add the result to the front library |
| `x-bibdesk://import?bibtex=<url-encoded BibTeX>` | Add the given BibTeX entries to the front library |
| `x-bibdesk://new?type=<type>&<Field>=<value>&…` | Create an entry in the front library from the given fields |

Two rules keep this from being a hole in your library, because *anything* can
emit one of these URLs — including a web page you merely visited:

- **Every one of these asks first.** A dialog names what is about to happen
  ("Add entries to *library.bib* from an external link?") and says the request
  came from outside the app. **Cancel** is the default, so pressing Return or
  Escape declines. Nothing happens until you click **Allow**.
- **`open?file=` accepts `.bib` paths only.** Any other path is refused outright,
  before the prompt — an unrestricted "open this file" would let a web page use
  the app to find out which files exist on your disk.

`import` and `new` act on the **front library**, so they do nothing if no library
is open. Unknown commands are ignored.

## Limitations / not-yet

In the interest of honesty, here is what is **incomplete, deferred, or
platform-specific** in the current build. None of these affect the integrity of
your `.bib` file; they're missing conveniences, not data hazards.

- **Undo is per-document.** Library edits apply immediately to the in-memory
  model but are **undoable**: **Edit → Undo** / **Redo** (⌘Z / ⇧⌘Z) step them
  back and forth (a batch edit or a multi-row delete is one step; see
  [Undo and redo](03-editing-entries.md#undo-and-redo)). Beyond that,
  your safety net is explicit save plus the `.bib.bak` backup and **File → Revert
  to Saved**, which reloads the last saved version from disk.
- **Autosave is opt-in.** Saving is explicit by default (⌘S / Ctrl+S); unsaved
  imports and edits are lost if you quit without saving (the app does prompt).
  You can turn on **Preferences → General → Saving → Autosave** to have the app
  save for you after each edit.
- **Text fields are edited as raw text.** Keywords, rating, boolean and
  tri-state fields have purpose-built widgets, but every *other* field is edited
  as its literal BibTeX string (with autocomplete from existing values) — there
  are still no dedicated **person** or **date** field editors, so authors are
  typed as `Family, Given and Family, Given`. The **Read** and **Rating** icon
  *columns* show their fields but aren't click-to-toggle; use the editor's
  checkbox and stars instead. Macros are edited in the **@string…** modal; the
  field editor stores literal strings, not macro/complex values.
- **Some commands still act on one entry only.** The whole selection is used by
  **Delete**, **Generate Cite Key**, **AutoFile Linked Files**, **Find
  Open-Access PDFs…**, **OCR Scanned PDFs…**, **Color Label**, **Export →
  Selected Entries**, **Copy As → RIS / Minimal BibTeX / LaTeX \bibitem**, and a
  drag-out (which produces `\cite{key1,key2}`). But **Copy Cite Key**, **Copy
  \cite{…}**, **Copy Citation**, **Copy Citation as RTF**, **Copy as BibTeX**
  and **Duplicate** still take the single focused entry even when several rows
  are highlighted.
- **Moved-attachment recovery is one-way.** macOS BibDesk stores an Apple
  "bookmark" beside each attachment that can re-find a file after it's moved or
  renamed. On macOS this app now **writes** those bookmarks too (and
  **Consolidate Linked Files…** backfills them into older libraries), so a
  library edited here keeps that recovery ability *in BibDesk*. It does not yet
  **use** them itself: this app resolves attachments only by their stored
  **relative path**, so a file that has been moved may not open here until you
  fix the path, [AutoFile](04-attachments.md#autofile-organising-linked-files)
  it, or re-add it. Off macOS, bookmarks are neither written nor read (existing
  ones are preserved untouched). See
  [Attachments](04-attachments.md#compatibility-with-macos-bibdesk).
- **URL and Script groups are not evaluated.** Static and Smart groups (and
  nestable folders) are fully editable in the app — create, rename, delete, and
  build Smart-group conditions in the sidebar. **URL** and **Script** groups,
  however, are only preserved on disk: they appear in the sidebar but have no live
  membership (URL groups don't fetch; Script groups don't execute). (These
  BibDesk *Script group* definitions are unrelated to
  [Scripting with JavaScript](12-scripting.md), which is fully supported.)
- **Citation styles are added by file.** Three styles ship built in (APA,
  Vancouver, Harvard); you can install any other by adding its **CSL** (`.csl`)
  file in **Preferences → Citations**, but there is no in-app browser of the CSL
  style repository — you download the file yourself. See
  [Preview & Citations](06-preview-and-citations.md#installing--managing-your-own-styles).
- **Full-text search needs the native component.** Search uses SQLite FTS5 —
  field text in memory, PDF text on disk. Both rely on a native module that must
  be built for the app's runtime; if a build doesn't include it, search silently
  falls back to a substring filter over the visible columns. Developers enable it
  with `pnpm --filter @bibdesk/app rebuild:electron`.
- **Find Duplicates merges into the primary entry.** It groups likely duplicates
  and can **merge** a group into its **first** entry — that entry keeps its own
  values, gains any field it was missing, unions the keywords, adopts the other
  entries' attachments, and the rest are deleted. You cannot nominate a different
  entry as the keeper, and it does not auto-resolve every group: you confirm each
  merge.

## Glossary

**`.bib` / BibTeX file**
The plain-text database format the app reads and writes. The single source of
truth for your library.

**Cite key**
The short, unique identifier for an entry (e.g. `einstein1935`) — what you cite
in a document and what `[[…]]` note links and `Crossref` point at. The app can
**Generate** one from author + year and guarantees uniqueness.

**Complex string / macro**
A field value built (in whole or part) from `@string` abbreviations, optionally
concatenated with `#`. Macros are reusable tokens — define a short name once and
reference it from many entries. Edited in the **@string…** modal.

**Crossref (inheritance)**
A BibTeX mechanism where one entry names another by cite key in its `Crossref`
field and inherits the parent's fields. Useful when several chapters share one
book's publisher and year. Inherited fields show an **(inherited)** badge;
editing one creates a local override on the child.

**FTS (full-text search)**
Indexed search over the *full* text of records and the text of attached PDFs, as
opposed to a simple substring scan. The app uses SQLite's **FTS5** engine over
two rebuildable indexes: your **field text** in memory, rebuilt each time a
library opens, and the text extracted from your **PDFs** persisted on disk
(`pdf-index.db`) and keyed by file path, so a big library is scanned once rather
than on every launch. A substring filter is the fallback when the native
component isn't active.

**CSL (Citation Style Language)**
The XML standard that describes how to format a citation in a given style. The
app uses the **citeproc-js** engine with bundled APA/Vancouver/Harvard styles —
plus any `.csl` file you install yourself — to render the formatted citation in
the detail pane.

**Bdsk-File**
A BibDesk file attachment, stored in the `.bib` as a `Bdsk-File-N` field holding
a base64 binary-plist with the file's relative path and, on macOS, an Apple
bookmark blob. This app writes the bookmark on macOS and preserves any it finds
elsewhere; it resolves attachments by the relative path.

## Troubleshooting

**A change didn't stick.**
Editing is explicit-save by default. If a **•** follows the library name in the
window header, your edits are still only in memory — press **⌘S** / **Ctrl+S** to
write them. (Turn on **Preferences → General → Saving → Autosave** to have this
done for you.)

**Saving stopped to warn me the file changed on disk.**
Something outside the app wrote to your `.bib` since it was opened — another
editor, a Git checkout, a sync client. Choose **Overwrite** to keep what is in
the window, **Reload from Disk** to throw away your in-app edits and re-read the
file, or **Cancel** to think about it. Cancel is the default. See
[Getting Started](01-getting-started.md).

**An attachment won't open.**
The file has probably been **moved, renamed, or deleted**, or it's referenced by
a relative path that no longer resolves from the library's folder. This app finds
attachments by that stored relative path only — it does not (yet) follow the
macOS bookmark that would survive a rename. Put the file back where the relative
path expects it, use **Find Broken Links…** to point it at the new location, or
re-add the attachment. See [Attachments](04-attachments.md).

**An `x-bibdesk://` link did nothing.**
Either you declined the confirmation dialog (Cancel is its default, so Return or
Escape declines), or the request was refused: `open?file=` only accepts `.bib`
paths, and `import`/`new` need a library already open. See
[Automation](#automation-the-x-bibdesk-url-scheme).

**My file looks heavily reformatted after the first save.**
That's the canonical normalisation pass (lower-cased field names, sorted fields,
`{…}`-wrapping, TeXify). No content was lost; subsequent saves are stable. See
[Normalisations applied on save](#normalisations-applied-on-save).

**Online search fails.**
Almost always a **connectivity** issue — check your internet connection (and any
proxy/VPN/firewall) and retry. See
[Online Search → Troubleshooting](08-online-search.md#troubleshooting).

**The theme (or another preference) reset on another machine.**
Preferences — including the light/dark theme — are stored per installation in a
`settings.json` file, not in the `.bib` file, so they don't travel with your
library. Set them again on the new machine. (If your theme is set to **System**,
it follows that machine's OS appearance.)

**A DOI or URL chip didn't open.**
Only `http`, `https`, and `mailto` links are honoured (a bare DOI is rewritten
to `https://doi.org/…`). A `Url` value with an unsupported scheme won't open;
fix the value in the editor.

## See also

- [Getting Started](01-getting-started.md) — the window at a glance.
- [Editing Entries](03-editing-entries.md) — fields, cite keys, types, macros,
  Find & Replace, the copy commands, and saving.
- [Attachments](04-attachments.md) — `Bdsk-File` storage, opening in default apps, and
  AutoFile.
- [Importing & Exporting](07-importing-and-exporting.md) — paste, drag-and-drop,
  import, and export.
- [Online Search](08-online-search.md) — importing new entries.
- [Preview & Citations](06-preview-and-citations.md) — the CSL citation block.
- [Scripting with JavaScript](12-scripting.md) — the other automation surface,
  for anything the `x-bibdesk://` commands above can't express.
