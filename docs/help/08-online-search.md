# Online Search

Sooner or later you need a reference you don't yet have: a paper a colleague
mentioned, the canonical version of a preprint, or the full bibliographic
record behind a bare DOI. **Online search** lets you query established
bibliographic databases from inside Bibliofile and pull results straight
into your open library as new entries — no web browser, no copy-and-paste, and
no hand-typing of author lists. It is the fourth of the ways to bring references
in; the other three (pasting BibTeX, drag-and-drop, and importing from a file)
are covered in [Importing & Exporting](07-importing-and-exporting.md).

This chapter explains what the two built-in sources cover, how to run and read
a search, exactly which fields each source captures when you import, what
happens to an imported entry afterwards, and how to recover when a search
doesn't behave.

![Editor with a formatted citation](../viewer-citation.png)

> **Note:** Online search **adds** entries to whichever library you currently
> have open. It never replaces or merges existing entries, and — like every
> other edit in the app — nothing is written to disk until you **Save**. See
> [Saving an imported entry](#saving-an-imported-entry) below.

## Opening online search

Online search lives in a modal window you can summon two ways.

1. Open a library, or make sure one is already open. (Search has nowhere to
   import to without an open document.)
2. Either click the **🌐 Online…** button in the toolbar above the three panes,
   or choose **File → Import → Search Online (CrossRef / arXiv)…**
   (**⇧⌘O** / **Shift+Ctrl+O**).
3. The **Online search** window opens on top of your library.

To dismiss the window at any time, click the **×** in its header or click the
dimmed area outside it. Closing the window does **not** discard entries you
already imported — those are now part of your library (still unsaved).

## The two sources

The **source** dropdown at the top-left of the search bar chooses where your
query is sent. Two sources are built in, and they cover complementary parts of
the literature.

| | **CrossRef** | **arXiv** |
| --- | --- | --- |
| **What it indexes** | Formally *published* works registered with a DOI: journal articles, conference papers, book chapters, whole books, reports, dissertations, datasets, and more | *Preprints* (and some published versions) in physics, mathematics, computer science, quantitative biology, statistics, economics, and related fields |
| **Best for** | The version of record; anything with a DOI | The freely available manuscript, often before (or alongside) journal publication |
| **Query styles that work well** | Free-text **title** words, **author** surnames, or a complete **DOI** pasted verbatim | Free-text terms — words from the **title**, **author** names, or topic keywords |
| **Imported entry type** | Mapped from the work type (article, book, inproceedings, incollection, phdthesis, techreport, misc, …) | Always `article` |
| **Identifier captured** | `Doi` (plus a `https://doi.org/…` `Url`) | `Eprint` (the arXiv id) + `Archiveprefix = arXiv`; a `Doi` too if arXiv lists one |
| **Abstract captured** | No | Yes (from the arXiv summary) |

> **Tip:** If a work exists in both places, the two sources give you a choice.
> Import from **CrossRef** when you want the citable version of record (DOI,
> volume, pages); import from **arXiv** when you want the eprint id and the
> abstract. There's nothing stopping you importing both and merging by hand.

### CrossRef in depth

CrossRef is the DOI registration agency for most of scholarly publishing, so it
is the right source for anything that has been formally published. A CrossRef
query is sent as a general free-text search, which means you can mix title words
and author names in one box and let the service rank the matches.

CrossRef also understands a **DOI** as a query. If you already have the DOI —
say from a reference list or a publisher's page — paste it in to pull up that
exact work. For example:

```
10.1103/PhysRev.47.777
```

The work's BibTeX *entry type* is derived from CrossRef's own classification of
the item. A journal article becomes `article`, a conference paper becomes
`inproceedings`, a book chapter becomes `incollection`, books become `book`, a
dissertation becomes `phdthesis`, a report becomes `techreport`, and posted
content or datasets fall back to `misc`. Anything unrecognised defaults to
`article`.

### arXiv in depth

arXiv is the open-access preprint server for the physical and computational
sciences. An arXiv query is a free-text search across all fields, so words from
the title, an author's name, or topic terms all work. Results are preprints, so
every imported arXiv entry is typed as `article` and carries the arXiv
identifier rather than a journal reference.

> **Note:** arXiv results record the **eprint id** and `Archiveprefix = arXiv`,
> which is exactly what the common `\eprint`/`\archivePrefix` BibTeX/`biblatex`
> machinery expects. They do **not** carry a journal, volume, or page range,
> because a preprint hasn't got one — if the paper was later published, you may
> want to add those by hand (or re-import the published record from CrossRef).

## The search workflow

The search bar has three controls, left to right: the **source** dropdown, the
**query** box, and the **Search** button.

1. **Pick a source** from the dropdown — **CrossRef** (the default) or
   **arXiv**.
2. **Type your query** into the box labelled **"Search title, author, DOI…"**.
3. **Run the search.** Click **Search**, or simply press **Enter** while the
   cursor is in the query box.

While the request is in flight the button label changes to **Searching…** and
is disabled so you can't fire a second request on top of the first. When the
results arrive, the list below the bar is populated; if anything goes wrong, an
error message appears there instead (see [Troubleshooting](#troubleshooting)).

> **Note:** Each search returns up to **20** results — the most relevant matches
> as ranked by the source. If what you want isn't in the list, refine your query
> (add an author surname, a distinctive title word, or the year) and search
> again. A fresh search **replaces** the previous results.

> **Tip:** An empty or whitespace-only query does nothing — the app simply
> ignores it. Type something before pressing **Enter** or **Search**.

### Reading a result

Each result is shown as a compact row with two lines of text and an action
button:

- **Line 1 — the title** of the work (or `(untitled)` if the source returned
  none).
- **Line 2 — the citation line:** the **authors**, the **year**, and the
  **venue** (journal or book title), joined by middle dots ( · ). When the work
  has a **DOI**, it is appended to the end of the same line.

So a CrossRef hit might read:

```
Can Quantum-Mechanical Description of Physical Reality Be Considered Complete?
A. Einstein, B. Podolsky, N. Rosen · 1935 · Physical Review · 10.1103/PhysRev.47.777
```

Any piece that the source didn't supply is simply left out of the line — a
preprint with no venue, for instance, shows just authors and year.

## Importing a result

To bring a result into your library, click its **Import** button.

When you do, the app:

1. Creates a **new entry** of the appropriate type from the result's fields.
2. Generates a **cite key** automatically (see below) and guarantees it is
   unique within the library.
3. Appends the entry to your library and **selects it**, so it appears in the
   detail pane on the right ready for review.
4. Marks the library **unsaved** (the **Save** button shows its unsaved-changes
   dot).

The button for that result then changes to **Imported** and is disabled, so you
can see at a glance which results you've already taken. You may import as many
results from a single search as you like — each becomes its own entry.

> **Note:** Importing the *same* result twice (across two separate searches) is
> not prevented and will create two entries. See
> [Duplicate awareness](#duplicate-awareness) below.

### Fields captured on import

Only the fields the source actually provides are written; blank values are
dropped. The mapping is deterministic, so you always know what you're getting.

**From CrossRef:**

| BibTeX field | Source |
| --- | --- |
| `Author` | Author list, formatted `Family, Given and Family, Given …` |
| `Title` | Work title |
| `Year` | Publication year |
| `Journal` *or* `Booktitle` | The container title — `Journal` for an `article`, `Booktitle` otherwise |
| `Volume` | Volume |
| `Number` | Issue |
| `Pages` | Page range, normalised to a BibTeX en-dash (`120-135` → `120--135`) |
| `Publisher` | Publisher |
| `Doi` | The DOI |
| `Url` | `https://doi.org/<doi>` (only when a DOI is present) |

**From arXiv:**

| BibTeX field | Source |
| --- | --- |
| `Title` | Article title (whitespace collapsed) |
| `Author` | Author list, joined with ` and ` |
| `Year` | Year from the publication date |
| `Eprint` | The arXiv identifier (e.g. `2401.01234`) |
| `Archiveprefix` | The literal string `arXiv` |
| `Abstract` | The arXiv summary (whitespace collapsed) |
| `Url` | The arXiv abstract-page URL |
| `Doi` | The DOI, *if* arXiv lists one for the paper |

> **Tip:** The imported **`Abstract`** from arXiv is plain text, but the
> detail pane renders abstracts as Markdown — so any `$…$` math the abstract
> contains will typeset, and you can add Markdown formatting later. See
> [Notes & Abstracts](05-notes-and-abstracts.md).

### How the cite key is generated

You don't type a cite key when importing — the app derives one for you using the
same generator as the **Generate** button in the editor, based on the entry's
author and year (the standard BibDesk default format). If that key would clash
with an entry already in the library, the app appends `-1`, `-2`, and so on
until the key is unique. (If no usable key can be generated — for a result with
no author or year, say — the entry keeps a provisional `imported` key, which you
should rename.)

You can change the cite key afterwards like any other: see
[Editing Entries → Cite key and type](03-editing-entries.md#cite-key-and-type).

## Refining an imported entry

Treat an imported entry as a solid **starting point**, not a finished record.
Online metadata is often imperfect — a title may be in ALL CAPS, an author's
given name may be initials only, a venue may be abbreviated, or a field you care
about may be missing entirely. Because the entry is selected the moment you
import it, the detail pane is right there for cleanup:

- **Tidy the fields** — fix capitalisation, expand abbreviations, add a missing
  `Publisher` or `Address`.
- **Set the cite key** to your preferred convention, or click **Generate**.
- **Change the entry type** if the source guessed wrong.
- **Add attachments, notes, or keywords** as you would for any entry.

All of this is covered in [Editing Entries](03-editing-entries.md),
[Attachments](04-attachments.md), and
[Notes & Abstracts](05-notes-and-abstracts.md).

### Saving an imported entry

Imports live **in memory** until you save, exactly like manual edits. The
**Save** button shows its unsaved-changes dot while imports are pending.

- Press **⌘S** (macOS) / **Ctrl+S** (Windows/Linux), or click **Save** in the
  toolbar, to write the new entries into your `.bib` file.
- As with every save, the app first copies the previous version of the file to
  `<your-file>.bib.bak`, then writes atomically. See
  [Editing Entries → What a save does](03-editing-entries.md#what-a-save-does-step-by-step).

> **Warning:** If you import several entries and then quit without saving, those
> entries are lost — there is no autosave unless you have turned it on in
> Preferences. Get into the habit of saving after a round of imports.

## How it works

A short explanation that also explains the design's strengths and limits:

- **Searches run in the app's main process, not a browser.** When you press
  **Search**, the renderer hands the request to the Electron main process, which
  makes the HTTP request to CrossRef or arXiv directly. Running the request
  there sidesteps the browser's **CORS** restrictions, which would otherwise
  block a renderer-side `fetch` to those services.
- **The responses are parsed natively.** CrossRef returns JSON and arXiv returns
  an Atom XML feed; the app parses each into the same normalised result shape
  before it ever reaches the search window. That's why both sources present and
  import identically from your point of view.
- **An internet connection is required.** There is no offline cache of search
  results. If the machine is offline, or the service is unreachable, the search
  fails with an error (handled gracefully — see below).
- **The app identifies itself politely.** Requests are sent with a descriptive
  `User-Agent`, the courteous convention these public APIs ask for.

## Duplicate awareness

Online search does **not** check whether a result already exists in your
library before importing it. The only de-duplication is the **Imported** flag,
and that lasts only for the *current* set of results — start a new search and
the flags reset. Practical consequences:

- Re-importing the same paper produces a second entry. The two will get
  *different* cite keys (the second is suffixed `-1`, `-2`, …) precisely because
  the app refuses to reuse a cite key, but they are otherwise duplicates.
- Before importing, it's worth a quick check of your library. Close the search
  window momentarily, type a title word or the DOI into the main
  [search box](02-browsing-and-searching.md#23-live-search), and confirm you
  don't already have it.
- If you do end up with duplicates, delete the extra with **🗑 Delete** (see
  [Editing Entries](03-editing-entries.md#entry-lifecycle-new-duplicate-delete)),
  or run **Publication → Find Duplicates…** to catch them in bulk (see
  [Browsing & Searching](02-browsing-and-searching.md#26-finding-duplicates)).

## Troubleshooting

**"Enter a query and press Search." never goes away.**
That placeholder shows whenever there are no results yet and no error. Make sure
you actually typed a query (whitespace alone is ignored) and pressed **Enter**
or clicked **Search**.

**The search returns nothing (an empty list).**
The source ran but matched no works. Broaden or correct the query: check
spelling, drop overly specific words, try an author surname plus one title word,
or switch sources — a preprint may be on arXiv but not (yet) in CrossRef, and an
old book may be in CrossRef but never on arXiv.

**An error message appears below the bar.**
This is almost always **connectivity**. Confirm you're online and try again. A
corporate proxy, firewall, or VPN can block the outbound request even when other
apps seem fine. Transient `HTTP` errors from the service (a `5xx`, or a rate
limit if you search very rapidly) usually clear if you wait a few seconds and
retry.

**Rate limits / "slow down".**
Both services are free and shared. If you fire many searches in quick
succession you may be throttled temporarily. Space your searches out and the
limit lifts on its own; there's nothing to configure.

**A DOI search finds nothing on CrossRef.**
Paste the **bare** DOI (for example `10.1103/PhysRev.47.777`), not a full
`https://doi.org/…` URL or a publisher page URL. Check for stray spaces or a
trailing punctuation mark copied along with it.

**I imported, but the entry isn't in my file.**
Imports are unsaved until you write them. Press **⌘S** / **Ctrl+S** (or click
**Save**). If the **Save** button still shows its unsaved dot, the write hasn't
happened yet.

**A field I expected is empty.**
The source didn't supply it, and the app only writes fields it receives. Add the
missing field by hand in the detail pane — see
[Editing Entries → Adding a field](03-editing-entries.md#adding-a-field).

## See also

- [Editing Entries](03-editing-entries.md) — clean up and complete an imported
  record.
- [Browsing & Searching](02-browsing-and-searching.md) — check for an existing
  copy before you import.
- [Attachments → Finding open-access PDFs](04-attachments.md#finding-open-access-pdfs)
  — another online lookup: find and attach a legal OA PDF for entries you already have.
- [Notes & Abstracts](05-notes-and-abstracts.md) — the arXiv abstract is
  Markdown-rendered in the preview.
- [Shortcuts & Reference](09-shortcuts-and-reference.md) — the **Save** shortcut
  and the field reference.
