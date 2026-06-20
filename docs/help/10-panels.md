# Configurable Panels

bibdesk-electron's window is built from panels you can **resize, hide, and
switch**. This chapter covers the side (detail) panel, the bottom panel, the
content each can show — the read-only **Details** view, the **🤖 Claude**
assistant, the annotation reader, and the **LaTeX preview** — how working with a
multi-row selection changes both panels, and where to design your own panels.

## Resizing, hiding, and switching the side panel

The right-hand **detail pane** is fully adjustable:

- **Resize** — drag the divider between the publications table and the detail
  pane left or right.
- **Hide / show** — **View → Toggle Side Panel** (**⌘⌥S** / **Ctrl+Alt+S**), or
  click the **×** in the pane's header.
- **Switch content** — the pane's header has a **content dropdown** (currently
  offering just **Details**) **plus** a dedicated **🤖 Claude** toggle button.
  Click **🤖 Claude** to use the assistant right inside the pane; click it again
  (or pick **Details** from the dropdown) to swap back.

> **Note:** The side-pane control is a **dropdown + a Claude button**, not a pair
> of tabs. The dropdown lists the available detail content (just **Details**
> today, with room to grow), while the assistant — which you flip in and out of
> frequently — keeps its own one-click button.

All of this is remembered across launches.

## The bottom panel

Open it with **View → Toggle Bottom Panel** (**⌘⌥B** / **Ctrl+Alt+B**). The
bottom panel is a wide, selection-driven reader whose content you pick from the
**content dropdown** in its header. It offers two views:

- **Annotation** (the default) — the selected entry's annotation in a wide,
  comfortable-to-read format (handy for long notes that feel cramped in the
  narrow side pane). Nothing selected shows a short hint.
