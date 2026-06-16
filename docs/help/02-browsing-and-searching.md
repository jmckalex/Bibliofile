# Browsing & Searching

This chapter is about *finding your way around* an open library. It covers the
three tools you use to locate and focus on references: the **publications
table** in the center, the **live search** filter in the header, and the
**groups sidebar** on the left. It explains not only how to use each one, but how
each works underneath — what is matched, how sorting and counting behave, where
the groups come from, and how they combine — so that you can predict the
application's behaviour rather than guess at it.

If you have not opened a library yet, start with
[Getting started](01-getting-started.md).

## 2.1 How browsing works (the mental model)

Three independent controls determine which rows you see and in what order:

1. **The selected group** (sidebar) sets the *scope* — which subset of the
   library is in play (the whole Library, a saved group, or one author/keyword
   category).
2. **The live search** (header) applies a *text filter* within that scope.
3. **The sort** (table header) sets the *order* of whatever survives the first
   two.

The footer always reports the net result: the active group's name and the row
count, adjusted for any live search. Keeping this three-control model in mind
makes everything below predictable. The rest of the chapter takes each control
in turn.

## 2.2 The publications table

The center pane lists your references, one per row.

![Library view with the publications table and sidebar](../viewer-category-groups.png)

### 2.2.1 The columns

There are five columns. Each is *derived* from your entry's BibTeX fields and
formatted for reading — the table never shows raw, brace-cluttered BibTeX.

| Column | What it shows | Where it comes from |
| --- | --- | --- |
| **Cite Key** | The entry's citation key, in a monospaced font. | The entry's BibTeX key, e.g. `einstein1905`. |
| **Type** | The entry type. | The BibTeX entry type, normalised to lower case, e.g. `article`, `book`, `inproceedings`. |
| **Authors** | A readable author list. | Parsed from the `Author` field (falling back to `Editor` when there are no authors); names are formatted and joined, with a trailing **et al.** when the field ended in `and others`. |
| **Title** | The title, cleaned for display. | The `Title` field, *de-TeXified* and stripped of BibTeX protective braces. |
| **Year** | The publication year. | The `Year` field. |

A few details worth knowing about how the values are produced:

- **De-TeXifying titles.** TeX escapes are converted to their Unicode
  equivalents and BibTeX *protective braces* are removed for display. For
  example a stored title `{C}alabi--{Y}au manifolds` is shown as
  `Calabi–Yau manifolds`, and `{{Higgs boson}}` is shown as `Higgs boson`. The
  brace-stripping is **math-aware**: braces inside a `$…$` or `$$…$$` math span
  are preserved, so a title like `The $\frac{1}{2}$-spin case` keeps its math
  intact.

  ```bibtex
  @article{nakahara,
    author = {Nakahara, Mikio},
    title  = {{C}alabi--{Y}au {M}anifolds and Mirror Symmetry},
    year   = {2003}
  }
  ```
  This entry appears in the table as **Cite Key** `nakahara`, **Type**
  `article`, **Authors** `Mikio Nakahara`, **Title**
  `Calabi–Yau Manifolds and Mirror Symmetry`, **Year** `2003`.

- **Author formatting and "et al."** Names from the `Author` field are parsed
  into their components and rendered in a consistent display form; multiple
  authors are joined with commas and a final "and" (e.g.
  `A. Einstein, B. Podolsky and N. Rosen`). If the field is written with
  `and others`, the display ends in **et al.** When an entry has no `Author`
  field, the `Editor` field is used instead.

> **Note:** The columns are fixed in this version (Cite Key, Type, Authors,
> Title, Year). User-customisable and additional columns — ratings, file badges,
> colour labels, and so on — are planned but not yet available.

### 2.2.2 Column widths

The **Cite Key**, **Type**, and **Year** columns have fixed widths and do not
shrink, so the narrow Year and Type columns never collapse or truncate. The
**Authors** and **Title** columns *grow* to absorb the remaining horizontal
space, since they hold the longest text.

### 2.2.3 Sorting

Click any **column header** to sort the table by that column.

- The **first click** on a header sorts **ascending** by that column.
- Clicking the **same header again** flips the direction to **descending**.
- A small **▲** (ascending) or **▼** (descending) arrow appears on the active
  column to show the current direction.
- Clicking a *different* header sorts by the new column, starting again at
  **ascending**.

The default sort, on first opening a library, is **Cite Key, ascending**.

#### How the sort behaves

Sorting is a **case-insensitive, numeric-aware string comparison**. Two practical
consequences:

- Case does not matter: `Apple` and `apple` sort together rather than in two
  separate alphabetical runs.
