# Importing & Exporting

A bibliography manager is only as useful as the references you can get *into* it
and the formats you can get back *out*. Bibliofile has grown a full set of
get-references-in and get-references-out paths that sit alongside the in-app
[Online search](08-online-search.md): you can **paste** BibTeX straight from the
clipboard, **drag and drop** files onto the window, **import from a file** in
BibTeX or RIS format, and **export** your whole library to BibTeX, RIS, CSV, or
a styled HTML bibliography.

This chapter covers every one of those paths in depth: exactly what each one
accepts, how cite-key collisions are handled, what fields are mapped where, and
what lands on disk. Because importing **adds** entries to whichever library you
have open — and, like every other edit, does not touch your `.bib` file until
you [Save](03-editing-entries.md#the-dirtysave-model) — it is worth knowing
precisely what each method does before you reach for it.

> **Note:** All of the import methods in this chapter **add** entries to the
> library you currently have open. None of them replaces, merges-over, or
> deletes existing entries, and nothing is written to disk until you press
> **Save** (**⌘S** / **Ctrl+S**). If you import a batch and then quit without
> saving, those entries are discarded — there is no autosave by default. (You can
> turn on an autosave option; see [Editing entries](03-editing-entries.md#the-dirtysave-model).)

## 7.1 The four ways in, at a glance

| Method | How you trigger it | Accepts | Best for |
| --- | --- | --- | --- |
| **Paste BibTeX** | **Edit → Paste Publication** (**⇧⌘V** / **Shift+Ctrl+V**), or just **paste** (`⌘V`) BibTeX text when the table is focused | One or more `@type{…}` entries on the clipboard | Grabbing a citation from Google Scholar, a publisher page, or an email |
| **Drag and drop** | Drag files from your file manager onto the window | `.bib`, `.ris`, EndNote `.enw`/`.enl`/`.xml`, PDFs, and any other file | Dropping a folder of PDFs, or merging a colleague's `.bib` |
| **Import from file** | **File → Import → From File (BibTeX / RIS / EndNote)…** (**⇧⌘I** / **Shift+Ctrl+I**) | `.bib`, `.ris`, and EndNote `.enw`/`.enl`/`.xml` files chosen in a dialog | A clean, dialog-driven import of one or several files |
| **Online search** | **File → Import → Search Online…**, or the **🌐 Online…** toolbar button | CrossRef / arXiv results | Finding a reference you don't have a file for. See [Online search](08-online-search.md). |

The first three are covered here; online search has its own chapter. Whichever
method you use, the same two rules apply: **cite keys are kept unique** (a clash
gets a `-1`, `-2`, … suffix), and the import is **in memory until you Save**.

## 7.2 Pasting BibTeX from the clipboard

The fastest way to capture a single reference is to paste it. Most databases and
search engines — Google Scholar, publisher pages, the ACM and IEEE libraries,
arXiv — offer a "BibTeX" or "Export citation" button that puts an `@article{…}`
record on your clipboard. Bibliofile turns that clipboard text into a real
entry.

There are two ways to do it, and both end up in the same place.

### 7.2.1 Edit → Paste Publication (the explicit way)

1. Copy a BibTeX entry to your clipboard from wherever you found it.
2. With a library open, choose **Edit → Paste Publication**
   (**⇧⌘V** / **Shift+Ctrl+V**).

The app reads the clipboard, parses it as BibTeX, and adds every entry it finds.
The new entries are selected so you can review and tidy them immediately in the
detail pane.

### 7.2.2 Just paste (the quick way)

If the **publications table** has focus — that is, you are *not* currently typing
in a field, a search box, or a text area — you can simply press **⌘V** / **Ctrl+V**.
When the clipboard text looks like BibTeX (it contains something of the form
`@type{`), the app intercepts the paste and imports it instead of doing an
ordinary text paste.

> **Note:** This "bare paste" deliberately stays out of your way while you are
> editing. If your cursor is in a field editor, the search box, or any text area,
> **⌘V** pastes text into that box as normal — only a paste landing on the table
> (or window chrome) is treated as a BibTeX import. When in doubt, use **Edit →
> Paste Publication**, which always imports regardless of focus.

### 7.2.3 What paste accepts and how keys are assigned

- **One or many entries.** The clipboard may hold a single `@article{…}` or a
  whole block of several entries; all of them are imported in one go.
- **Missing cite keys are generated.** An entry with no cite key is given one,
  derived from its author and year using your cite-key format (the same generator
  as the **Generate** button — see
  [Editing entries](03-editing-entries.md#cite-key)). If nothing usable can be
  derived, it falls back to a provisional `imported` key you should rename.
- **Clashing cite keys are disambiguated.** If a pasted entry's key already
  exists in your library, the app appends `-1`, `-2`, … until it is unique, so
  pasting never silently overwrites an existing entry.
- **Attachment blobs survive.** If the pasted BibTeX already contains
  `Bdsk-File-N` attachment fields, they are carried across intact.

If the clipboard text contains no recognisable entries, the app does nothing and
records the warning *"No BibTeX entries found in the pasted text."* — a sign the
text wasn't BibTeX (a common mistake is copying a *formatted* citation rather
than its BibTeX source).

> **Tip:** Treat a pasted entry as a *starting point*. Online and clipboard
> BibTeX is often imperfect — ALL-CAPS titles, abbreviated venues, initials-only
> names. Because the new entry is selected the moment you paste, the detail-pane
> editor is right there for cleanup. See
> [Editing entries](03-editing-entries.md).

## 7.3 Drag and drop

You can drop files straight onto the Bibliofile window. As soon as you drag
files over the window, a full-window overlay appears reading **"Drop .bib or
files to import"**, confirming the drop will land. Release the files and the app
imports them according to their type.

| You drop… | What happens |
| --- | --- |
| **`.bib` file(s)** | Each file's entries are **merged** into the open library, exactly as if pasted — with the same unique-cite-key handling. Warnings are prefixed with the file's name. |
| **`.ris` file(s)** | Imported as RIS records (see [§7.5](#75-the-ris-format)). |
| **EndNote file(s)** (`.enw`, `.enl`, `.xml`) | Imported as EndNote records (see [§7.5.3](#753-endnote-import)). |
| **PDF** | The PDF is sniffed for a **DOI** (then an **arXiv** id) and, if one is found, the reference is **looked up online** (CrossRef / arXiv) so a **fully-populated entry** is created with the PDF attached. If that paper is **already in your library**, the PDF is attached to the existing entry instead of creating a duplicate. With no identifier — or if the lookup finds nothing — it falls back to a filename-titled **stub**. See the notes below. |
| **Any other file** | A **new entry is created and the file attached**: type = your configured default (`article` unless you changed it), `Title` = the filename (without the extension), with a generated cite key. |
| **Plain text** that looks like BibTeX | Imported as if pasted (see [§7.2](#72-pasting-bibtex-from-the-clipboard)). |

This makes drag-and-drop the fastest way to build a library: drop a pile of PDFs
at once and each is identified, looked up, and turned into a real entry with the
PDF attached. While the lookups run, the status bar reads **"Looking up
references…"**; when it finishes it shows a summary such as **"Imported: 3 from
identifier, 1 linked to existing, 1 without metadata."** Anything that couldn't be
identified becomes a filename-titled stub you can fill in by hand — or enrich with
[Online search](08-online-search.md).

> **Note:** Identifiers are read from the PDF's **first pages** — a DOI printed in
> the text, or the `arXiv:…` watermark / abs URL on a preprint. A scanned PDF with
> no text layer, or a paper that prints no identifier, won't be recognized and
> becomes a filename stub (the file is still attached). The attachment is recorded
> as a link (a `Bdsk-File-N` blob with a path relative to the library), exactly as
> if you had added it through the **Attachments** section — see
> [Attachments](04-attachments.md).

> **Warning:** A dropped file is attached by **link**, not copied into the
> library folder. For the link to keep resolving, keep the file in a predictable
> place relative to your `.bib` — or use
> [AutoFile](04-attachments.md#autofile-organising-linked-files) afterwards to
> move it into your Papers folder. See
> [Attachments → portability](04-attachments.md#best-practices-for-portable-attachments).

## 7.4 Importing from a file

When you want a tidy, dialog-driven import — choosing exactly which files to bring
in — use the **Import** menu.

1. With a library open, choose **File → Import → From File (BibTeX / RIS /
   EndNote)…** (**⇧⌘I** / **Shift+Ctrl+I**).
2. In the file dialog (titled **Import**), select **one or more** files. The
   dialog filters to **Bibliographies** (`.bib`, `.ris`, `.enw`, `.enl`, `.xml`)
   by default; switch the filter to **All Files** if you need to.
3. The chosen files are imported by type — `.bib` files merge their entries,
   `.ris` files import their records, EndNote `.enw`/`.enl`/`.xml` files import
   their records, and any other file you force through the *All Files* filter is
   handled just as with drag-and-drop: a **PDF** is looked up by its DOI/arXiv id
   (falling back to a stub), and any other file becomes a stub with that file attached.

The same **File → Import** submenu also contains **Search Online (CrossRef /
arXiv)…** (**⇧⌘O** / **Shift+Ctrl+O**), which opens the
[online-search](08-online-search.md) window — the fourth way in, documented in
its own chapter.

> **Tip:** Multi-selection works in the dialog (Shift-click or Cmd/Ctrl-click), so
> you can import several `.bib`/`.ris` files in a single operation. Each file's
> warnings are reported with that file's name, so you can tell which source a
> problem came from.

## 7.5 The RIS format

**RIS** is a long-standing tagged citation format exported by EndNote, Zotero,
Mendeley, PubMed, ScienceDirect, and many library catalogues. A RIS record is a
list of two-letter tags, one per line, bracketed by a `TY` (type) line and an
`ER` (end of record) line:

```
TY  - JOUR
AU  - Einstein, A.
AU  - Podolsky, B.
AU  - Rosen, N.
TI  - Can Quantum-Mechanical Description of Physical Reality Be Considered Complete?
JO  - Physical Review
PY  - 1935
VL  - 47
SP  - 777
EP  - 780
DO  - 10.1103/PhysRev.47.777
ER  -
```

When you import RIS (by drag-and-drop, by **File → Import**, or by dropping a
`.ris` file), each record becomes a BibTeX entry. A trailing `ER` is optional —
the last record is imported even if its `ER` line is missing. As with every other
import, cite keys are generated and de-duplicated automatically, and the library
is marked unsaved.

### 7.5.1 RIS type → BibTeX type

The RIS reference type (`TY`) chooses the BibTeX entry type:

| RIS `TY` | BibTeX type |
| --- | --- |
| `JOUR` | `article` |
| `BOOK` | `book` |
| `CHAP` | `incollection` |
| `CPAPER`, `CONF` | `inproceedings` |
| `THES` | `phdthesis` |
| `RPRT` | `techreport` |
| `UNPB` | `unpublished` |
| `GEN` | `misc` |

Any reference type not in the table is imported as `misc`. (You can correct the
type afterwards from the **Type** dropdown — see
[Editing entries](03-editing-entries.md#type).)

### 7.5.2 RIS tag → BibTeX field

| RIS tag(s) | BibTeX field | Notes |
| --- | --- | --- |
| `AU`, `A1` | `Author` | Multiple lines accumulate, joined with ` and ` |
| `A2`, `ED` | `Editor` | Multiple lines, joined with ` and ` |
| `TI`, `T1` | `Title` | |
| `T2`, `JO`, `JF` | `Journal` or `Booktitle` | `Journal` for a `JOUR` record, `Booktitle` otherwise |
| `PY`, `Y1` | `Year` | The first four-digit run is kept |
| `VL` | `Volume` | |
| `IS` | `Number` | |
| `SP` / `EP` | `Pages` | Combined as `start--end`; a lone `SP` becomes a single page |
| `PB` | `Publisher` | |
| `CY` | `Address` | |
| `SN` | `Isbn` | |
| `DO` | `Doi` | |
| `UR` | `Url` | |
| `AB`, `N2` | `Abstract` | |
| `KW` | `Keywords` | Multiple keywords, joined with `, ` |

Tags the importer does not recognise are ignored, so an unusual RIS file imports
cleanly with its mappable fields and quietly drops the rest.

### 7.5.3 EndNote import

Bibliofile reads the two EndNote formats you actually run into:

- **Refer / tagged** (`.enw`) — the line-oriented `%X value` format. This is
  what **Google Scholar's "EndNote" download** produces, and what many journal
  sites offer as "Download citation → EndNote". Records are separated by blank
  lines; `%A` (author), `%E` (editor) and `%K` (keywords) may repeat.
- **EndNote XML** (`.xml`, `.enl`) — EndNote's richer `<xml><records>…`
  interchange export. Text wrapped in EndNote's `<style>` runs is unwrapped to
  plain text automatically.

The reference type sets the BibTeX type (*Journal Article* → `article`, *Book* →
`book`, *Book Section* → `incollection`, *Conference Proceedings*/*Paper* →
`inproceedings`, *Thesis* → `phdthesis`, *Report* → `techreport`; anything else →
`misc`). Common fields map across as you would expect:

| EndNote (tagged / XML) | BibTeX field | Notes |
| --- | --- | --- |
| `%A` / `<author>` | `Author` | Joined with ` and ` |
| `%E` / `<secondary-authors>` | `Editor` | Joined with ` and ` |
| `%T` / `<title>` | `Title` | |
| `%J` / `<secondary-title>`, `<full-title>` | `Journal` or `Booktitle` | `Journal` for an article, `Booktitle` otherwise |
| `%D` / `<year>` | `Year` | First four-digit run |
| `%V` / `<volume>` | `Volume` | |
| `%N` / `<number>` | `Number` | |
| `%P` / `<pages>` | `Pages` | A single hyphen between numbers becomes `--` |
| `%I` / `<publisher>` | `Publisher` | |
| `%C` / `<pub-location>` | `Address` | |
| `%R` / `<electronic-resource-num>` | `Doi` | A leading `doi:` is stripped |
| `%U` / `<related-urls>` | `Url` | |
| `%@` / `<isbn>` | `Issn` or `Isbn` | `Issn` when it looks like one, else `Isbn` |
| `%K` / `<keyword>` | `Keywords` | Joined with `, ` |
| `%X` / `<abstract>` | `Abstract` | |

As with RIS, EndNote imports get fresh generated cite keys and are added as new
entries (nothing is overwritten); unrecognised tags are ignored.

## 7.6 Exporting your library

To get references *out* of Bibliofile in a different format, use the
**Export** menu. Each format writes the **whole library** to a file you choose.

Choose **File → Export →** and then one of:

| Format | Menu item | What it produces |
| --- | --- | --- |
| **BibTeX** | **BibTeX…** | A standard `.bib` file in BibDesk's canonical format — the same serialization a normal Save produces, including macros and the document header. |
| **RIS** | **RIS…** | A `.ris` file with one record per entry (see the mapping below). |
| **CSV** | **CSV…** | A comma-separated spreadsheet with a fixed set of bibliographic columns. |
| **HTML** | **HTML…** | A self-contained, styled HTML bibliography page (rendered through a Handlebars template). |

Each choice opens a **Save** dialog (titled **Export**) with a sensible default
filename — your library's name with the appropriate extension. None of the export
items has a keyboard shortcut; they live entirely in the **File → Export**
submenu.

To export **just some entries**, select them in the table and choose **File →
Export → Selected Entries (BibTeX)…**. This writes only the highlighted entries
(or, if exactly one row is selected, that one) to a `.bib` file — handy for
pulling the references for a single paper out of a large library. The default
filename is your library's name with a `-selection` suffix.

> **Note:** The five top-level **Export** formats always write the **entire**
> library, regardless of the group you have selected or any live-search filter —
> they are *export the whole file* operations. Use **Selected Entries (BibTeX)…**
> (above) when you want only the highlighted entries, or **Edit → Copy as BibTeX**
> to put a single entry on the clipboard — see
> [Editing entries](03-editing-entries.md#copying-entries-cite-keys-and-citations).

> **Tip:** Exporting to BibTeX is also a convenient way to take a one-off snapshot
> of the library to a new file without disturbing your working `.bib` or its
> `.bib.bak` backup. To save the *working* library under a new name and keep
> editing it there, use **File → Save As…** (**⇧⌘S**) instead.

### 7.6.1 RIS export

Each entry is written as a RIS record. The BibTeX type is mapped to a RIS `TY`
(for example `article` → `JOUR`, `book` → `BOOK`, `inproceedings` → `CPAPER`,
`phdthesis` → `THES`, `misc` → `GEN`; unknown types fall back to `GEN`), and the
fields are emitted as their RIS tags — `AU` per author, `A2` per editor, `TI`,
`T2` (journal or book title), `PY`, `VL`, `IS`, `SP`/`EP` split from `Pages`,
`PB`, `CY` (from `Address`), `SN` (from `Isbn`/`Issn`), `DO`, `UR`, `AB`, a `KW`
per keyword, and `ID` carrying the cite key. Values are de-TeXified on the way
out so accents and braces export as plain Unicode text.

### 7.6.2 CSV export

The CSV has a fixed header row and one row per entry, with these columns:

> **Cite Key**, **Type**, **Authors**, **Title**, **Year**, **Journal**,
> **Volume**, **Pages**, **Publisher**, **DOI**

The **Journal** column falls back to the book/proceedings title when an entry has
no journal, multiple authors are joined with `; `, and cells containing commas,
quotes, or newlines are quoted and escaped to standard CSV rules. The result
opens cleanly in any spreadsheet program.

### 7.6.3 HTML export

The HTML export produces a **complete, self-contained web page** — a styled
bibliography you can open in a browser, email, or publish. The page has its own
inline styling (so it needs no external CSS), a heading showing the library's
name and the number of entries, and one formatted reference paragraph per entry:

```
Einstein, A., Podolsky, B., Rosen, N. (1935). Can Quantum-Mechanical
Description of Physical Reality Be Considered Complete?. Physical Review,
47, 777. https://doi.org/10.1103/PhysRev.47.777 [einstein1935]
```

Each reference shows the authors, the year, the title, the venue, volume and
pages, a clickable DOI link, and the cite key in brackets — and any field an
entry lacks is simply left out of its line. The page is generated from a
**Handlebars** template, the same lightweight templating approach BibDesk's old
custom `.template` language served, and every interpolated value is HTML-escaped,
so titles with `<`, `>`, or `&` export safely.

> **Note:** The HTML bibliography is a fixed, readable reference layout — not the
> CSL-formatted citation you see in the detail pane, and not a `bibtex`/`biber`
> bibliography. It is meant for sharing a glance-able list, not for typesetting a
> paper. For a properly styled single citation, use the
> [formatted-citation block](06-preview-and-citations.md#formatted-citations) or
> **Edit → Copy Citation**.

### 7.6.4 Printing a bibliography

**File → Print…** (**⌘P** / **Ctrl+P**) produces a printed, **CSL-formatted**
bibliography — the same styled citations you see in the detail pane, one per
entry, with a hanging indent and a heading. Choosing it opens your system's
standard **Print** dialog, which on macOS also offers **Save as PDF** (a quick
way to get a formatted PDF reading list without exporting a file first).

Unlike **Export**, Print follows **what you are looking at**:

- If you have **two or more entries selected**, only those are printed.
- Otherwise the **current group** is printed (the whole library, a static or
  smart group's members — whatever the table is currently showing).

The heading is your library's name, and — when a group other than the whole
library is selected — the group name too (for example *math-demo — To Read*).
The entries are formatted with your **default citation style** (set in
**Preferences**), so switching styles there changes how the printout reads.

> **Note:** Print uses the CSL citation formatter, *not* the HTML-export
> template — so a printout matches your chosen reference style, whereas
> **File → Export → HTML…** always writes the same fixed, glance-able layout.

## 7.7 Quick reference

| Action | How |
| --- | --- |
| Paste BibTeX (explicit) | **Edit → Paste Publication** (**⇧⌘V** / **Shift+Ctrl+V**) |
| Paste BibTeX (quick) | Copy BibTeX, then **⌘V** / **Ctrl+V** with the table focused |
| Drag-and-drop import | Drag `.bib`/`.ris`/EndNote/PDF/other files onto the window |
| Import from a file | **File → Import → From File (BibTeX / RIS / EndNote)…** (**⇧⌘I** / **Shift+Ctrl+I**) |
| Search online | **File → Import → Search Online…** (**⇧⌘O**) or **🌐 Online…** |
| Export BibTeX | **File → Export → BibTeX…** |
| Export RIS | **File → Export → RIS…** |
| Export CSV | **File → Export → CSV…** |
| Export HTML | **File → Export → HTML…** |
| Export selected entries | **File → Export → Selected Entries (BibTeX)…** |
| Print / Save as PDF | **File → Print…** (**⌘P** / **Ctrl+P**) — prints the selection or current group |
| Persist imports | **Save** (**⌘S** / **Ctrl+S**) — imports are in memory until saved |

## 7.8 Troubleshooting

**"Paste Publication did nothing / 'No BibTeX entries found.'"**
The clipboard didn't contain BibTeX. Make sure you copied the *BibTeX source*
(`@article{…}`), not a formatted citation or an HTML snippet. Re-copy from the
source's "BibTeX" / "Export citation → BibTeX" option and paste again.

**"A plain ⌘V didn't import — it pasted text instead."**
The bare-paste import only fires when the table (not a text field) has focus and
the clipboard looks like BibTeX. If your cursor was in a field, the search box, or
a text area, **⌘V** pastes there as normal. Use **Edit → Paste Publication**,
which imports regardless of focus.

**"I dropped a PDF but the entry has no real title/author."**
Dropping a PDF creates a stub entry titled from the filename and attaches the
file; it does not read the paper's metadata. Fill in the bibliographic fields by
hand, or look the paper up with [Online search](08-online-search.md) and copy the
fields across.

**"My import isn't in the file after I quit."**
Imports are unsaved edits. Press **⌘S** / **Ctrl+S** (or click **Save**) after a
batch of imports. There is no autosave unless you enable it in
[Preferences](03-editing-entries.md#the-dirtysave-model).

**"The RIS import dropped some fields."**
Only the RIS tags in the [mapping table](#752-ris-tag--bibtex-field) are
imported; unrecognised tags are ignored. Add any missing fields by hand in the
detail pane.

**"My export looks reformatted / lost my Markdown."**
The CSV, RIS, and HTML exports de-TeXify and flatten values for their target
format, so braces and TeX accents become plain text and Markdown in abstracts is
not rendered. This is expected — those formats can't carry BibTeX/Markdown
markup. Your `.bib` library itself is untouched by exporting.

## See also

- [Online search](08-online-search.md) — the fourth way in: pull references from
  CrossRef and arXiv.
- [Editing entries](03-editing-entries.md) — clean up an imported entry, and the
  **Copy as BibTeX** / **Copy Citation** clipboard commands.
- [Attachments](04-attachments.md) — how dropped PDFs are stored, and **AutoFile**.
- [Shortcuts & reference](09-shortcuts-and-reference.md) — the full menu and
  keyboard reference.
