# bibdesk-electron Help

Welcome to the **bibdesk-electron** manual. bibdesk-electron is a
cross-platform, desktop bibliography manager for your `.bib` (BibTeX) research
libraries — a fresh Electron rewrite of the classic
[BibDesk](https://bibdesk.sourceforge.io/). It gives you a friendly three-pane
window for browsing, searching, grouping, and editing references, a beautiful
themed preview with rendered math and formatted citations, file attachments,
Markdown notes, and the ability to pull new references from online databases —
all while keeping your plain-text `.bib` file as the single source of truth.

This manual is organised as a sequence of chapters. If you're new, read them in
order from **Getting Started**; otherwise jump straight to the topic you need.

## Table of contents

1. **[Getting Started](01-getting-started.md)** — What the app is, opening a
   library, and a tour of the three-pane window (groups sidebar, publications
   table, detail pane), the header, the toolbar, and light/dark themes.
2. **[Browsing & Searching](02-browsing-and-searching.md)** — Reading and
   sorting the publications table, the configurable columns (the **View →
   Columns** menu and the Preferences manager, including the keyword/attachment/
   Read icon columns), filtering with the live search box, **Find Duplicates**,
   and narrowing your view with the groups sidebar (Library, Static/Smart groups,
   and dynamic Author/Keyword categories).
3. **[Editing Entries](03-editing-entries.md)** — The detail pane as a full
   editor: changing fields (with field-value autocomplete), cite keys, and entry
   types; adding, duplicating, and deleting entries; **Generate cite key**;
   **Find & Replace** across fields; the **Copy** clipboard commands and cite
   drag-out; `Crossref` inheritance; the `@string` macro editor; and explicit
   save.
4. **[Attachments](04-attachments.md)** — Attaching, opening (in your OS default
   apps), and removing files; the **Links** section for `Url`/`Doi`; **AutoFile**
   into a Papers folder; how `Bdsk-File-N` links and relative paths work; keeping a library portable; and
   macOS BibDesk compatibility.
5. **[Notes & Abstracts](05-notes-and-abstracts.md)** — Writing abstracts and
   per-entry notes in Markdown (with math), plus notes-only extras: `[[citeKey]]`
   cross-references between entries and inline iframe embeds.
6. **[Preview & Citations](06-preview-and-citations.md)** — The typeset preview
   card (title, venue, chips, keyword tags, rendered abstract) and the live,
   formatted CSL citation block (APA / Vancouver / Harvard), in light or dark
   mode; plus the **Copy Citation** and **Copy as BibTeX** clipboard commands.
7. **[Importing & Exporting](07-importing-and-exporting.md)** — Getting
   references in (pasting BibTeX, drag-and-drop, and **File → Import** for BibTeX
   and RIS files) and out (**File → Export** to BibTeX / RIS / CSV / a styled
   HTML bibliography).
8. **[Online Search](08-online-search.md)** — Searching CrossRef and arXiv from
   inside the app and importing results as new entries: the workflow, the fields
   each source captures, and troubleshooting.
9. **[Shortcuts & Reference](09-shortcuts-and-reference.md)** — The complete
   menu-bar, keyboard-shortcut, and mouse-action reference, the file format and
   on-save normalisations, where each kind of data is stored, a special-field
   reference, citations, current limitations, a glossary, and general
   troubleshooting.

## Conventions used in this manual

- **Key notation.** Keyboard shortcuts are shown for both platforms, macOS
  first: **⌘O** / **Ctrl+O**. ⌘ is the macOS Command key; on Windows and Linux
  the equivalent is **Ctrl**. **⇧** is Shift, **⌥** is Option/Alt — so
  **⇧⌘I** / **Shift+Ctrl+I** is Shift+Command+I (macOS) or Shift+Ctrl+I
  (Windows/Linux), and **⌥⌘F** / **Alt+Ctrl+F** is Option+Command+F or
  Alt+Ctrl+F. **Enter** is the Return/Enter key.
- **Menu paths** are written with arrows: **File → Import → From File…** means
  the *From File…* item in the *Import* submenu of the *File* menu.
- **Interface labels** — buttons, menus, fields, and on-screen text — are in
  **bold**: the **🌐 Online…** button, the **Save** button, the `Author` field.
- **Literal text** you type or that appears in your file — cite keys, field
  values, file names, BibTeX — is in a `monospace` font, for example the cite
  key `einstein1935` or the field `Bdsk-File-1`.
- **Callouts** highlight things worth pausing on:

  > **Note:** Extra context or a clarification.

  > **Tip:** A shortcut, or a faster way to do something.

  > **Warning:** Something that can cost you data or time if you ignore it.

- **Cross-references** appear as links, like
  [Getting Started](01-getting-started.md), and point to the relevant chapter.

> **Tip:** Throughout the app and this manual, remember the golden rule: your
> `.bib` file is the single source of truth, and **edits are not written until
> you save** (**⌘S** / **Ctrl+S**). There is no autosave by default (you can turn
> one on in Preferences).

## Getting started quickly

1. Choose **File → Open** (**⌘O** / **Ctrl+O**) and pick a `.bib` file.
2. Click a row to inspect an entry; click a column header to sort; type in the
   search box to filter.
3. Edit fields right in the detail pane, then press **⌘S** / **Ctrl+S** to save.

For the full tour, start with **[Getting Started](01-getting-started.md)**.