- Numeric runs sort by *value*, not by character. So years and numbered keys
  sort `2`, `9`, `10` rather than the naïve `10`, `2`, `9`.

Every column sorts as text by this rule, including **Year** — which is fine
because years are numeric strings and the numeric-aware comparison orders them
correctly.

> **Note:** Sorting on a single column at a time is supported today. Multi-column
> ("sort by year, then by author") sorting is planned but not yet available.

### 2.2.4 Virtualization (why the table stays fast)

The table is **virtualized**: only the rows currently visible in the viewport
(plus a small overscan buffer just above and below) are actually rendered into
the window. As you scroll, rows are recycled. This is why the table stays smooth
and responsive even with very large libraries of thousands — or tens of
thousands — of entries: the cost of drawing the table depends on the *size of the
window*, not on the *size of the library*.

The whole list is still loaded into memory and is fully searchable and sortable;
virtualization affects only what is drawn, not what is available.

> **Tip:** Because rows are recycled as you scroll, the scrollbar reflects the
> *full* list height — drag it to jump anywhere in a long library instantly.

### 2.2.5 Selection and viewing details

**Click a row** to select it. The selected row is highlighted, and its full
details load into the right-hand pane: a typeset entry card showing the title,
authors, venue, keyword tags, abstract, clickable DOI/URL/attachment links,
rendered math, notes, and a formatted citation. Selecting an entry is also the
gateway to editing it.

For everything you can see and do in that pane, see
[Preview & citations](06-preview-and-citations.md),
[Editing entries](03-editing-entries.md),
[Attachments](04-attachments.md), and
[Notes & abstracts](05-notes-and-abstracts.md).

> **Tip:** Notes can contain `[[citeKey]]` cross-reference links. Clicking one
> jumps the selection to the linked entry — and if that entry is not in the
> current group's view, the application automatically switches back to the full
> Library so it can be selected. See [Notes & abstracts](05-notes-and-abstracts.md).

## 2.3 Live search

Use the **search box** at the top-right of the window — the one labelled
**"Filter publications…"** — to filter the table as you type.

1. Click in the search box (it appears only when a library is open).
2. Start typing.

The list narrows **instantly**, with no separate "search" button to press. Clear
the box to see everything again.

### 2.3.1 What is matched

The search is a **case-insensitive substring** match. For each row, the
application checks whether your text appears *anywhere* in the combination of all
five displayed columns:

> **Cite Key** · **Type** · **Authors** · **Title** · **Year**

Because it matches across all of those fields at once:

- Typing `quantum` finds the word in any **title**.
- Typing an author's surname finds **their papers** (matching the Authors
  column).
- Typing `article` finds every entry of that **type**.
- Typing `2019` finds entries from that **year** — and also any cite key or
  title that happens to contain "2019".
- Typing part of a **cite key** (e.g. `einstein`) finds it directly.

It is a *substring* match, not a word match: `ein` matches both `Einstein` and
`protein`. And it is case-insensitive: `QUANTUM`, `Quantum`, and `quantum` are
equivalent.

> **Note (how search actually works):** The app now ships a SQLite-backed
> **FTS5 full-text search**. When you type, it queries an index of **all** field
> text — including abstracts, notes, and keywords, not just the five visible
> columns — **plus the text extracted from attached PDFs**. Results are ranked by
> relevance (best matches first) and matched by word prefix, so `bargain` finds
> *bargaining*. The index is an in-memory, rebuildable cache (the `.bib` file
> stays the source of truth); PDF text is folded in shortly after a library opens.
>
> If the native search component isn't available for your build, the box
> automatically falls back to a plain **case-insensitive substring filter** over
> the five displayed columns — still useful, just not full-text. (Developers:
> enable FTS in a local build with `pnpm --filter @bibdesk/app rebuild:electron`.)

### 2.3.2 The "N of M rows" footer

As you type, the footer updates to tell you how much of the library is showing.
The label has two forms:

| Footer label | Meaning |
| --- | --- |
| `123 rows` | No search (or the search matched everything); the count is the full set for the current group. |
| `42 of 123 rows` | A search is narrowing the rows: **42** match out of **123** in the current scope. |

If a group is selected, its name is prefixed, e.g. `To read: 8 of 40 rows`.

> **Tip:** The footer is the single most useful indicator in the window. It
> answers "what am I looking at right now?" at a glance — the group scope, the
> matched count, and the total.

## 2.4 The groups sidebar

The left pane lets you focus on a *slice* of your library. Click any group to
scope the table to it; the footer then shows the group's name and row count.

![Category groups in the sidebar](../viewer-category-groups.png)

### 2.4.1 The kinds of group

The sidebar can show several kinds of group, each with its own icon. Some are
read from the `.bib` file; others are computed automatically.

