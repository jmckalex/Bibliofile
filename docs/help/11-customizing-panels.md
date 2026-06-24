# Customizing Panels & Outputs

Bibliofile renders its **detail pane** and **bottom panel** from
[**Handlebars**](https://handlebarsjs.com/) templates, and lets you replace
either one with a template of your own. The same template engine also powers
your own **export formats** under **File → Export**. This chapter is the
complete reference for both: every field your template can read, every helper
and live widget it can use, every interactive hook the app wires up, the
worked-through built-in layouts, and exactly what is — and isn't —
user-customizable.

This is the power-user companion to [Configurable Panels](10-panels.md), which
covers resizing, hiding, and swapping the panes. If you only want to move panes
around, start there; come here when you want to redesign what a pane *shows*.

> **Note:** Customizing panels and export templates is entirely optional. Out of
> the box the panes use built-in layouts that reproduce the classic detail view,
> and you never have to touch a template. Everything below is for tailoring the
> app to your taste.

## 11.1 How it works

The flow is the same for both panels:

1. When you select an entry, the **main process** builds a *context* object for
   it (its cite key, fields, attachments, rendered notes, and so on — see
   [§11.3](#113-the-template-context)).
2. Main compiles your Handlebars template (or the built-in default) and renders
   it against that context, producing an **HTML string**.
3. The renderer drops that HTML into the pane and **hydrates** it: it wires the
   `data-*` click actions, upgrades the live `<bd-*>` widgets, and runs a MathJax
   pass so any `$…$`/`\(…\)` math in field values, notes, or the preview is
   typeset.

Because the template is rendered in main and shipped as a string, two things
follow. First, the panel can carry **live, asynchronous widgets** (the journal
cover, the formatted citation) without your template having to know anything
about them. Second, if your template fails to compile or render, the pane
**falls back to the built-in layout** rather than showing a broken pane (see
[§11.11](#1111-errors--the-safe-fallback)).

> **Note:** Templates produce **HTML**, not Markdown. You are writing the markup
> the pane will display, sprinkled with `{{…}}` placeholders. The built-in
> layouts use the app's own CSS classes (`bd-…`); you are free to reuse those
> classes for a native look, or write your own markup and let it inherit the
> pane's base styling.

## 11.2 Where to edit (Preferences → Panels)

Open **Preferences** and choose the **Panels** section. It has two
managers — one for the **Detail pane**, one for the **Bottom panel** — that work
identically.

### Forks (named template variants)

Each panel keeps a list of named **forks** (your editable template variants) plus
the **Built-in default**. Exactly one of them is *active* at a time.

- **Active** — the dropdown at the top of each manager chooses which template the
  panel actually uses. The first option is always **Built-in default**; below it
  are your forks by name. Switching the dropdown changes the live panel
  immediately.
- **Fork default** — the button creates a new editable fork seeded from a copy of
  the built-in layout (named `Custom`, or `Custom 2`, `Custom 3`, … if that name
  is taken). A new fork becomes the active template right away, so you see it in
  the live pane.
- **New from preset…** — this dropdown seeds a new fork from one of the
  ready-made [presets](#presets) instead of from the default.
- **Rename** — edit the name field at the top of a fork. (If the renamed fork was
  the active one, the active pointer follows the new name.)
- **Edit** — the code editor below the name holds the Handlebars body. Your edit
  is saved when the editor loses focus.
- **Delete** — the **×** button removes a fork. If you delete the active fork, the
  panel falls back to the **Built-in default**.

When a panel has no forks, the manager shows *"No saved templates — the built-in
default is in use."*

> **Note:** There is no separate **Reset** button for a panel fork. To return a
> panel to its original look, set its **Active** dropdown back to **Built-in
> default** (your forks are kept), or **Fork default** again for a fresh editable
> copy. Leaving a fork's editor empty also makes the panel use the built-in
> default — an empty (or unknown) active body always resolves to the default.

### Live preview (Text / HTML)

Below each fork's editor is a **Preview** button. Clicking it renders your
template against a **sample entry** from the open library and shows the result.
A **Text / HTML** toggle switches between:

- **HTML** — the rendered markup, shown in a sandboxed `<iframe>`.
- **Text** — the raw HTML the template produced (useful for spotting a stray tag
  or an unescaped value).

> **Tip:** You need an **open library** to preview — the preview renders against a
> real entry. With no document open, the editor reports *"Open a library to
> preview."*

> **Warning:** The live widgets `<bd-journal-cover>` and `<bd-citation>` do **not**
> render in the sandboxed preview (it has no IPC access to fetch a cover or format
> a citation). The preview shows everything *except* those two widgets — they
> appear only in the real, live pane. See [§11.6](#116-live-widgets).

<a name="presets"></a>

### Presets

**New from preset…** offers three ready-made designs you can fork and tweak:

| Preset | Suits | What it shows |
|---|---|---|
| **Horizontal card (wide)** | Bottom panel | A magazine-style card: cover, then type · title · byline · venue/year/cite-key · formatted citation · attachment and link chips, with the notes alongside. Pairs nicely with keeping the side pane on Claude. |
| **Compact summary** | Either panel | A tight one-glance block: title, byline, `type · venue · year · cite-key`, the citation, attachment chips, and an **Edit…** button. |
| **Reading view** | Bottom panel | A focused reader: title + byline, then the annotation (falling back to the preview/abstract when there is no annotation). |

A preset marked for the bottom panel is only offered in the bottom manager;
**Compact summary** is offered in both.

## 11.3 The template context

Each panel template is rendered against the **selected entry**. The complete set
of values available to it:

| Field | Type | What it is |
|---|---|---|
| `documentId` | string | Opaque id of the open document. Needed by the live widgets (pass it as their `doc-id`). |
| `id` | string | Stable id of the selected entry. Needed by the live widgets (pass it as their `item-id`). |
| `citeKey` | string | The entry's cite key, e.g. `einstein1935`. |
| `type` | string | The BibTeX entry type, lower-cased, e.g. `article`, `book`, `inproceedings`. |
| `citeStyle` | string | The id of your default CSL citation style (e.g. `apa`). Pass it to `<bd-citation>` as `cite-style`. |
| `previewHtml` | string (HTML) | The pre-rendered preview-card HTML (the typeset abstract card you see in the default pane). May be absent. Use the **triple-stache** `{{{previewHtml}}}` — see [§11.4](#114-escaping-double-vs-triple-stache). |
| `notesHtml` | string (HTML) | The entry's annotation rendered to HTML (Markdown + `[[citeKey]]` cross-references + math). Empty string when there is no annotation. Use `{{{notesHtml}}}`. |
| `abstractHtml` | string (HTML) | The entry's `Abstract` field rendered from Markdown (sanitized; same rendering as the preview card). Empty string when there is no abstract. Use `{{{abstractHtml}}}`. |
| `abstractRaw` | string | The raw Markdown source of the `Abstract` field, for templates that process it themselves. |
| `fields` | array | Every display field row of the entry (see below). |
| `attachments` | array | The entry's **local file** attachments (see below). |
| `links` | array | The entry's **remote URL** links — `Url`/`Doi`/etc. (see below). |
| `title` | string | Convenience: the `Title` field's display value. |
| `authors` | string | Convenience: the `Author` field's display value, falling back to `Editor`. |
| `year` | string | Convenience: the `Year` field's display value. |
| `venue` | string | Convenience: the `Journal` field, falling back to `Booktitle`. |
| `doi` | string | Convenience: the `Doi` field's display value. |

The `title`/`authors`/`year`/`venue`/`doi` fields are derived from `fields` for
you, so common bibliographic values are one placeholder away and you don't have
to loop. They are display-formatted (de-TeXified, macros expanded), and any of
them is an empty string when the underlying field is absent.

### `fields` — each field row

`fields` is the same ordered list of rows the editor shows: the entry's local
fields first, then any fields inherited from a `Crossref` parent. Each item has:

| Sub-field | What it is |
|---|---|
| `name` | Canonical field name, e.g. `Author`, `Title`, `Journal`. |
| `value` | Display-ready value: macros expanded, de-TeXified, braces stripped. **Use this for showing the field.** Auto-escaped by `{{value}}`. |
| `rawValue` | The raw BibTeX field text (not de-TeXified, braces intact) — what the editor edits. Rarely needed in a panel. |
| `isInherited` | `true` when the value is inherited from a `Crossref` parent rather than set on this entry. The default layout adds an *(inherited)* badge. |
| `kind` | Editor-widget hint: `plain`, `person`, `rating`, `boolean`, `triState`, `url`, `citation`, or `keywords`. |
| `required` | `true` when the field is required for the entry's type. |

> **Note:** The managed attachment blobs (`Bdsk-File-N`), the annotation
> field (`Annote`/`Bdsk-Annotation`), and the color-label field are **not** in
> `fields` — they're surfaced as `attachments`, `notesHtml`, and the color palette
> respectively. So a loop over `fields` shows the real bibliographic fields, not
> housekeeping fields.

### `attachments` and `links` — each file/link

`attachments` holds the entry's **local files**; `links` holds its **remote
URLs**. Both are lists of the same shape:

| Sub-field | What it is |
|---|---|
| `displayName` | A human label — the file's basename, or a URL's label/host. |
| `url` | The resolved target: a `file://…`/absolute path for `attachments`, an absolute URL for `links`. Pass it to `data-open-file` / `data-open-url`. |
| `kind` | `file` for attachments, `url` for links. |
| `field` | For a managed attachment, the source `Bdsk-File-N` field name; absent for `Url`/`Local-Url`-derived ones. |

Both are plain arrays, so Handlebars treats an empty one as falsy — wrap a
section in `{{#if attachments}}…{{/if}}` and it drops out entirely when the entry
has none.

## 11.4 Escaping: double vs. triple stache

Handlebars has two interpolation forms, and the difference matters for safety:

- **`{{value}}` — double-stache, HTML-escaped.** Any `<`, `>`, `&`, or `"` in the
  value is turned into an entity, so it shows as text and can never inject markup.
  **Use this for every plain string** — field values, `title`, `authors`,
  `citeKey`, `displayName`, and so on.
- **`{{{previewHtml}}}` / `{{{notesHtml}}}` — triple-stache, raw HTML.** The string
  is inserted **as-is**, markup and all. Use it **only** for the two fields that
  are *already rendered HTML* (`previewHtml` and `notesHtml`). If you put a plain
  field value in a triple-stache, a stray `<` becomes broken markup, and any HTML
  in user data is rendered rather than shown.

> **Warning:** Never wrap a `fields` value, `title`, or any text field in
> triple-stache. The triple-stache is reserved for `previewHtml` and `notesHtml`,
> which the main process produces as trusted, rendered HTML. Everything else
> should stay `{{double}}` so it is safely escaped.

## 11.5 Helpers

Two Handlebars helpers are registered for panel templates.

### `eq` — equality

`(eq a b)` is true when `a === b`. It's most useful inside a conditional to
branch on the entry type:

```handlebars
{{#if (eq type "book")}}
  <p class="note">This is a book — show the publisher.</p>
{{else}}
  <p class="note">An article or other entry.</p>
{{/if}}
```

### `icon` — inline SVG

`{{icon "name"}}` emits an inline FontAwesome SVG (trusted markup, so it isn't
escaped). The vocabulary is small and fixed — these are the **only** names the
helper knows:

| Name | Glyph |
|---|---|
| `edit` | a pen (used on the **Edit…** button) |
| `file` | a file (used on attachment buttons) |
| `link` | a chain link (used on URL-link buttons) |
| `paperclip` | a paperclip |
| `plus` | a plus sign |
| `removeMinus` | a minus sign |

```handlebars
<button type="button" data-action="edit">{{icon "edit"}} Edit…</button>
```

> **Note:** An **unknown** icon name renders as an **empty string** — nothing,
> no error. Stick to the six names above.

## 11.6 Live widgets

Two custom HTML tags carry **live, asynchronous content** into the pane. The
renderer upgrades them after insertion and each fetches and renders *itself*; you
just place the tag with the right attributes.

### `<bd-journal-cover>` — the cover image

```handlebars
<bd-journal-cover doc-id="{{documentId}}" item-id="{{id}}"></bd-journal-cover>
```

Shows the entry's journal/book cover, or a generated initials-and-color fallback
when none is found. It's also a **drop target**: dropping an image onto it sets
that journal's cover (downsized automatically). Attributes:

- `doc-id` — pass `{{documentId}}`.
- `item-id` — pass `{{id}}`.

### `<bd-citation>` — the formatted citation

```handlebars
<bd-citation doc-id="{{documentId}}" item-id="{{id}}" cite-style="{{citeStyle}}"></bd-citation>
```

Shows the entry formatted as a CSL bibliography entry, with its own MathJax pass.
Attributes:

- `doc-id` — pass `{{documentId}}`.
- `item-id` — pass `{{id}}`.
- `cite-style` — the CSL style id; pass `{{citeStyle}}` to use your default style.
  (Note the attribute is `cite-style`, **not** `style` — `style` is reserved
  HTML.) An unset or unknown style falls back to APA.

See [Preview & Citations](06-preview-and-citations.md) for what the cover and the
CSL citation block are, and how to change the citation style.

> **Warning:** Both widgets render only in the **live pane**, never in the
> Preferences **HTML preview** (which is sandboxed with no IPC). Don't be alarmed
> when the cover and citation are missing from the preview — they will be there in
> the real pane.

## 11.7 Interactive hooks (`data-*` actions)

The renderer attaches one delegated click handler to the hydrated pane. Put these
attributes on any element (typically a `<button>` or `<a>`) and clicking it
triggers the action — you do not write any JavaScript:

| Attribute | Effect |
|---|---|
| `data-open-url="{{url}}"` | Opens the URL in your default browser (BibDesk resolves bare DOIs too). |
| `data-open-file="{{url}}"` | Opens the local file in your OS's default app for that type. |
| `data-open-files` | Opens a small **popup menu** of the entry's file attachments (or opens the file directly if there's exactly one). Useful for a single "Files ▾" button. |
| `data-cite="{{citeKey}}"` | Selects the entry with that cite key — a jump-to-cross-reference. |
| `data-action="edit"` | Opens the standalone **editor window** for the selected entry. |

```handlebars
{{#each attachments}}
  <button type="button" data-open-file="{{url}}">{{icon "file"}} {{displayName}}</button>
{{/each}}
{{#each links}}
  <button type="button" data-open-url="{{url}}">{{icon "link"}} {{displayName}}</button>
{{/each}}
```

> **Note:** The click handler reads the attribute that's closest to where you
> clicked, so it's fine to wrap an icon and a label inside one button — a click
> anywhere in the button still fires the action.

### Tabs

Wrap content in a `bd-tabs` block to get a **tabbed view**: a row of tab buttons
over swappable panels. The renderer wires the switching — you only supply the
markup. A button `data-tab="key"` shows the panel whose `data-tabpanel="key"`
matches; mark the initially-open tab with the `bd-tab--active` class (otherwise
the first tab opens).

```handlebars
<div class="bd-tabs">
  <div class="bd-tabs__bar">
    <button type="button" class="bd-tab bd-tab--active" data-tab="notes">Annotation</button>
    <button type="button" class="bd-tab" data-tab="abstract">Abstract</button>
  </div>
  <div class="bd-tab__panel" data-tabpanel="notes">{{{notesHtml}}}</div>
  <div class="bd-tab__panel" data-tabpanel="abstract">{{{abstractHtml}}}</div>
</div>
```

Tab groups are independent, so you can nest more than one set in a template.

### Attachment thumbnails

Give an attachment a `data-thumb` element with a `data-file="{{url}}"` and a
`.bd-thumb__img` slot, and the renderer replaces the slot with a **live preview**:
the first page for PDFs, the picture for image files, and the icon you put in the
slot for everything else. **Double-clicking the thumbnail opens the file** in its
native app.

```handlebars
{{#if attachments}}
<div class="bd-thumbs">
  {{#each attachments}}
  <figure class="bd-thumb" data-thumb data-file="{{url}}" title="Double-click to open {{displayName}}">
    <div class="bd-thumb__img">{{icon "file"}}</div>
    <figcaption class="bd-thumb__name">{{displayName}}</figcaption>
  </figure>
  {{/each}}
</div>
{{/if}}
```

> **Tip:** The built-in **Tabbed** bottom-panel mode (chapter 10) is exactly an
> Annotation · Abstract · Attachments layout built from these two conventions —
> a ready-made example to read and copy.

## 11.8 Worked example: the built-in layouts

The best way to learn the system is to read the layouts you start from. These are
the **actual** built-in templates.

### The built-in detail-pane layout

```handlebars
<div class="bd-view__actions">
  <button type="button" class="bd-btn bd-btn--small bd-btn--primary" title="Edit this publication in a separate window" data-action="edit">{{icon "edit"}} Edit…</button>
</div>
<bd-journal-cover doc-id="{{documentId}}" item-id="{{id}}"></bd-journal-cover>
{{#if previewHtml}}<div class="bd-preview">{{{previewHtml}}}</div>{{/if}}
<bd-citation doc-id="{{documentId}}" item-id="{{id}}" cite-style="{{citeStyle}}"></bd-citation>
<div class="bd-detail__section">Fields</div>
<dl class="bd-viewfields">
  <dt>Cite Key</dt>
  <dd class="bd-viewfields__mono">{{citeKey}}</dd>
  <dt>Type</dt>
  <dd>{{type}}</dd>
  {{#each fields}}
  <dt{{#if isInherited}} class="bd-viewfields__inherited"{{/if}}>{{name}}{{#if isInherited}}<span class="bd-field__badge">(inherited)</span>{{/if}}</dt>
  <dd>{{value}}</dd>
  {{/each}}
</dl>
<div class="bd-detail__section bd-detail__section--withaction"><span>Annotation</span></div>
{{#if notesHtml}}
<div class="bd-notes">{{{notesHtml}}}</div>
{{else}}
<div class="bd-notes__empty">No annotation.</div>
{{/if}}
<div class="bd-detail__section bd-detail__section--withaction"><span>Attachments</span></div>
{{#if attachments}}
<ul class="bd-files">
  {{#each attachments}}
  <li class="bd-file"><button type="button" class="bd-file__btn" title="Open {{displayName}}" data-open-file="{{url}}"><span class="bd-file__icon" aria-hidden="true">{{icon "file"}}</span><span class="bd-file__name">{{displayName}}</span></button></li>
  {{/each}}
</ul>
{{else}}
<div class="bd-files__empty">No attachments.</div>
{{/if}}
{{#if links}}
<div class="bd-detail__section">Links</div>
<ul class="bd-files">
  {{#each links}}
  <li class="bd-file"><button type="button" class="bd-file__btn" title="Open {{displayName}}" data-open-url="{{url}}"><span class="bd-file__icon" aria-hidden="true">{{icon "link"}}</span><span class="bd-file__name">{{displayName}}</span></button></li>
  {{/each}}
</ul>
{{/if}}
```

Walking through it section by section:

- **Edit button** — `data-action="edit"` opens the editor window
  ([§11.7](#117-interactive-hooks-data-actions)); `{{icon "edit"}}` is the pen
  glyph.
- **Cover** — the live `<bd-journal-cover>` widget, fed `{{documentId}}` and
  `{{id}}`.
- **Preview card** — shown only `{{#if previewHtml}}`, and inserted with the
  triple-stache because it's trusted rendered HTML.
- **Citation** — the live `<bd-citation>` widget using `{{citeStyle}}`.
- **Fields** — `Cite Key` and `Type` are written out by hand (with the mono class
  on the cite key), then `{{#each fields}}` emits a `<dt>`/`<dd>` pair per field.
  `isInherited` both styles the term and appends the *(inherited)* badge; the
  value uses the **escaped** `{{value}}`.
- **Annotation** — `{{#if notesHtml}}…{{else}}…{{/if}}` shows the rendered notes
  (triple-stache) or an empty-state line.
- **Attachments** and **Links** — each is an `{{#each}}` of file buttons, carrying
  `data-open-file` / `data-open-url` so a click opens the target; the links block
  is dropped entirely when there are none.

### The built-in bottom-panel layout

The default bottom panel is a wide, comfortable **annotation reader**:

```handlebars
<div class="bd-detail__section">Annotation — <span class="bd-viewfields__mono">{{citeKey}}</span></div>
{{#if notesHtml}}<div class="bd-notes bd-notes--wide">{{{notesHtml}}}</div>{{else}}<div class="bd-notes__empty">No annotation for this entry.</div>{{/if}}
```

A heading with the cite key, then the rendered notes (or an empty-state line) in
the wide notes style. It shares the *exact same context* as the detail template —
the two panels differ only in their markup.

## 11.9 A custom example

Here's a small, complete detail-pane template that shows a header, a
type-specific line via `eq`, the citation, and the attachments — using the hooks
and widgets above:

```handlebars
<div class="bd-view__actions">
  <button type="button" class="bd-btn bd-btn--small bd-btn--primary" data-action="edit">{{icon "edit"}} Edit…</button>
</div>

{{#if title}}<h2>{{title}}</h2>{{/if}}
{{#if authors}}<p><em>{{authors}}</em>{{#if year}} ({{year}}){{/if}}</p>{{/if}}

{{#if (eq type "book")}}
  <p>📕 Book{{#if venue}} — {{venue}}{{/if}}</p>
{{else}}
  <p>{{type}}{{#if venue}} · {{venue}}{{/if}}</p>
{{/if}}

<bd-citation doc-id="{{documentId}}" item-id="{{id}}" cite-style="{{citeStyle}}"></bd-citation>

{{#if notesHtml}}<div class="bd-notes">{{{notesHtml}}}</div>{{/if}}

{{#if attachments}}
  <p>{{#each attachments}}<button type="button" class="bd-chip" data-open-file="{{url}}">{{icon "file"}} {{displayName}}</button>{{/each}}</p>
{{/if}}
{{#if links}}
  <p>{{#each links}}<button type="button" class="bd-chip" data-open-url="{{url}}">{{icon "link"}} {{displayName}}</button>{{/each}}</p>
{{/if}}
```

Reusing the `bd-…` classes (like `bd-chip`, `bd-notes`, `bd-btn`) gives your
template the app's native styling for free; you're equally free to add your own
classes and inline styles.

## 11.10 The multi-select panels

When you select **two or more** entries, both panes switch to a multi-select view
instead of the single-entry layout.

- The **detail pane** shows a sticky **"Multiple entries selected"** header above a
  scrollable list of each selected entry's pretty-printed citation preview.
- The **bottom panel** shows the same sticky header above a list of each entry's
  annotation.

Neither multi-select template contains editing controls: batch editing (set field,
add/remove keyword) is done from the floating **batch-edit bar** at the bottom of
the window — see [Configurable Panels → Batch tools](10-panels.md#batch-tools-the-selection-bar).

Their context is:

| Field | What it is |
|---|---|
| `count` | The **total** number of entries selected. |
| `moreCount` | How many selected entries were **not** rendered into the list (because of the cap below). |
| `items` | The (capped) list of entries, each with `id`, `citeKey`, `previewHtml`, and `notesHtml`. |

> **Note:** The multi-select list is capped at **50** entries — a *Select All* on a
> large library won't render thousands of preview cards (or run dozens of MathJax
> passes). `moreCount` tells the template how many were elided so it can show a
> *"+N more not shown"* line. (The batch-edit bar still acts on the **whole**
> selection, not just the 50 shown.)

> **Warning:** Unlike the detail and bottom panels, the **multi-select templates
> are built-in only** — there is no fork or editor for them in Preferences. They
> are documented here so you understand their context and the cap, but you cannot
> replace them.

For reference, this is the built-in multi-select detail template:

```handlebars
<div class="bd-multi">
  <div class="bd-multi__sticky">
    <div class="bd-multi__head">Multiple entries selected <span class="bd-multi__count">{{count}}</span></div>
  </div>
  <ul class="bd-multi__list">
    {{#each items}}
    <li class="bd-multi__item">
      <div class="bd-multi__key">{{citeKey}}</div>
      {{#if previewHtml}}<div class="bd-preview bd-preview--multi">{{{previewHtml}}}</div>{{else}}<div class="bd-multi__bare">No preview.</div>{{/if}}
    </li>
    {{/each}}
    {{#if moreCount}}<li class="bd-multi__more">+{{moreCount}} more not shown</li>{{/if}}
  </ul>
</div>
```

## 11.11 Customizing outputs

"Outputs" — the formats you get *out* of the app — come in two distinct flavors.
One is Handlebars-driven and fully user-customizable; the other is CSL-driven and
chosen rather than authored. It's important to know which is which.

### Export templates (Handlebars — fully customizable)

You can author your own **export formats** under **Preferences → Export
templates**. Each is a named Handlebars body plus an output **file extension**;
once defined, it appears as a submenu under **File → Export**, with three scope
choices — **whole library**, **entries shown** (the current group + search
filter), or the **current selection**. Choosing one renders the entries through
your template and writes the result to a file you pick.

These export templates are a **different context** from the panel templates. Each
template renders against `{ title, count, entries }`, where `title` is your
library's name and `entries` is the list to output. Each entry exposes:

| Field | What it is |
|---|---|
| `citeKey` | The entry's cite key. |
| `type` | The BibTeX entry type. |
| `fields` | A map of the entry's display-formatted fields, keyed by canonical name — e.g. `{{fields.Journal}}`. |
| `authors` | The author display strings as an array. |
| `authorsText` | The authors joined with `, `. |
| `title`, `year`, `venue`, `volume`, `pages`, `doi` | Convenience display values (`venue` = `Journal`, falling back to `Booktitle`). |

Two helpers are available in export templates:

- `{{field "name"}}` — looks up a field **case-insensitively** on the current
  entry, e.g. `{{field "journal"}}`.
- `{{join array ", "}}` — joins an array with a separator (default `, `), e.g.
  `{{join authors "; "}}`.

A minimal export template loops the entries:

```handlebars
{{#each entries}}
{{authorsText}} ({{year}}). {{title}}. {{venue}}. [{{citeKey}}]
{{/each}}
```

The editor has the same **Preview** + **Text / HTML** toggle as the panel editors
(it previews against the first few entries of the open library), and values are
HTML-escaped, so titles with `<`, `>`, or `&` export safely.

> **Tip:** The built-in **File → Export → HTML…** styled bibliography is itself
> rendered through a Handlebars template — so your own HTML export template can do
> anything that one does (and more). See
> [Importing & Exporting → HTML export](07-importing-and-exporting.md#763-html-export)
> for the built-in layout.

### Citations and printing (CSL — chosen, not authored)

The other outputs — the **formatted citation** in the detail pane, **Edit → Copy
Citation**, and **File → Print…** — are **not** Handlebars. They are formatted by a
**CSL** (Citation Style Language) engine, so you don't *write* their layout; you
**choose a style**.

- **Pick a style** — **Preferences → Citations → Default style** sets the citation
  style used in the pane, in copy-citation, and in the printout. Three styles ship
  bundled (APA, Vancouver, Harvard).
- **Install more** — click **Install CSL file…** and choose any Citation Style
  Language **`.csl`** file (e.g. from the Zotero / CSL style repository). It's
  validated, copied into the app's data folder, and added to the style list with a
  **★** marking it as a user-installed style; then pick it in the dropdown.
- **Remove** — selecting an installed (★) style shows a **Remove** button.

So: if you want a *different reference style* for citations or a printed
bibliography, install or pick a CSL style — there is no Handlebars customization
for the CSL citation, by design. If you want a *bespoke output layout* of your own
design, use a Handlebars **export template**. See
[Preview & Citations](06-preview-and-citations.md) for the citation block and
[Importing & Exporting](07-importing-and-exporting.md) for the full export and
print story.

## 11.12 Errors & the safe fallback

Two safeguards keep a bad template from breaking the app:

- **In the editor** — when you click **Preview** and your template fails to compile
  or render, the error message is shown in place of the preview (in red), so you
  can fix it before relying on the template.
- **In the live pane** — if the *active* template throws while rendering an entry,
  the panel quietly **falls back to the built-in layout** for that render. You get
  the default pane, never a broken or blank one. (The same is true of the
  multi-select panels and the export templates, which surface a readable
  *"Template error: …"* on failure.)

This means it's safe to experiment: a typo in a fork can't lock you out of your
data — switch the **Active** dropdown back to **Built-in default**, or fix the
template, and you're back.

## See also

- [Configurable Panels](10-panels.md) — resizing, hiding, and swapping the panes
  (the layout side of the same feature).
- [Preview & Citations](06-preview-and-citations.md) — what the preview card and
  the CSL citation block are, and choosing a citation style.
- [Importing & Exporting](07-importing-and-exporting.md) — the built-in export
  formats, the styled HTML bibliography, and printing.
- [Shortcuts & Reference](09-shortcuts-and-reference.md) — the full menu and
  keyboard reference.
