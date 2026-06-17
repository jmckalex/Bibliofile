# Shortcuts & Reference

This is the reference chapter: the complete menu bar, the keyboard shortcuts and
mouse actions, the Preferences, an explanation of the on-disk file format and
exactly how the app preserves and normalises it, a map of where every kind of
data is stored, a reference for the BibTeX fields the app treats specially, notes
on citations, an honest account of current limitations, a glossary, and general
troubleshooting.

Use it as a lookup. The earlier chapters teach the workflows; this one nails
down the details.

## The menu bar

Every command lives in the application menu bar — on macOS in the system menu bar
at the top of the screen; on Windows and Linux attached to the window. The
toolbar duplicates a few of the most common commands, but the menus are the full
inventory. Items marked *(needs an open library)* are greyed out until a `.bib`
file is open.

### BibDesk menu (macOS only)

On Windows and Linux these items live elsewhere: **Preferences…** moves to the
**File** menu, and Quit is the standard window/system command.

| Item | Shortcut | What it does |
| --- | --- | --- |
| About BibDesk | — | Standard about box |
| Preferences… | ⌘, | Open [Preferences](#preferences) |
| Services / Hide / Quit | platform defaults | Standard macOS application roles |

### File menu

| Item | macOS | Win/Linux | What it does |
| --- | --- | --- | --- |
| New Publication | ⌘N | Ctrl+N | Add a new entry *(needs an open library)* |
| Open… | ⌘O | Ctrl+O | Open a `.bib` file |
| Open Recent | — | — | Re-open a recently used library |
| Save | ⌘S | Ctrl+S | Write changes to disk *(needs an open library)* |
| Save As… | ⇧⌘S | Shift+Ctrl+S | Save the library under a new name and keep editing it there *(needs an open library)* |
| Revert to Saved | — | — | Discard unsaved changes and reload the last saved version *(needs an open library)* |
| Show in Finder / Show in File Manager | — | — | Reveal the open `.bib` file in your file manager *(needs an open library)* |
| Import → From File (BibTeX / RIS / EndNote)… | ⇧⌘I | Shift+Ctrl+I | Import `.bib`/`.ris`/EndNote `.enw`/`.enl`/`.xml` files (see [Importing & Exporting](07-importing-and-exporting.md)) *(needs an open library)* |
| Import → Search Online (CrossRef / arXiv)… | ⇧⌘O | Shift+Ctrl+O | Open [online search](08-online-search.md) *(needs an open library)* |
| Export → BibTeX… / RIS… / CSV… / HTML… | — | — | Export the whole library to that format *(needs an open library)* |
| Export → Selected Entries (BibTeX)… | — | — | Export only the highlighted entries to a `.bib` file *(needs a selection)* |
| Print… | ⌘P | Ctrl+P | Print (or Save as PDF) a CSL-formatted bibliography of the selection or current group *(needs an open library)* |

### Edit menu

The first block (Undo, Redo, Cut, Copy, Paste, Paste and Match Style, Delete,
Select All) are the standard platform editing roles with their usual system
shortcuts; they apply to text fields. The app-specific commands are:

| Item | macOS | Win/Linux | What it does |
| --- | --- | --- | --- |
| Paste Publication | ⇧⌘V | Shift+Ctrl+V | Import BibTeX from the clipboard as new entries *(needs an open library)* |
| Find… | ⌘F | Ctrl+F | Focus the search box *(needs an open library)* |
| Find & Replace… | ⌥⌘F | Alt+Ctrl+F | Open [Find & Replace](03-editing-entries.md#find--replace) across field values *(needs an open library)* |
| Copy Cite Key | ⌥⌘K | Alt+Ctrl+K | Copy the selected entry's bare cite key *(needs an open library)* |
| Copy Citation | — | — | Copy the formatted CSL citation as text *(needs an open library)* |
| Copy as BibTeX | ⌥⌘B | Alt+Ctrl+B | Copy the selected entry's BibTeX source *(needs an open library)* |
| Copy \cite{…} | ⌥⌘C | Alt+Ctrl+C | Copy a `\cite{…}` command using your cite-command template *(needs an open library)* |

### Publication menu

Every item needs an open library.

| Item | macOS | Win/Linux | What it does |
| --- | --- | --- | --- |
| New Publication | ⌘N | Ctrl+N | Add a new entry |
| Edit Publication… | ⌘E | Ctrl+E | Open the selected entry in a separate editor window (also: ✎ Edit… / double-click a row) |
| Duplicate | ⇧⌘D | Shift+Ctrl+D | Copy the selected entry under a new cite key |
| Delete Publication | — | — | Delete the selected entry |
| Generate Cite Key | ⌘K | Ctrl+K | Generate a cite key for the selected entry |
| Find Duplicates… | — | — | Open [Find Duplicates](02-browsing-and-searching.md#26-finding-duplicates) |
| Add File Attachment… | — | — | Attach a file to the selected entry |
| AutoFile Linked Files | — | — | [AutoFile](04-attachments.md#autofile-organising-linked-files) the selected entry's attachments |
| Find Broken Links… | — | — | Find attachments whose files are [missing on disk](04-attachments.md#finding-and-repairing-broken-links) and repair them |
| Macros (@string)… | — | — | Open the `@string` macro editor |

### View menu

| Item | macOS | Win/Linux | What it does |
| --- | --- | --- | --- |
| Columns → (submenu of checkboxes) | — | — | Show/hide table columns (see [Configuring the columns](02-browsing-and-searching.md#226-configuring-the-columns)) |
| Toggle Light / Dark Theme | ⌘⇧L | Ctrl+Shift+L | Switch between light and dark appearance |
| Actual Size / Zoom In / Zoom Out | ⌘0 / ⌘+ / ⌘− | Ctrl+0 / Ctrl+ / Ctrl− | Standard zoom roles |
| Toggle Full Screen / Reload / Toggle Developer Tools | platform defaults | platform defaults | Standard window roles |

### Window and Help menus

The **Window** menu holds the standard Minimize/Zoom/Close roles. The **Help**
menu's **BibDesk Help** item (F1 on Windows/Linux) opens this manual in its own
window.

## Keyboard shortcuts (quick list)

The app-specific accelerators, gathered in one place (macOS first; on Windows and
Linux ⌘ is Ctrl, ⌥ is Alt):

| Shortcut | Command |
| --- | --- |
| ⌘O | Open… |
| ⌘N | New Publication |
| ⌘S | Save |
| ⇧⌘S | Save As… |
| ⇧⌘I | Import → From File (BibTeX / RIS)… |
| ⇧⌘O | Import → Search Online… |
| ⇧⌘V | Paste Publication |
| ⌘F | Find (focus search) |
| ⌥⌘F | Find & Replace… |
| ⌥⌘K | Copy Cite Key |
| ⌥⌘B | Copy as BibTeX |
| ⌥⌘C | Copy \cite{…} |
| ⇧⌘D | Duplicate |
| ⌘K | Generate Cite Key |
| ⌘⇧L | Toggle Light / Dark Theme |
| ⌘, | Preferences… |
| Enter | Commit a single-line field edit / the cite key / the *New field* row; run an online search; run a Find preview |

> **Note:** **Save** also works from anywhere in the window, including while the
> focus is in a field. The standard Edit/View/Window roles (cut, copy, paste,
> zoom, minimize, and so on) keep their usual platform shortcuts.

### Mouse and click actions

Plenty of behaviour is driven by the pointer rather than the keyboard. The
useful ones:

| Action | How |
| --- | --- |
| **Select an entry** | Click its row in the publications table; the detail pane updates |
| **Sort the table** | Click a **column header**; click the same header again to flip ascending/descending (a ▲/▼ marks the active column) |
| **Drag out a citation** | Drag a row into a TeX editor (or any text field) to insert a `\cite{…}` |
| **Filter by group** | Click a group in the left sidebar (Library, a Static/Smart group, or an Author/Keyword category) |
| **Clear the group filter** | Click **📚 Library** |
| **Filter by text** | Type in the **search box** at the top-right (full-text search; substring fallback) |
| **Edit a field** | Click its value, type, then press **Enter** (long values open a multi-line box — click away to commit); pick from the autocomplete list |
| **Add a field** | Fill the **New field** row and press **Enter** or click **+** |
| **Remove a field** | Click the **×** at the end of its row (or clear the value and commit) |
| **Switch theme** | Click the **☾ / ☀** toggle in the header (light ⇄ dark) |
| **Open a link / file** | Click a DOI/URL chip or an attachment (PDFs open in the in-app preview) |
| **Jump to a cross-referenced note** | Click a `[[citeKey]]` link inside a rendered note |
| **Import by drag-and-drop** | Drag `.bib`/`.ris`/PDF/other files onto the window |

Cross-references for these: sorting, filtering, and columns are covered in
[Browsing & Searching](02-browsing-and-searching.md); field editing and the copy
commands in [Editing Entries](03-editing-entries.md); importing and exporting in
[Importing & Exporting](07-importing-and-exporting.md); links and `[[citeKey]]`
notes in [Notes & Abstracts](05-notes-and-abstracts.md) and
[Preview & Citations](06-preview-and-citations.md).

## File format & fidelity

Your library is a **standard `.bib` (BibTeX) text file**, and it is the **single
source of truth**. There is no separate database, no hidden index file, no
sidecar metadata folder — everything the app knows about your library it reads
from, and writes back to, that one plain-text file. You can open it in any text
editor, version-control it with Git, and use it directly with LaTeX.

### Preserved BibDesk extensions

BibDesk stores a handful of things inside the `.bib` file using BibTeX comment
and string mechanisms, so that the file remains valid BibTeX while carrying
extra structure. The app reads, preserves, and rewrites all of them, so a
library round-trips faithfully — you can move it between this app and the
original macOS BibDesk without anything being mangled:

- **`@string` macros** — reusable abbreviations (for instance a short token that
  expands to a full journal name). Editable via the **@string…** toolbar
  button.
- **`@preamble`** — a LaTeX preamble block, preserved verbatim.
- **Group blocks** — saved **Static**, **Smart**, **URL**, and **Script**
  groups, stored as specially structured `@comment` blocks. (Static and Smart
  groups filter the table in this app; URL and Script groups are *preserved on
  disk* but are not evaluated here — see
  [Limitations](#limitations--not-yet).)
- **`@bibdesk_info`** — BibDesk's document-info block (window/display state and
  similar), preserved verbatim.
- **`Bdsk-File-N` attachments** — file attachments encoded as numbered,
  base64 binary-plist blobs holding a relative path (and, for files created in
  macOS BibDesk, an opaque macOS bookmark that the app preserves untouched). See
  [Attachments](04-attachments.md).

### Normalisations applied on save

The serializer reproduces BibDesk's own on-disk formatting rules, which means a
freshly saved file is *tidied* into a canonical shape rather than written back
byte-for-byte as you typed it. Expect these normalisations every time you save:

- **Field names are lower-cased** (`Author` → `author`, `Doi` → `doi`). This is
  cosmetic — BibTeX field names are case-insensitive.
- **Fields are sorted** within each entry, case-insensitively and
  numeric-aware, with the linked-file/URL fields (`bdsk-file-N`, `bdsk-url-N`)
  forced to the **end**.
- **Values are `{…}`-wrapped** (brace-delimited) consistently.
- **Empty fields are dropped** — a field whose value you clear is removed
  entirely.
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
**Preferences → Saving → Autosave**). Whether you save manually or autosave does
it for you, the write is the same. When you save:

1. The in-memory library is serialised to BibTeX text.
2. If the target file already exists, it is copied to **`<your-file>.bib.bak`**
   (a single rolling backup of the *previous* version).
3. The new text is written to a temporary file in the same folder, which is then
   **renamed over** the target. This rename is atomic on a normal filesystem, so
   the file is never left half-written even if the machine loses power
   mid-save.

The **Save** button shows an unsaved-changes indicator (a dot) whenever there
are pending edits, and reads **Saved** once the write completes.

## Where data is stored

Use this table to reason about portability, backups, and what travels with the
file.

| Data | Where it lives | Travels with the `.bib`? |
| --- | --- | --- |
| Entries (type, cite key, fields) | The `.bib` file | Yes |
| Static/Smart/URL/Script groups | Group `@comment` blocks in the file | Yes |
| `@string` macros | `@string{…}` lines in the file | Yes |
| Per-entry **notes** | The `Annote` field | Yes |
| **Abstracts** | The `Abstract` field | Yes |
| **Keywords** (the tag categories) | The `Keywords` field | Yes |
| File **attachments** | `Bdsk-File-N` fields (relative paths) | Yes (move the files too — see [Attachments](04-attachments.md)) |
| Document window/display state | The `@bibdesk_info` block | Yes |
| **Preferences** (theme, default style, cite-key & cite-command formats, columns, Papers folder, AutoFile format, autosave, default entry type, field-type overrides) | A `settings.json` file in the per-user application-data folder | **No** — a per-installation preference |
| **Read** / **Rating** | The `Read` / `Rating` fields | Yes |
| **Search/filter** state | In memory only; nothing persisted | n/a |

> **Note:** Full-text search uses an **in-memory SQLite FTS5 index** built when a
> library opens (field text + extracted attached-PDF text). It is a rebuildable
> cache — nothing is written to disk and the `.bib` file remains the source of
> truth. If the native search component isn't active for a build, the search box
> falls back to a client-side substring filter over the visible columns.

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
| `Read` | Tri-state flag | Drives the **Read** icon column (read / unread / unset). A value such as `1` or `yes` means read; `0` or `no` means explicitly unread. |
| `Rating` | 0–5 number | Drives the optional **Rating** star column. |
| `Abstract` | Markdown | Rendered as Markdown (with math) in the preview card. |
| `Annote` | Markdown notes | Edited/rendered in the **Notes** section (with `[[citeKey]]` links and safe iframes); hidden from the generic field list. |
| `Crossref` | Inheritance link | Names a parent entry's cite key; the child inherits the parent's fields (shown **(inherited)**). Editing an inherited value creates a local override. |

Everything else (`Publisher`, `Address`, `Edition`, `Series`, `ISBN`, `Note`,
custom fields, …) is stored and shown verbatim with no special handling.

> **Tip:** Field editing is **raw BibTeX**. If you want braces, a `@string`
> macro reference, or TeX accents in the stored value, type them exactly as you
> want them written to the file. See
> [Editing Entries → Editing fields](03-editing-entries.md#editing-fields).

## Citations

The detail pane renders a live, formatted citation for the selected entry using
**CSL** (the Citation Style Language) via the **citeproc-js** engine, entirely
offline — no network call is made to format a citation.

- Pick a style from the dropdown: **APA**, **Vancouver**, or **Harvard**. Set the
  one you start in under **Preferences → Citations → Default style**.
- The citation **updates as you edit** the entry's fields, so it always reflects
  the current data.
- It's meant for copying a properly formatted reference into an email, a
  document, or a reading list — use **Edit → Copy Citation** to put it on the
  clipboard, or **Edit → Copy as BibTeX** for the raw source.

Behind the scenes the app maps each entry to CSL-JSON (entry type → CSL type;
parsed authors/editors → CSL name objects; `Pages` en-dashes normalised; `Doi`,
`Url`, `Abstract`, and the venue carried across). Only the three styles above are
bundled. See [Preview & Citations](06-preview-and-citations.md).

## Preferences

Open **Preferences** with **⌘,** / **Ctrl+,** (the item is in the **BibDesk** menu
on macOS, the **File** menu on Windows/Linux). All settings are saved in a
`settings.json` file in the per-user application-data folder, so they apply to
every library and persist across sessions — none of them is written into your
`.bib`. The pane is organised into these sections:

| Section | Setting | Default | What it controls |
| --- | --- | --- | --- |
| **Appearance** | Theme | **System** | Light/Dark/System (System follows the OS) |
| **Citations** | Default style | **APA** | The CSL style the citation block starts in (APA / Vancouver / Harvard) |
| **Cite keys** | Format | `%a1:%Y%u2` | The format the **Generate** cite-key command uses |
| **Cite command (TeX)** | Drag / Copy cite | `\cite{%K}` | The template used by drag-out and **Copy \cite{…}**; `%K` = the cite key |
| **Columns** | (list + add/remove/reorder) | Cite Key, Type, Authors, Title, Year, Keywords, Attachments, Read | The table columns and their order (see [Browsing & Searching](02-browsing-and-searching.md#226-configuring-the-columns)) |
| **AutoFile** | Papers folder | *(empty)* | Where [AutoFile](04-attachments.md#autofile-organising-linked-files) moves attachments (AutoFile is off until this is set) |
| **AutoFile** | File name | `%a1/%Y%u0` | The file-name format AutoFile applies |
| **Saving** | Autosave | **off** | When on, saves automatically a moment after each edit |
| **New entries** | Default type | `article` | The entry type the **New** button/command creates |
| **Field types** | Person / Remote URL / Local file / Rating / Boolean / Tri-state / Citation fields | (sensible defaults) | Which field names the app treats specially — e.g. which fields are people, which are URLs, which is the `Rating` field, which is the `Read` boolean |

## Limitations / not-yet

In the interest of honesty, here is what is **incomplete, deferred, or
platform-specific** in the current build. None of these affect the integrity of
your `.bib` file; they're missing conveniences, not data hazards.

- **No undo stack.** Edits apply immediately to the in-memory model; there is no
  multi-step undo/redo. Your safety net is explicit save plus the `.bib.bak`
  backup, and **File → Revert to Saved** to reload the last saved version — so if
  you make a mess, reload (or fall back to the backup) instead of saving.
- **Autosave is opt-in.** Saving is explicit by default (⌘S / Ctrl+S); unsaved
  imports and edits are lost if you quit without saving. You can turn on
  **Preferences → Saving → Autosave** to have the app save for you after each
  edit.
- **Field editing is raw text only.** Every field is edited as its literal BibTeX
  string (with autocomplete from existing values); there are no dedicated person,
  date, rating, or boolean *field editors* yet, and the **Read**/**Rating** icon
  columns reflect their fields but aren't click-to-toggle. Macros are edited in
  the **@string…** modal; the field editor stores literal strings, not
  macro/complex values.
- **Multi-row selection is limited.** Most commands act on the single selected
  entry — a `\cite{…}` drag-out or copy produces one key at a time even though the
  template format supports `\cite{key1,key2}`.
- **Moved-attachment recovery is macOS-only and not yet wired up.** macOS
  BibDesk stores an Apple "bookmark" beside each attachment that can re-find a
  file after it's moved or renamed. This app **preserves** that bookmark
  untouched but resolves attachments only by their stored **relative path** —
  so a file that has been moved may not open until you fix the path,
  [AutoFile](04-attachments.md#autofile-organising-linked-files) it, or re-add
  it. See [Attachments](04-attachments.md#compatibility-with-macos-bibdesk).
- **URL and Script groups are not evaluated.** They are preserved on disk and
  appear in the sidebar, but in this app they have no live membership (URL
  groups don't fetch; Script groups don't execute), and there is no in-app
  editor for creating or editing groups (you manage group definitions in BibDesk
  or by hand).
- **Only three citation styles.** APA, Vancouver, and Harvard. There is no
  arbitrary-CSL import or style browser beyond those yet.
- **Full-text search needs the native component.** Search uses a SQLite FTS5
  index (field text + PDF text). It relies on a native module that must be built
  for the app's runtime; if a build doesn't include it, search silently falls back
  to a substring filter over the visible columns. Developers enable it with `pnpm
  --filter @bibdesk/app rebuild:electron`.
- **Find Duplicates is review-only.** It finds and navigates to duplicates but
  does not merge or delete them for you; clean them up by hand.
- **A scriptable plugin API** is on the roadmap but not in this build.

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
opposed to a simple substring scan. The app uses SQLite's **FTS5** engine over an
in-memory, rebuildable index, with a substring filter as a fallback when the
native component isn't active.

**CSL (Citation Style Language)**
The XML standard that describes how to format a citation in a given style. The
app uses the **citeproc-js** engine with bundled APA/Vancouver/Harvard styles to
render the formatted citation in the detail pane.

**Bdsk-File**
A BibDesk file attachment, stored in the `.bib` as a `Bdsk-File-N` field holding
a base64 binary-plist with the file's relative path (and a preserved macOS
bookmark for files made in macOS BibDesk).

## Troubleshooting

**A change didn't stick.**
Editing is explicit-save by default. If the **Save** button shows its
unsaved-changes dot, your edits are still only in memory — press **⌘S** /
**Ctrl+S** (or click **Save**) to write them. (Turn on **Preferences → Saving →
Autosave** to have this done for you.)

**An attachment won't open.**
The file has probably been **moved, renamed, or deleted**, or it's referenced by
a relative path that no longer resolves from the library's folder. Put the file
back where the relative path expects it, or re-add the attachment from its new
location. See [Attachments](04-attachments.md).

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
- [Attachments](04-attachments.md) — `Bdsk-File` storage, the PDF preview, and
  AutoFile.
- [Importing & Exporting](07-importing-and-exporting.md) — paste, drag-and-drop,
  import, and export.
- [Online Search](08-online-search.md) — importing new entries.
- [Preview & Citations](06-preview-and-citations.md) — the CSL citation block.