| Icon | Kind | Source | What it is |
| --- | --- | --- | --- |
| 📚 | **Library** | Synthetic | Everything in the file. Always present at the top. Selecting it clears any group scope. |
| 📁 | **Static** | From the file | A hand-picked set of entries (BibDesk Static group). Membership is an explicit list of cite keys. |
| ⚙ | **Smart** | From the file | A rule-based group (BibDesk Smart group). Membership is computed from a saved set of conditions. |
| 🏷 | **Category** | Computed | A category *section* heading (the **Keywords** section), and individual keyword values. |
| 👤 | **Author** | Computed | An individual author value under the **Authors** section. |
| 🔗 | **URL** | From the file | A BibDesk URL group. Stored for fidelity but type-only here (see caveat below). |
| 📜 | **Script** | From the file | A BibDesk Script group. Stored for fidelity but type-only here (see caveat below). |

Each group row shows its **icon**, its **name**, and a **count** of how many
entries it contains.

### 2.4.2 The Library group

**📚 Library** sits at the top and represents the entire file. Click it at any
time to drop a group filter and return to seeing all entries. Its count is the
total number of entries in the library, which always matches the publication
count in the header.

### 2.4.3 Static and Smart groups (read from the file)

If your `.bib` file was saved by BibDesk (or by this application) with saved
groups, they appear here, read directly from the file's group `@comment` blocks:

- **📁 Static groups** are hand-picked collections — an explicit list of cite
  keys. Think "the papers I am citing in this chapter". Their count is the number
  of those keys that are actually present in the library.
