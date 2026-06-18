# Configurable Panels

bibdesk-electron's window is built from panels you can **resize, hide, swap, and
even re-design**. This chapter covers the side (detail) panel, the bottom panel,
and how to customize what they show with Handlebars templates.

## Resizing, hiding, and swapping the side panel

The right-hand **detail pane** is fully adjustable:

- **Resize** — drag the divider between the publications table and the detail
  pane left or right.
- **Hide / show** — click the **×** in the pane's header, or the **▥ Side**
  button in the toolbar.
- **Swap to Claude** — the pane's header has two tabs, **Details** and
  **🤖 Claude**. Click **Claude** (or Tools → Claude Assistant, ⌘J) to use the
  assistant right inside the pane; **Details** swaps back.

All of this is remembered across launches.

## The bottom panel

Click **▤ Bottom** in the toolbar to open a panel beneath the table. By default
it's an **annotation reader**: it shows the selected entry's annotation in a wide,
comfortable-to-read format (handy for long notes that feel cramped in the narrow
side pane). Drag its top edge to resize, and **×** to hide.

## Designing your own panels (Handlebars)

Both the detail pane and the bottom panel are rendered from **Handlebars
templates**, and you can replace either with your own. Open **Preferences →
Panels**. Each panel has an editor with a **Preview** (toggle **Text / HTML**) and
a **Reset** that returns it to the built-in default. Leave an editor empty to keep
the default.

Each template is rendered against the **selected entry**, with this context:

| Field | What it is |
|---|---|
| `citeKey`, `type` | the entry's cite key and BibTeX type |
| `fields` | a list of `{ name, value, isInherited }` (display-formatted) |
| `attachments`, `links` | file attachments / URL links — each `{ displayName, url }` |
| `notesHtml` | the rendered annotation HTML (use `{{{notesHtml}}}`) |
| `previewHtml` | the preview-card HTML (use `{{{previewHtml}}}`) |

Conditionals work as you'd expect — a section can appear only when its data is
present:

```handlebars
{{#if attachments}}
  <h3>Attachments</h3>
  {{#each attachments}}<a data-open-file="{{url}}">{{displayName}}</a>{{/each}}
{{/if}}
```

Two **live widgets** are also available as custom tags:

- `<bd-journal-cover doc-id="{{documentId}}" item-id="{{id}}"></bd-journal-cover>`
  — the journal/book cover image (or a generated fallback).
- `<bd-citation doc-id="{{documentId}}" item-id="{{id}}" cite-style="{{citeStyle}}"></bd-citation>`
  — the formatted (CSL) citation.

> These widgets render in the **live** panel but not in the sandboxed HTML
> preview, so the preview shows everything *except* the cover and citation.

Interactive hooks (wired up automatically): `data-open-url` / `data-open-file`
open a link or file, `data-cite` jumps to a cited entry, and
`data-action="edit"` opens the editor window.

If a template has an error it's reported in the editor, and the pane safely falls
back to the built-in layout.
