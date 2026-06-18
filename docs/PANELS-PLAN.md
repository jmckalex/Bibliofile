# Configurable Panels — implementation plan

> A multi-session feature: make the right Details pane user-configurable (resize /
> hide / swap with the Claude panel), add a configurable bottom panel, and drive
> both from **Handlebars templates** — with the *current* read-only Details pane
> reproduced **exactly** by the default template. Tracked here so it survives
> across sessions; check phases off as they land.

## The core idea

Handlebars emits an HTML string containing **custom elements** (`<bd-*>`) +
`data-*` hooks; the renderer drops the string into the DOM; the browser upgrades
the custom elements, which self-handle the async/interactive bits (cover image,
CSL citation, MathJax, open-url/file, cite cross-refs). Handlebars owns
*composition + conditionals* (`{{#if attachments}}…{{/if}}`); web components own
*liveness*. This pattern is already half-present today — `buildPreviewHtml` and
the notes renderer emit `data-open-url` / `data-open-files` / `data-cite`, wired
up by click delegation in `ViewPane`/`DetailPane`.

## Decisions (locked)

| Decision | Resolution |
|---|---|
| Repro scope | Read-only right pane (`ViewPane`) only; the editable editor window (`DetailPane`) stays React for v1 |
| The bridge | Handlebars (rendered in main) → HTML with `<bd-*>` web components + `data-*` hooks → renderer `innerHTML` + one hydration pass |
| Render location | In **main**, folded into `getItemDetail` (which already returns `previewHtml`/`notesHtml`) — no extra IPC per selection |
| Right pane | Resizable (drag splitter), hidable, **Details ↔ Claude** content swap (Assistant moves into the pane slot) |
| Bottom panel | New; resizable/hidable; **selection-driven; default = the annotation, full-width** |
| Template editing | Reuse the export-template Preferences UI + the Text/HTML preview toggle |
| Annotation field | Already the standard `Annote`; UI section relabeled "Notes" → "Annotation" |
| Annotation storage | lz-string→`Bdsk-Annotation` (default); readable `% { }`-escape in `Annote` (opt-in) |
| Layout state | `Settings.layout = { rightPaneWidth, rightPaneVisible, rightPaneContent:'details'|'assistant', bottomPanelHeight, bottomPanelVisible }` |
| Security | `innerHTML` never runs `<script>`; only whitelisted `<bd-*>` act; user templates over the user's own library = same trust as notes/iframes today |

## Current architecture (grounding)

The right pane is `ViewPane.tsx` (read-only); it composes six primitives exported
from `DetailPane.tsx`, each with its own async/interactivity:

| Primitive | Async | Interactive | Source today |
|---|---|---|---|
| `JournalCover` | `journalCover` IPC → `<img>` | — | fallback `GeneratedCover` |
| `PreviewCard` | MathJax | `data-open-url`, `data-open-files` | `detail.previewHtml` (main: `buildPreviewHtml`) |
| `CitationBlock` | `formatCitation` IPC + MathJax | — | style label from `defaultCiteStyle` |
| `ReadOnlyFields` | MathJax (`<MathText>`) | — | `<dl class="bd-viewfields">` |
| `NotesSection` | MathJax | `data-cite`, `data-open-url` | `detail.notesHtml` |
| `Attachments` | — | open file/url buttons | `detail.files` (file vs `kind:'url'`) |

Layout (`App.tsx`): `.bd-panes` grid `220px minmax(0,1fr) 340px` →
`[GroupsSidebar | PublicationsTable | ViewPane]`, `<BatchBar>` under it, `<Assistant>`
as a toggled overlay. Template engine: `export.ts renderTemplate(body, items, {title})`.

## Phases (each independently shippable + testable)

- **Phase 0 — Annotation hardening. ✅ DONE (this branch `annotation-hardening`).**
  Markdown annotations now stored safely (lz-string→`Bdsk-Annotation` default;
  readable `Annote` opt-in), format-agnostic read, `Settings.annotationStorage`,
  Preferences toggle, "Notes"→"Annotation" relabel. `app/src/main/annotation.ts`
  + `annotation.test.ts` (21 tests incl. serialize→reopen safety in both modes).
- **Phase 1 — Layout shell. ✅ DONE (branch `panels-layout`, off `annotation-hardening`).**
  `Settings.layout` (right pane width/visible/content, bottom panel height/visible)
  + `store.setLayout` (live local, debounced-by-release persist). `Panels.tsx`:
  `Splitter` (pointer-drag), `RightPane` (Details↔Claude tabs + hide), `BottomPanel`
  shell. `App.tsx` rewired: `.bd-main` wraps the grid (right-pane column sized inline,
  vertical splitter) + an optional bottom panel (horizontal splitter); toolbar
  toggles; the `assistant` menu command now opens the assistant *in the right pane*
  (the fixed overlay is retired). The bottom panel is still a placeholder shell —
  Phase 4 makes it the template-driven annotation reader.
- **Phase 2 — `bd-*` web components.** Extract cover/citation/notes/attachments/
  math (+ preview-card) into custom elements (`main.tsx` `customElements.define`);
  rewire `ViewPane` to them *still React-composed*. Pure refactor → verify identical.
- **Phase 3 — Template-driven details pane.** Rich conditional context
  (`attachments[]`, `links[]`, `doi`, `keywords[]`, `{{{notesHtml}}}`, …) + the
  default template that reproduces `ViewPane` exactly (same CSS classes) + main
  render folded into `getItemDetail` + renderer hydration host (one delegated
  click handler for `data-open-url`/`data-open-files`/`data-cite`/`data-action`).
  Swap `ViewPane` to template-driven. **The "exactly the same" milestone.**
- **Phase 4 — Bottom annotation reader + editing.** Bottom panel renders a template
  (reuses Phase 3); default = the selection's annotation full-width. Preferences
  "Panel templates" editor (details + bottom) via the existing editor + Text/HTML
  toggle.
- **Phase 5 — Polish.** Reset-to-default, help doc, multi-window refresh, perf.

## "Exactly the same" — verification strategy (Phase 3)

1. **Refactor first (Phase 2), template second (Phase 3)** — web components match
   the React output before templating swaps in.
2. **Shared CSS classes** (`bd-jcover`, `bd-card`, `bd-cite`, `bd-viewfields`,
   `bd-notes`, `bd-files`) ⇒ same pixels.
3. **A/B dev flag** to flip legacy `ViewPane` vs template pane during migration.
4. **Golden test:** snapshot `renderTemplate(DEFAULT_DETAILS_TEMPLATE, fixtureItem)`
   against the `bd-test.bib` fixture.

## Risks

- Exact reproduction → the strategy above.
- Per-selection render cost → folded into `getItemDetail`; components cache; today's
  pane already does async cover+CSL per selection.
- Editable editor window out of scope for v1 (separate window, not "on the right");
  templatizing it later needs editable web components — clean follow-up.
