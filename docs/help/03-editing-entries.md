# Editing Entries

The pane on the right of the main window is a **read-only view** of the selected
publication — its preview, citation, fields, notes, and attachments — so you can
browse without any risk of changing something by accident. **Editing happens in a
separate window.** Click **✎ Edit…** at the top of the view pane, **double-click**
a row in the table, or choose **Publication → Edit Publication…** (**⌘E** /
**Ctrl+E**) to open the editor window for that entry. (This mirrors BibDesk's
separate editor windows.)

The **editor window** is the full-featured editor: everything about an entry can
be changed there — its individual fields, its cite key, its BibTeX type, the
files attached to it, and the free-form notes that travel with it. You can open
several editor windows at once (one per entry). Changes you make there update the
main window live, and are saved with the rest of the library from the main window
(**Save**, ⌘S / Ctrl+S). The sections below describe the fields, cite key, type,
notes, and attachments as they appear in that editor window.

This chapter explains the editing model in depth. It is worth understanding two
ideas up front, because they govern almost everything else:

1. **You edit the raw BibTeX, not the pretty display.** The table and the
   preview card show a cleaned-up, de-TeXified rendering of each value. The
   editor, by contrast, lets you change the *actual text that will be written to
   the file*. This distinction matters the moment you want braces, macros, or
   TeX accents — see [The raw-value model](#the-raw-value-model-what-you-are-really-editing).
2. **Editing is explicit-save by default.** Your changes live in memory and are
   not written to disk until you press **Save** (Cmd+S / Ctrl+S); there is no
   autosave unless you turn one on. This is a deliberate safety choice, explained
   in detail under [The dirty/save model](#the-dirtysave-model).

![Editing an entry](../viewer-editing.png)

> **Note:** The view pane only shows an entry once a publication is selected. If
> you see "Select a publication to see its details," click any row in the
> publications table first. See [Browsing & Searching](02-browsing-and-searching.md).

## Anatomy of the detail pane

When an entry is selected, the detail pane is laid out top-to-bottom as a stack
of sections, each of which is described in its own part of this manual:

| Section | What it is | Covered in |
|---------|------------|------------|
| Preview card | A typographic rendering of the entry (title, authors, venue, chips, tags, abstract). Read-only. | [Preview & Citations](06-preview-and-citations.md) |
| Citation | A formatted citation in your chosen CSL style (APA, Vancouver, Harvard). Read-only. | [Preview & Citations](06-preview-and-citations.md) |
| Identity | The cite key (with **Generate**) and the entry **Type**. | [Cite key and type](#cite-key-and-type) below |
| Fields | Every editable field, plus a row for adding new ones. | [Editing fields](#editing-fields) below |
| Notes | The entry's Markdown notes (the `Annote` field). | [Notes & Abstracts](05-notes-and-abstracts.md) |
| Attachments | Files and links attached to the entry. | [Attachments](04-attachments.md) |

The preview and citation blocks at the top always reflect your *latest* edits:
each time you commit a change, the detail re-renders, so you can watch the
formatted output update as you type.

## Editing fields

The **Fields** section lists every field stored on the selected entry, in the
order BibDesk keeps them. A handful of fields are deliberately *not* shown in
this list because they have dedicated homes elsewhere in the pane:

- **`Annote`** — shown and edited in the **Notes** section instead (see
  [Notes & Abstracts](05-notes-and-abstracts.md)).
- **`Bdsk-File-N`** — the managed attachment blobs, shown in the **Attachments**
  section instead (see [Attachments](04-attachments.md)).

Everything else — `Author`, `Title`, `Journal`, `Year`, `Crossref`, custom
fields you invent, and so on — appears as an editable row.

### How to edit a value

1. Click a field's value box to begin editing.
2. Type your change.
3. **Commit** it:
   - For an ordinary single-line field, press **Enter** (or click away / Tab
     out of the box).
   - For a long field (see below), click away to commit. Pressing Enter inside a
     multi-line box inserts a newline rather than committing.

A change is only sent to the document when the committed value actually
*differs* from what was there before. Re-committing an unchanged value is a
no-op and will not mark the library dirty.

> **Tip:** "Commit" simply means "leave the box." If your edit seems not to have
> taken effect, you most likely changed the text but never pressed Enter or
> clicked elsewhere. See [Troubleshooting](#troubleshooting).

### Single-line versus long (textarea) fields

The editor automatically chooses the right kind of input for each field:

- **Single-line input** — used for short values. Commits on **Enter** or on
  blur (clicking away).
- **Multi-line textarea** — used when a value is long or free-form. A field
  opens as a textarea when **either**:
  - its name is **`Abstract`** (case-insensitive), or
  - its current raw value is **longer than 60 characters**.

  A textarea commits **only on blur** — click outside it (or Tab away) to save.
  Enter adds a line break.

This 60-character rule is applied to the *raw* value, so a field with a long
macro expression or a value full of braces may open as a textarea even if its
displayed form looks short.

> **Note:** The `Abstract` field is rendered as Markdown in the preview card.
> You still edit it as plain text here; see
> [Notes & Abstracts](05-notes-and-abstracts.md) for the Markdown conventions.

### Field-value autocomplete

When you click into a **single-line** field, the editor offers an autocomplete
list of values **already used in that same field elsewhere in your library**. As
you type, the list narrows to matching suggestions; pick one to fill the box. This
makes consistent data entry effortless — the same journal name, publisher,
keyword, or series spelled the same way every time.

- The suggestions are drawn from the **distinct existing values** of that field
  across every entry, gathered the first time you focus the box. So the more
  consistently you have filled a field in the past, the more useful its
  completions are.
- For **`Keywords`** and other multi-value list fields, the suggestions are the
  individual tokens (split on commas/semicolons), not whole comma-joined strings,
  so you can complete one keyword at a time.
- Long fields (the `Abstract`, or anything that opens as a multi-line textarea)
  do **not** offer completions — there is rarely a useful "existing value" to
  reuse for free prose.

> **Tip:** Autocomplete is the easiest way to keep a controlled vocabulary. Reuse
> an existing keyword from the list rather than retyping it, and your
> [Keyword categories](02-browsing-and-searching.md#245-the-dynamic-author-and-keyword-categories)
> stay clean instead of fragmenting into near-duplicates.

### The raw-value model: what you are really editing

This is the single most important thing to understand about the field editor.

The publications table and the preview card show each value after a **display
transform**: BibTeX protective/grouping braces are stripped and TeX escapes are
converted to Unicode. So a title stored as

```bibtex
title = {The {C}alabi-{Y}au Manifold}
```

is *shown* as "The Calabi-Yau Manifold." The field editor, however, gives you
the **raw BibTeX text** — `The {C}alabi-{Y}au Manifold`, braces and all — because
that is what will be written back to your `.bib` file.

The consequences are worth spelling out:

- **To protect capitalization** (so BibTeX/LaTeX does not lowercase a word in a
  title), brace it yourself: type `{DNA} sequencing`, not `DNA sequencing`.
- **To enter accents or special characters**, you may type either the Unicode
  character directly (`Erdős`) or the TeX form (`Erd\H{o}s`). Both round-trip;
  type whichever you prefer to see in the file.
- **To use a macro** (an `@string` abbreviation), type the macro name. Note the
  current field editor stores values as **literal strings**: if you type
  `jan # { 2024}` it is saved verbatim as that literal text rather than parsed
  into a concatenation. Defining and managing the macros themselves is done in
  the [`@string` macro editor](#string-macros); macro-aware concatenation in the
  field editor is a planned future refinement.
- **URL, DOI, and file fields are shown raw and un-transformed**, because
  de-TeXifying a URL could corrupt it. What you type is exactly what is stored.

> **Warning:** Because you are editing raw BibTeX, a stray unbalanced brace
> (`{` with no matching `}`) will be written to the file as-is. Keep your braces
> balanced.

### Adding a field

Below the **Fields** list is a small green **＋** button (a circle). To add a
field the entry does not yet have:

1. Click the green **＋**. A blank field-editor row appears (with the cursor in
   the name box). Click **＋** again for more rows.
2. Type the field name in the left box — for example, `Publisher`. (Field names
   are case-insensitive and are normalized to lower-case on save.)
3. Type the value in the right box.
4. Press **Enter** to add the field. To abandon a blank row without adding it,
   click its red **−** button (or press **Escape**).

The new field is added immediately and appears as a normal editable row. An empty
field name is ignored. If you add a field whose name already exists on the entry,
its value is replaced.

> **Tip:** You can add any field name you like, including non-standard ones.
> Standard BibTeX fields for the entry's type are simply the ones BibDesk
> expects; the editor does not stop you from inventing your own (e.g.
> `Keywords`, `Rating`, or a project-specific tag field).

### Removing a field

There are two equivalent ways to remove a field:

- Click the red **−** button (a circle) at the right end of the field's row.
- Clear the field's value entirely (delete all its text) and commit the empty
  value.

Both delete the field outright from the entry — an empty value is **not** stored
as `field = {}`; it is removed. This is intentional and matches BibTeX
conventions, but it can surprise you: see [Troubleshooting](#troubleshooting) if
a field "disappears."

> **Required fields can't be deleted.** Fields that are *required* for the
> entry's BibTeX type (for example `author`, `title`, `journal`, and `year` on an
> `@article`) show a small **req** marker instead of a **−** button, so you can't
> accidentally remove them. Change the entry's **Type** and the set of required
> fields changes with it.

> **Note:** Inherited (crossref) fields have no **−** button, because they are
> not stored on this entry in the first place — see
> [Crossref inheritance](#crossref-inheritance).

### Inherited (crossref) fields

If the entry borrows fields from a parent via the `Crossref` field, those
inherited fields appear in the list **muted**, each marked with an
**(inherited)** badge, and **without** a **−** button. They are shown for
context — so you can see the entry's full effective field set — but they are not
physically stored on this entry.

Editing an inherited value does **not** change the parent. Instead it creates a
**local override**: committing a new value writes that one field onto the child
entry, where it then appears as a normal (non-inherited) field and shadows the
parent's value. The rest of the inheritance is unaffected. This is covered fully
under [Crossref inheritance](#crossref-inheritance).

## Cite key and type

The **Identity** block at the top of the editor holds the two pieces of metadata
that are not ordinary fields: the cite key and the entry type.

### Cite key

The **Cite Key** is the unique label you use to refer to the entry from LaTeX
(`\cite{einstein1905}`) and from notes (`[[einstein1905]]`).

- **To edit it manually**, click the box, type a new key, and press **Enter** (or
  click away). An empty cite key is rejected — the change is ignored and the
  previous key is kept.
- **To generate one automatically**, click **Generate**, or choose
  **Publication → Generate Cite Key** (**⌘K** / **Ctrl+K**).

#### How Generate works

Generation derives a cite key from the entry's own fields using a configurable
**cite-key format**. The factory default is `%a1:%Y%u2`, which means:

| Piece | Specifier | Meaning |
|-------|-----------|---------|
| First author's last name | `%a1` | The surname of the entry's first author |
| Literal colon | `:` | A literal `:` separator |
| Year | `%Y` | The 4-digit year |
| Uniquifier | `%u2` | A short numeric suffix added only if needed to avoid a clash |

So an article by Albert Einstein from 1905 typically generates `Einstein:1905`.
If that key is already taken by *another* entry, the uniquifier appends characters
until the key is unique. The entry's *own* current key never counts as a
collision, so regenerating a key for an entry that already owns `Einstein:1905`
simply returns `Einstein:1905` again.

You can change the format in **Preferences → Cite keys → Format**. The same
mini-language drives the [AutoFile](04-attachments.md#autofile-organising-linked-files)
file-name format; common specifiers include `%a`/`%A` (authors, full or
initials), `%t`/`%T` (title words/characters), `%Y`/`%y` (4- or 2-digit year),
`%f{Field}` (any field), and `%u`/`%U`/`%n` (a lowercase / uppercase / numeric
uniquifier).

> **Note:** Generation reads whatever author/year are currently on the entry. If
> those fields are empty, the generated key will be sparse (just the parts it can
> fill). Fill in `Author` and `Year` first, then click **Generate**, for a
> meaningful key.

#### Uniqueness

Cite-key comparison throughout the app is **case-insensitive** (matching
BibDesk's `itemForCiteKey:`): `Smith2020` and `smith2020` are treated as the same
key. When the app must invent a key on its own — for a new or duplicated entry —
it appends `-1`, `-2`, … to the base until the result is unique. Manual edits are
not forcibly de-duplicated; if you deliberately type a key that collides, the app
keeps what you typed (BibTeX itself, and a crossref lookup, will then resolve to
the first matching entry).

### Type

The **Type** dropdown sets the entry's BibTeX type. The picker offers the common
types:

`article`, `book`, `inbook`, `incollection`, `inproceedings`, `conference`,
`proceedings`, `phdthesis`, `mastersthesis`, `techreport`, `manual`, `misc`,
`unpublished`, `booklet`.

Changing the type takes effect immediately. If the entry's *existing* type is one
not in that list (for example, an exotic type from a hand-edited file), it is
added to the top of the dropdown so it is not lost.

> **What "type" means:** the type tells BibTeX, BibDesk, and citation styles how
> to interpret the entry — which fields are expected, how it should be formatted
> in a bibliography, and which CSL category it maps to (e.g. `article` →
> journal article, `inproceedings` → conference paper). Changing the type does
> **not** add or remove any of your stored fields; it only relabels the entry. If
> you switch an `article` to a `book`, your `Journal` field is still there — it is
> just no longer the field that type cares about.

## Entry lifecycle: New, Duplicate, Delete

The toolbar above the three panes operates at the library level. The relevant
buttons — each also available from the **Publication** menu, several with a
keyboard shortcut — are:

| Button | Menu / shortcut | Action | Needs a selection? |
|--------|-----------------|--------|--------------------|
| **＋ New** | **Publication → New Publication** (**⌘N** / **Ctrl+N**) | Create a fresh, empty entry and select it. | No |
| **⧉ Duplicate** | **Publication → Duplicate** (**⇧⌘D** / **Shift+Ctrl+D**) | Copy the selected entry under a new cite key. | Yes |
| **🗑 Delete** | **Publication → Delete Publication**, the **Delete** / **Backspace** key, or **right-click → Delete** | Remove the selected entry (or entries). | Yes |

The **Publication** menu also holds **Generate Cite Key** (**⌘K**),
**Find Duplicates…** (see
[Browsing & Searching](02-browsing-and-searching.md#26-finding-duplicates)),
**Add File Attachment…** and **AutoFile Linked Files** (see
[Attachments](04-attachments.md)), and **Macros (@string)…** (the same macro
editor as the **@string…** toolbar button).

**Duplicate** and **Delete** are disabled (greyed out) when no entry is selected.

### ＋ New

Creates a brand-new entry of type `article` with no fields. Its cite key is
auto-assigned a unique placeholder (based on `untitled`, suffixed `-1`, `-2`, …
if `untitled` is taken). The new entry becomes the selection so you can start
filling it in straight away. Change its type from the **Type** dropdown if
`article` is not what you want.

### ⧉ Duplicate

Makes a copy of the currently selected entry. **What is copied:**

- The entry **type**.
- **Every field**, copied as its raw value — including attachment blobs
  (`Bdsk-File-N`), notes (`Annote`), and the `Crossref` link.

**What changes:**

- The **cite key**. The copy gets a unique key based on the original plus
  `-copy` (e.g. `smith2020-copy`, then `smith2020-copy-1`, … if needed).

The duplicate is selected after creation. Duplicating is the quickest way to
enter a run of similar entries (several papers from the same journal and year,
several chapters of one book): duplicate, then change only the fields that
differ.

### 🗑 Delete

Removes the selected entry (or entries) from the library. You can delete in
several equivalent ways:

- The toolbar **🗑 Delete** button or **Publication → Delete Publication** (the
  current single selection).
- The **Delete** or **Backspace** key, with the publications table focused —
  this removes the **whole selection** (one row or many).
- A **right-click** on a row and **Delete entry** / **Delete N entries** from the
  [context menu](10-panels.md#the-row-context-menu).

> **Note:** When several rows are selected, deleting them is a **single undo
> step** — one **Edit → Undo** (**⌘Z** / **Ctrl+Z**) restores the whole batch.
> The [multi-select view](10-panels.md#working-with-multiple-selected-entries)
> itself has no delete button; use the key or the context menu.

> **Tip:** A deletion is undoable, and is in any case only in memory until you
> **Save**: if you have not yet saved, **File → Revert to Saved** reloads the last
> saved version. Once you save, the deletion is written to the file (though the
> previous version survives in the `.bib.bak` backup — see
> [The dirty/save model](#the-dirtysave-model)).

To change a field, keyword, or colour label across **many** entries at once, use
the floating **batch-edit bar** that appears at the bottom of the window when
several rows are selected (**Set field**, **Add keyword**, **Remove keyword**) —
see [Configurable Panels → Batch tools](10-panels.md#batch-tools-the-selection-bar).

## Crossref inheritance

BibTeX's `Crossref` mechanism lets one entry — the **child** — borrow fields from
another — the **parent**. It is the standard way to avoid repeating shared
bibliographic data: several chapters that all belong to one edited book can point
at a single `@book` (or `@proceedings`) entry for the shared publisher, year,
editor, and book title.

### Setting up a crossref

1. Select the **child** entry.
2. Add (or edit) a field named **`Crossref`**.
3. Set its value to the **cite key** of the **parent** entry.

The moment you do this, the fields the child does not define itself, but which
the parent supplies, appear in the child's **Fields** list, each marked
**(inherited)**. The parent need not appear before the child in the file; the
link is resolved live by cite key (case-insensitively).

### A worked example

Consider an edited proceedings volume and one paper within it:

```bibtex
@proceedings{popl2024,
  title     = {Proceedings of the 51st ACM Symposium on Principles of Programming Languages},
  booktitle = {POPL 2024},
  editor    = {Jane Q. Public},
  publisher = {ACM},
  address   = {New York, NY},
  year      = {2024}
}

@inproceedings{ng2024types,
  author   = {Alice Ng},
  title    = {A Calculus of Effect Handlers},
  crossref = {popl2024},
  pages    = {101--128}
}
```

When you select `ng2024types`, its **Fields** list shows its own `author`,
`title`, `crossref`, and `pages` as normal rows, and additionally shows
`booktitle`, `publisher`, `address`, and `year` as muted **(inherited)** rows
borrowed from `popl2024`. The child did not have to restate any of them.

> **Note:** BibTeX's special case applies — a child `@inproceedings`/`@incollection`
> inherits the parent's `title` as its `booktitle`, so the venue resolves
> correctly even though the parent stores it under `title`.

### Overriding an inherited field

To override one inherited value just for this child — say this one paper used a
different page range convention, or you want a corrected year — click the muted
inherited row and edit it as usual. Committing the change writes that field
**onto the child**. It then becomes a normal, non-inherited row (gaining a **−**
button), and it shadows the parent's value for this entry only. The parent and
all its other children are untouched.

To go back to inheriting, remove your local override (the **−** button or by
clearing it); the parent's value reappears as inherited.

### Chain and collision rules

- **Resolution is by cite key, case-insensitively.** If two entries happen to
  share a cite key, the **first** one in the file is used as the parent (matching
  BibDesk's behavior).
- **Crossref chains** are followed (a child whose parent itself has a `Crossref`
  can inherit transitively), with cycle protection so a self-referential or
  circular `Crossref` cannot loop forever.
- A child always **wins** over its parent for any field the child defines
  locally; inheritance only fills in fields the child is missing.

## `@string` macros

`@string` macros are reusable abbreviations stored at the top of your library.
The classic use is journal names: define `prl` once as the full
"Physical Review Letters," then reference `prl` from every entry in that journal.
A macro is defined once and expanded everywhere it is used, so correcting a
journal's name in one place fixes it throughout.

Open the macro editor with the **@string…** button in the toolbar.

### Using the macro editor

The editor is a modal listing each macro as a **name** and an editable **value**:

- **Add** a macro by typing a name and value in the bottom row and clicking the
  **+** button (or pressing Enter in the value box). An empty name is ignored.
- **Edit** a macro's value by clicking its value box, changing the text, and
  clicking away (it commits on blur). The name is fixed once created.
- **Remove** a macro with the **×** button beside it.
- **Re-add to rename:** to rename a macro, add a new one with the desired name
  and remove the old one (then update any entries that referenced the old name).

Close the editor with the **×** in its header, or by clicking the dimmed
backdrop outside the dialog. Macro changes mark the library dirty just like field
edits and are written on the next **Save**.

### An example

Define a macro in the editor:

| Name | Value |
|------|-------|
| `prl` | `Physical Review Letters` |

Then, in an entry's `Journal` field, you would reference it. On save, the macro
is written into your file's preamble as:

```bibtex
@string{prl = {Physical Review Letters}}
```

> **Note on dependency ordering:** Macros may reference other macros, and the app
> serializes them in **dependency order** — a macro is always written after the
> macros it depends on — so the resulting `.bib` is valid for BibTeX regardless
> of the order in which you defined them. You do not need to define them in any
> particular sequence.

> **Tip:** As noted under [The raw-value model](#the-raw-value-model-what-you-are-really-editing),
> the field editor currently stores field values as literal text and does not
> itself parse `name # {literal}` concatenations. Manage the abbreviations
> themselves here in the macro editor.

## Find & Replace

To make the *same* change across many entries — fix a misspelled journal name,
normalise a publisher, swap one keyword for another, or clean up a recurring
typo — use **Edit → Find & Replace…** (**⌥⌘F** / **Alt+Ctrl+F**). It searches and
replaces inside **field values**, across many entries at once, with a preview so
you can check before committing.

### The Find & Replace window

The window has these controls:

- **Field** — a dropdown that scopes the search to a single field, or to **All
  fields**. The list offers the common bibliographic fields: `Title`, `Author`,
  `Editor`, `Journal`, `Booktitle`, `Year`, `Publisher`, `Keywords`, `Abstract`,
  `Note`, `Annote`, `Doi`, and `Url`. Choose **All fields** to search every field
  on each entry. (Managed attachment blobs — `Bdsk-File-N` — are always skipped,
  so a replacement can never corrupt an attachment.)
- **Find** — the text (or pattern) to look for. Press **Enter** here to run a
  preview.
- **Replace** — the text to substitute in.
- **Regular expression** — when ticked, the **Find** text is treated as a regular
  expression and **Replace** may use capture-group references like `$1`. When
  unticked, both are plain literal text.
- **Case sensitive** — when ticked, matching respects letter case; otherwise it
  is case-insensitive.
- **Find** and **Replace All** buttons (see below).

If a group is selected in the sidebar, the window title notes it (e.g.
*"Find & Replace — in My Smart Group"*), because the operation is **scoped to the
members of the currently selected group**. With the **📚 Library** group selected,
that means the whole library. (The scope is the group's full membership — it is
not narrowed by the live-search box.)

### Preview, then Replace All

Find & Replace is deliberately two-step so you never replace blind:

1. **Preview with the Find button** (or press **Enter** in the Find box). Nothing
   is changed. The window reports how many occurrences were found and in how many
   fields — *"N occurrence(s) in M field(s)."* — and lists the matches: each row
   shows the entry's cite key, the field, and the value **before → after** the
   replacement, so you can confirm the change is what you intended. (The list
   shows up to 40 matches, with a "… and N more" line beyond that.)
2. **Apply with Replace All.** This performs every replacement, marks the library
   unsaved, and reports *"Replaced N occurrence(s) in M field(s)."* The change is
   in memory, like any edit — write it to disk with **Save**.

If you typed an invalid regular expression, the window shows *"Invalid pattern:
…"* and changes nothing, so a bad pattern is safe.

> **Warning:** **Replace All** changes every match in scope in one go. Always run
> the **Find** preview first and read the before/after list. Because the change is
> only in memory until you **Save**, you can still back out a regrettable
> Replace All by reverting (**File → Revert to Saved**) before saving — but once
> saved, only the `.bib.bak` backup holds the previous version.

## Copying entries, cite keys, and citations

Several **Edit**-menu commands put information about the selected entry on the
clipboard, and you can also **drag** a row out of the table. These are the bridge
between your library and a document you are writing.

| Command | Shortcut | What it copies |
|---------|----------|----------------|
| **Copy Cite Key** | **⌥⌘K** / **Alt+Ctrl+K** | The bare cite key, e.g. `einstein1905`. |
| **Copy `\cite{…}`** | **⌥⌘C** / **Alt+Ctrl+C** | A LaTeX citation command for the entry, e.g. `\cite{einstein1905}`. |
| **Copy Citation** | (no shortcut) | The entry's **formatted citation** (in your chosen CSL style) as plain text — ready to paste into an email or reading list. |
| **Copy as BibTeX** | **⌥⌘B** / **Alt+Ctrl+B** | The entry's complete BibTeX source. |

### Drag a row to insert a `\cite{…}`

You can also **drag a row** from the publications table directly into a TeX editor
(or any text field) and drop it to insert a `\cite{…}` command for that entry — no
copy/paste round-trip. The drag carries the same text that **Copy `\cite{…}`**
produces.

### The cite-command template

Both the drag-out and **Copy `\cite{…}`** use a configurable **cite-command
template**, set in **Preferences → Cite command (TeX)**. The default is
`\cite{%K}`, where **`%K`** is replaced by the cite key. Change it to suit your
document — for example `\citep{%K}` for `natbib`, or `\autocite{%K}` for
`biblatex`. (Write `%%` if you ever need a literal percent sign.)

> **Tip:** Set the template once to match the citation command your LaTeX class
> uses, and every drag-out and **Copy `\cite{…}`** will produce exactly the right
> markup for your paper.

## The dirty/save model

Editing in Bibliofile is **explicit-save by default**: your changes live in
memory until you save them. This section explains exactly what that means and why
it was chosen. (An optional **autosave** can change this — see
[Optional autosave](#optional-autosave) below.)

### In-memory edits

Every edit you make — a field change, a new cite key, a type switch, a new or
deleted entry, a macro change, an attachment — mutates an **in-memory** copy of
your library. Your `.bib` file on disk is *not* touched. This keeps editing fast
and lets you make a series of changes, review them in the live preview, and
commit them all at once.

### The dirty indicator and how to save

As soon as you have unsaved changes, the **Save** button in the toolbar changes
to reflect the document's state:

| Button text | Meaning |
|-------------|---------|
| **Saved** | No unsaved changes; the disk file matches what you see. Button is disabled. |
| **Save •** | You have unsaved changes (the • is the "dirty" dot). Press it to write them. |
| **Saving…** | A save is in progress; the button is disabled until it finishes. |

To save, either:

- Press **Cmd+S** (macOS) or **Ctrl+S** (Windows/Linux), or
- Click the **Save** button.

The keyboard shortcut works from anywhere in the window.

### What a save does, step by step

When you save, the app:

1. **Serializes** the entire in-memory library back to BibTeX text in BibDesk's
   exact on-disk format (see [Round-trip fidelity](#round-trip-fidelity) below).
2. **Backs up** the existing file: if a file already exists at the target path,
   it is copied to `<your-file>.bib.bak` first. This `.bak` always holds the
   *previous* saved version, so a save is recoverable.
3. **Writes atomically:** the new text is written to a temporary file in the same
   directory, then *renamed* over the target. A rename on the same filesystem is
   atomic, so your library is never left half-written — even if power is lost or
   the app crashes mid-save, you end up with either the complete old file or the
   complete new one, never a corrupt mixture.
4. **Clears the dirty flag**, so the button returns to **Saved**.

> **Tip:** Because the backup is overwritten on each save, `<file>.bib.bak` is a
> one-deep safety net (the version immediately before the most recent save), not
> a full history. For real version history, keep your library under version
> control (e.g. Git) — the plain-text `.bib` format is well suited to it.

### Why explicit save by default?

Explicit save is the default for good reasons:

- **Predictability.** You decide exactly when the file changes. A burst of edits
  (or a deletion you immediately regret) does not silently hit disk.
- **Safe interop.** If you also open the same library in macOS BibDesk or a text
  editor, autosave races become possible. Explicit save keeps you in control of
  when this app writes.
- **The backup is meaningful.** Because saves are discrete events, the
  `.bib.bak` snapshot corresponds to a deliberate save point rather than an
  arbitrary autosave instant.

Until you turn autosave on, get into the habit of pressing Cmd+S when you are
happy with a batch of changes.

### Optional autosave

If you prefer the app to write changes for you, turn on **Preferences → Saving →
Autosave**. With it enabled, the library is saved automatically a moment after
each edit — the same atomic write with the same `.bib.bak` backup as a manual
save. It is **off by default**; the considerations above (predictability and safe
interop with other tools) are why you opt in deliberately rather than getting it
unasked.

> **Warning:** With autosave **off**, quitting or closing the document with
> unsaved changes discards those changes (they were only in memory). Save first
> if you want to keep them. **File → Revert to Saved** also discards unsaved
> changes, reloading the last saved version from disk.

## Round-trip fidelity

A core design goal of Bibliofile is that your `.bib` file keeps working
flawlessly alongside macOS BibDesk and the wider LaTeX ecosystem. On save, the
app re-emits the library in BibDesk's **byte-faithful** on-disk format.

**What is preserved:**

- All entries, their types, cite keys, and fields.
- `@string` macros and any `@preamble`.
- The BibDesk group definitions (Static, Smart, URL, Script) stored as
  `@comment` blocks.
- The `@bibdesk_info` document-info block.
- Attachment blobs (`Bdsk-File-N`) — including any existing macOS file
  bookmarks, preserved byte-for-byte (see [Attachments](04-attachments.md)).

**What is normalized** (BibDesk's own conventions, applied consistently):

- Field **names are lower-cased** and fields are written in a canonical sorted
  order (with `bdsk-file-N`/`bdsk-url-N` forced last).
- Field **values are wrapped in `{…}`**.
- **Empty fields are dropped** (this is why clearing a field removes it).
- A standard BibDesk **header** comment is written at the top.

These normalizations are exactly what macOS BibDesk itself does, so a file
written here is indistinguishable from one written by BibDesk, and you can move
freely between the two. The format has been proven against a golden test corpus
including a real BibDesk-authored library.

## Quick reference

### Toolbar actions

| Control | Action |
|---------|--------|
| ＋ New | Create a new empty `article` entry and select it |
| ⧉ Duplicate | Copy the selected entry under a new cite key |
| 🗑 Delete | Delete the selected entry |
| 🌐 Online… | Open the online search to import entries (see [Online Search](08-online-search.md)) |
| @string… | Open the `@string` macro editor |
| Save • / Saved / Saving… | Write unsaved changes to disk (Cmd+S / Ctrl+S) |

### Editing actions in the detail pane

| Action | How |
|--------|-----|
| Edit a field | Click the value, type, press Enter (single-line) or click away (textarea); pick from the autocomplete list of existing values |
| Add a field | Type name + value in the **New field** row, press Enter or click + |
| Add a field | Click the green **＋** below the fields, fill name + value, press Enter |
| Remove a field | Click the red **−** on the field's row (required fields can't be removed), or clear its value and commit |
| Override an inherited field | Click the muted (inherited) row and edit it |
| Edit cite key | Click the Cite Key box, type, press Enter |
| Generate cite key | Click **Generate**, or **Publication → Generate Cite Key** (Cmd+K) |
| Change type | Choose from the **Type** dropdown |
| Edit notes | Click **Edit** in the Notes section |
| Add/remove attachments | Use the Attachments section (see [Attachments](04-attachments.md)) |

### Library-wide editing commands (menus)

| Action | How |
|--------|-----|
| New / Duplicate / Delete | **Publication** menu (Cmd+N / Shift+Cmd+D / Delete Publication) |
| Find & Replace across fields | **Edit → Find & Replace…** (⌥⌘F / Alt+Ctrl+F) |
| Copy cite key / `\cite{…}` / citation / BibTeX | **Edit** menu (⌥⌘K / ⌥⌘C / Copy Citation / ⌥⌘B) |
| Drag a `\cite{…}` into a TeX editor | Drag a table row out and drop it |
| Edit `@string` macros | **@string…** toolbar button or **Publication → Macros (@string)…** |

## Troubleshooting

**"My edit didn't stick."**
A field value is only saved when you *commit* it — press **Enter** in a
single-line box, or click away from (blur) a multi-line textarea. If you typed a
change but then clicked Save without leaving the field first, the in-progress
text may not have been committed. Click into the field, make sure your text is
there, press Enter or Tab out, then save.

**"I lost a field — it vanished when I cleared it."**
Clearing a field's value and committing it **removes the field** (an empty value
is not stored). To blank a field rather than delete it, you generally do not want
to — BibTeX has no concept of an empty field. If you deleted it by mistake and
have not saved, re-add it from the **New field** row. If you have already saved,
the previous version is in `<file>.bib.bak`.

**"I can't remove an inherited field / there's no − on it."**
Inherited (crossref) fields are not stored on the entry, so there is nothing to
remove there. To stop inheriting a field, either remove it from the **parent**,
or change/remove the `Crossref` link on this entry.

**"Generate gave me a weird or empty cite key."**
Cite-key generation reads the entry's `Author` and `Year`. If those are missing
or unusual (no surname, no 4-digit year), the result reflects that. Fill in the
author and year, then click **Generate** again.

**"Enter isn't committing my abstract / long field."**
Long fields and the `Abstract` open as a multi-line textarea, where Enter inserts
a newline. Commit by clicking outside the box (or pressing Tab to move focus
away).

**"I typed `{` and the brace showed up in my title."**
You are editing raw BibTeX, so braces are literal. That is correct behavior — use
braces deliberately to protect capitalization, and keep them balanced. See
[The raw-value model](#the-raw-value-model-what-you-are-really-editing).

**"My changes disappeared after I closed the app."**
Unless you enabled autosave, unsaved (in-memory) changes are discarded on close.
Press Cmd+S / Ctrl+S — or click **Save** when the button shows **Save •** —
before quitting. (You can turn on **Preferences → Saving → Autosave** to avoid
this.)

**"Find & Replace says 'Invalid pattern'."**
You have ticked **Regular expression** and the **Find** text isn't a valid
regex. Either fix the pattern, or untick **Regular expression** to search for the
literal text instead.

**"Replace All changed fewer/more entries than I expected."**
Find & Replace is scoped to the **currently selected group** (the whole library
when **📚 Library** is selected), and the **Field** dropdown limits which field is
searched. Run the **Find** preview first to see exactly which entries and fields
will change, and check both controls.

## See also

- [Getting Started](01-getting-started.md)
- [Browsing & Searching](02-browsing-and-searching.md)
- [Attachments](04-attachments.md)
- [Notes & Abstracts](05-notes-and-abstracts.md)
- [Preview & Citations](06-preview-and-citations.md)
- [Importing & Exporting](07-importing-and-exporting.md)
- [Online Search](08-online-search.md)
- [Shortcuts & Reference](09-shortcuts-and-reference.md)