- **⚙ Smart groups** are *rule-based*. Each carries a saved set of conditions
  (with comparisons such as "contains", "is", date windows, and so on) combined
  with **and**/**or**. Membership is *evaluated live* against your current
  entries, so a Smart group always reflects the present state of the library —
  if you edit an entry so that it now matches the rules, it joins the group
  automatically.

Selecting a Static or Smart group scopes the table to its members; the footer
shows the group's name and count.

> **Note:** This version *reads, evaluates, and counts* Static and Smart groups
> from the file, and round-trips them faithfully on save. Creating or editing
> groups from within the application's UI is planned but not yet available — for
> now, you manage group definitions in BibDesk (or by hand in the `.bib` file).

### 2.4.4 URL and Script groups (type-only)

**🔗 URL** and **📜 Script** groups are preserved faithfully in the file so that
your library round-trips without loss, and they appear in the sidebar for
completeness. However, because they would require live network fetches or running
an external script, they are **type-only** in this version: they are listed with
a count of 0 and do not currently populate the table with members.

### 2.4.5 The dynamic Author and Keyword categories

Below your saved groups, the sidebar builds two **category sections**
automatically from the library itself:

- **Authors** — one **👤** child per distinct author found across all entries.
- **Keywords** — one **🏷** child per distinct keyword found across all entries.

These are *dynamic*: they are computed from what is actually in your file, so
they always stay in sync — there is nothing to maintain by hand. They mirror
BibDesk's "category groups".

#### How they are computed and counted

- **Authors.** Every entry's parsed author names are collected. Authors are
  de-duplicated by a *normalised* form of the name (so the same person written
  slightly differently is grouped together where possible) and labelled with
  their readable display name. Each author child's **count** is the number of
  entries that list that author.
- **Keywords.** Each entry's `Keywords` field is split into individual tags on
  commas and semicolons. Keywords are de-duplicated **case-insensitively** (the
  first-seen capitalisation becomes the label). Each keyword child's **count** is
  the number of entries that carry that keyword.

  ```bibtex
  @article{epr1935,
    author   = {Einstein, A. and Podolsky, B. and Rosen, N.},
    title    = {Can Quantum-Mechanical Description Be Considered Complete?},
    keywords = {quantum mechanics, foundations, EPR},
    year     = {1935}
  }
  ```
  This single entry contributes to three **👤 Author** children (Einstein,
  Podolsky, Rosen) and three **🏷 Keyword** children (`quantum mechanics`,
  `foundations`, `EPR`), incrementing each of their counts by one.

The children within each section are sorted alphabetically by their display
label. The **section heading** itself (Authors / Keywords) also carries a count —
the number of *distinct entries* that have at least one author / at least one
keyword, respectively (an entry that lists three authors is still counted once
toward the Authors-section total).

> **Tip:** Because these categories are recomputed from the live library, they
> update automatically as you edit. Add a keyword to an entry and that keyword's
> category appears (or its count rises) the next time the sidebar refreshes after
> an edit.

### 2.4.6 The two-level tree

The sidebar is a **two-level tree**. Top-level rows are the Library, your saved
groups, and the category section headings (Authors, Keywords); the individual
authors and keywords are *children* indented beneath their section heading. There
is no deeper nesting — the structure is intentionally flat and fast to scan.

### 2.4.7 Selecting and clearing a group

- **Select** a group by clicking its row. The table immediately re-scopes to that
  group's members, and the footer shows the group name and count. The selected
  group is highlighted.
- **Clear** the group scope by clicking **📚 Library**, which returns you to the
  full set of entries.

When you add, duplicate, or delete an entry, the selection returns to the Library
scope, because such structural edits can change which dynamic categories exist.

## 2.5 Combining groups and search

The group filter and the live search are **independent and composable**, exactly
as the mental model in §2.1 describes:

1. **Pick a group** (say, a specific author, or a Smart group) to set the
   *scope*.
2. **Type in the search box** to filter *within* that scope.

For example: select the **👤 Einstein** author category to limit the table to
his papers, then type `1905` to narrow further to the ones from that year. The
footer will read something like `Einstein: 3 of 24 rows`, telling you the group,
the matched count, and the group total all at once.

Clearing either control is independent: clear the search box to drop the text
filter (keeping the group scope), or click **📚 Library** to drop the group scope
(keeping the search text).

## 2.6 Performance notes for large libraries

bibdesk-electron is built to handle large libraries comfortably:

- **The table is virtualized** (§2.2.4), so rendering cost scales with the
  window, not the library. Scrolling stays smooth at thousands of rows.
- **Live search uses an in-memory SQLite FTS5 index** built when the library
  opens, so even full-text queries (across every field and attached-PDF text)
  return in milliseconds and update as you type. The index lives in memory and is
  rebuilt on open — nothing is written to disk.
- **Category membership is precomputed.** When the Author/Keyword categories are
  built, each one's member set is computed up front, so selecting a category
  filters by a fast set-membership test rather than re-scanning every entry's
  fields.
- **Smart-group membership is evaluated on demand** against the current entries.
  This keeps Smart groups correct as you edit, at the cost of a scan when you
  select one — negligible for typical libraries.

> **Tip:** The **SQLite FTS5** full-text index makes deep queries — across every
> field and the text of attached PDFs — fast even on very large libraries. PDF
> text is extracted in the background just after a library opens, so PDF matches
> may appear a moment after the first results.

## 2.7 Tips

- **Combine a group with search.** Set the scope with a group, then refine with
  the search box. The footer shows both at once.
- **Watch the footer.** It is the authoritative answer to "what am I looking at?"
  — group name, matched count, and total.
- **Return to everything fast.** Click **📚 Library** to drop the group filter,
  and clear the search box to drop the text filter. They are independent.
- **Sort to scan.** Sort by **Year** to find recent work, or by **Authors** to
  group a person's papers together; click a header twice to reverse.
- **Use categories as a quick index.** The Author and Keyword sections are a
  free, always-current index into your library — no tagging discipline required
  beyond filling in the fields you already fill in.

## 2.8 Troubleshooting

- **"My search isn't finding a word that's in the abstract (or a PDF)."** Full-text
  search covers abstracts, notes, keywords, every other field, and attached-PDF
  text — so this should normally work. Two things to check: (1) PDF text is indexed
  in the background just after opening, so give it a moment on large libraries; (2)
  if your build is using the **substring fallback** (only the five visible columns),
  the native search component isn't active — rebuild it for the app with `pnpm
  --filter @bibdesk/app rebuild:electron`. Also remember search is scoped to the
  selected group; click **📚 Library** to search everything.
- **"A Smart group shows 0 (or fewer) entries than I expect."** Smart-group
  membership is evaluated against your *current* entries. Check that the entries
  you expect actually satisfy the group's conditions; if you have just edited
  fields, the count reflects the new values.
- **"A URL or Script group shows 0."** That is expected — URL and Script groups
  are preserved for fidelity but are type-only in this version and do not
  populate members (§2.4.4).
- **"I selected an author but a co-author's papers also show."** A category lists
  every entry that includes that author; if those papers are co-authored, they
  legitimately belong to that author's category. Use the search box to narrow
  further within the category.
- **"The row count in the footer doesn't match the header count."** The header
  count is always the *whole* library; the footer count reflects the current
  group and any active search. They agree only when the Library group is selected
  and the search box is empty.

## See also

- [Getting started](01-getting-started.md) — opening a library and the window
  anatomy.
- [Editing entries](03-editing-entries.md) — once you have found an entry, change
  it.
- [Preview & citations](06-preview-and-citations.md) — what the detail pane shows
  for a selected entry.
- [Notes & abstracts](05-notes-and-abstracts.md) — the `[[citeKey]]` notes links
  that jump the selection.