- **LaTeX Preview** — a true BibTeX/`.bst` typesetting of the selected entries'
  bibliography (see [LaTeX preview](#latex-preview) below).

Drag its top edge to resize, and click **×** to hide.

## Switching panel content

There are two ways to choose what each pane shows.

**The in-pane dropdowns.** Both pane headers carry a small **Panel content**
dropdown (a `<select>`): the side pane's lists **Details**, and the bottom
pane's switches between **Annotation** and **LaTeX Preview**. Use these when you
want to flip content without leaving the mouse. The side pane additionally has
the standalone **🤖 Claude** button described above.

**The View menu.** The same switches live in the menu bar, each with a keyboard
shortcut:

| Menu item | Shortcut | Shows |
| --- | --- | --- |
| **View → Side Panel → Details** | **⌘⌥1** / **Ctrl+Alt+1** | The read-only detail view in the side pane |
| **View → Side Panel → Claude** | **⌘⌥2** / **Ctrl+Alt+2** | The 🤖 Claude assistant in the side pane |
| **View → Bottom Panel → Annotation** | **⌘⌥3** / **Ctrl+Alt+3** | The annotation reader in the bottom panel |
| **View → Bottom Panel → LaTeX Preview** | **⌘⌥4** / **Ctrl+Alt+4** | The LaTeX preview in the bottom panel |

Choosing any of these also **reveals** the relevant panel if it was hidden, so a
single shortcut both shows the panel and selects its content.

> **Tip:** The Claude assistant has a second home: **Tools → Claude Assistant…**
> (**⌘J** / **Ctrl+J**) opens it in the side pane just like **⌘⌥2**.

## LaTeX preview

The bottom panel's **LaTeX Preview** typesets your library's bibliography
exactly the way LaTeX would — running your **local TeX installation** over the
selected entries with a real BibTeX `.bst` style. It is the companion to the
live CSL citation block in the detail pane (see
[Preview & Citations](06-preview-and-citations.md)): where that block is a
copy-ready CSL rendering, the LaTeX preview is what `bibtex` itself produces for
the `.bst` you cite with in your paper.

Show it from the bottom-pane dropdown, from **View → Bottom Panel → LaTeX
Preview** (**⌘⌥4** / **Ctrl+Alt+4**), or from **Tools → LaTeX Preview** (which
opens the bottom panel and switches it to the preview).

### What it renders, and how

- **A small selection renders as crisp, theme-aware inline SVG.** When you have
  selected roughly **20 entries or fewer** (and the `dvisvgm` tool is present in
  your TeX install), the bibliography is traced to vector **SVG** that inherits
  the pane's text colour — so it stays sharp at any zoom and recolours to match
  light or dark mode.
- **The whole library and larger selections render as a PDF.** With more entries
  selected — or with nothing selected, which previews the **entire library** —
  the bibliography is compiled to a **PDF** and shown page by page (rendered with
  PDF.js). One rasterised page scales better than dozens of inline SVGs.
- **It auto-refreshes from the selection.** The preview renders as soon as you
  open it and then re-renders automatically (debounced, so arrow-keying through
  rows doesn't spawn a run per row) every time the selection changes. There is no
  manual refresh button.

### Setting the style and finding TeX

The BibTeX style is a preference: set **BibTeX style (.bst)** under
**Preferences → Citations** (for example `plain`, `abbrv`, or `ieeetr`). If your
TeX binaries aren't on the system `PATH`, set the **TeX bin directory** there too
(for example `/Library/TeX/texbin`); leave it empty to search `PATH` and the
common install locations.

### When TeX isn't available, or a compile fails

The preview needs a working TeX distribution — **MacTeX**, **TeX Live**, or
**MiKTeX**. The pane reports its state inline:

- **Nothing selected** — a hint inviting you to select one or more publications.
- **No TeX found** — a message explaining that no LaTeX installation was found
  and pointing you to install one or set the **TeX bin directory** in
  **Preferences → Citations**.
- **A compile error** — the first few LaTeX error lines, so you can see what went
  wrong (a common cause is a `.bst` style name that isn't installed).

> **Note:** The LaTeX preview is **not** the CSL citation. The CSL block (APA /
> Vancouver / Harvard) is independent of LaTeX's `.bst` system — see
> [Preview & Citations → Limitations](06-preview-and-citations.md#limitations-and-honest-notes).
> Use the LaTeX preview when you want to see exactly what `bibtex` will make of
> your entries in a document.

## Working with multiple selected entries

Selecting **two or more rows** in the table (Cmd/Ctrl-click to add a row,
Shift-click for a range, **⌘A** / **Ctrl+A** for all) switches **both** the
detail pane and the bottom panel into a **multi-select view** instead of the
single-entry view.

Each multi-select view opens with a sticky **"Multiple entries selected (N)"**
indicator, where *N* is the number of selected entries, above a **scrollable
list**: in the detail pane, each entry's preview; in the bottom panel, each
entry's annotation. The list shows up to **50** entries; beyond that a final
**"+N more not shown"** line tells you how many were elided.

### Batch tools (detail pane)

At the top of the multi-select **detail pane**, below the indicator, is a small
**batch-tools** bar that applies one change to the **whole selection** in a
**single undo step**:

| Tool | What it does |
| --- | --- |
| **Set field** | Type a field name and a value, then **Set field** to write that field on every selected entry |
| **Add keyword** | Type a keyword and **Add keyword** to add it to every selected entry's `Keywords` |
| **Remove keyword** | Type a keyword and **Remove keyword** to strip it from every selected entry |

Because each batch operation is a single undoable step, you can apply one and
then **Edit → Undo** (**⌘Z** / **Ctrl+Z**) to back it all out at once.

### Deleting a selection

There is **no delete button** in the multi-select view. To delete the selected
entries, either press the **Delete** or **Backspace** key with the table focused,
or right-click the selection and choose **Delete N entries** (see below). A
deletion is one undo step, so **Edit → Undo** restores the whole batch; and
because nothing is written to disk until you **Save**, a mistaken deletion before
saving is recoverable by reverting (**File → Revert to Saved**). See
[Editing Entries](03-editing-entries.md#-delete).

> **Tip:** A right-click on a row **outside** the current selection first selects
> just that row, then acts on it — so you can colour-label or delete a single
> entry without disturbing a multi-selection elsewhere.

## The row context menu

Right-clicking a row in the publications table opens a compact **context menu**
with:

- A horizontal row of **colour-label dots** (plus a **✕** that clears the
  label) — picking one applies that colour to the selection, mirroring the
  **Publication → Color Label** submenu.
- A **Delete entry** (or **Delete N entries**, when several are selected) item
  that removes the selection — the same undoable delete as the **Delete** /
  **Backspace** key.

Press **Escape** or click anywhere outside to dismiss the menu.

## Designing your own panels

Both the detail pane and the bottom panel are rendered from **Handlebars
templates**, and you can fork and replace either with your own — with custom
context fields, helpers, live widgets, and interactive hooks. That is a topic in
its own right.

> **See:** [Customizing Panels & Outputs](11-customizing-panels.md) — designing
> your own panel and output templates with Handlebars, including the context
> fields, helpers, live widgets, interactive hooks, and worked examples.

## See also

- [Preview & Citations](06-preview-and-citations.md) — the detail pane's preview
  card and the live CSL citation block that the LaTeX preview complements.
- [Customizing Panels & Outputs](11-customizing-panels.md) — Handlebars templates
  for your own panels and exports.
- [Editing Entries](03-editing-entries.md) — the entry lifecycle, including
  deleting entries and undo.
- [Shortcuts & Reference](09-shortcuts-and-reference.md) — the full menu, keyboard,
  and mouse reference (including the panel shortcuts above).
