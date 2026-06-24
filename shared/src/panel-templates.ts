/**
 * The built-in Handlebars bodies for the detail (side) pane and the bottom
 * panel. They live in `shared` (not `main`) so BOTH the main renderer
 * (`panel.ts`, which compiles + renders them) AND the renderer Preferences UI
 * (which seeds a new editable "fork" from the default body) work off a single
 * source of truth.
 *
 * The per-item template context (citeKey/type/title/authors/year/venue/doi,
 * `fields`, `attachments`/`links`, `notesHtml`, `previewHtml`) plus the `bd-*`
 * live widgets and `data-*` click actions are documented in `main/panel.ts`.
 */

/**
 * The built-in details template. Emits the INNER content of `.bd-detail.bd-view`
 * (the host div provides those classes), mirroring `ViewPane` section-for-section
 * and class-for-class. `{{value}}` is auto-escaped; `{{{previewHtml}}}` /
 * `{{{notesHtml}}}` are trusted main-rendered HTML. Conditionals (`{{#if}}`) drop
 * a section entirely when its data is absent (Handlebars treats `[]` as falsy).
 */
export const DEFAULT_DETAILS_TEMPLATE = `<div class="bd-view__actions">
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
{{/if}}`;

/**
 * The built-in BOTTOM panel template: a full-width annotation reader for the
 * current selection (the wider format is easier to read than the narrow side
 * pane). Shares the same per-item context as the details template.
 */
export const DEFAULT_BOTTOM_TEMPLATE = `<div class="bd-detail__section">Annotation — <span class="bd-viewfields__mono">{{citeKey}}</span></div>
{{#if notesHtml}}<div class="bd-notes bd-notes--wide">{{{notesHtml}}}</div>{{else}}<div class="bd-notes__empty">No annotation for this entry.</div>{{/if}}`;

/**
 * The built-in TABBED bottom-panel template (the "Tabbed" bottom-panel mode): a
 * tab bar over Annotation · Abstract (both markdown) · Attachments (a grid of
 * thumbnails that open natively on double-click). Tabs and thumbnails are
 * hydrated in the renderer from the `bd-tabs` / `data-thumb` conventions (see
 * `panel-hydrate.ts`), which any custom template can also use. Same per-item
 * context as the other panel templates, plus `{{{abstractHtml}}}`.
 */
export const DEFAULT_TABBED_BOTTOM_TEMPLATE = `<div class="bd-tabs">
  <div class="bd-tabs__bar" role="tablist">
    <button type="button" class="bd-tab bd-tab--active" data-tab="annotation" role="tab">Annotation</button>
    <button type="button" class="bd-tab" data-tab="abstract" role="tab">Abstract</button>
    <button type="button" class="bd-tab" data-tab="attachments" role="tab">Attachments</button>
  </div>
  <div class="bd-tab__panel" data-tabpanel="annotation" role="tabpanel">
    {{#if notesHtml}}<div class="bd-notes bd-notes--wide">{{{notesHtml}}}</div>{{else}}<p class="bd-notes__empty">No annotation for this entry.</p>{{/if}}
  </div>
  <div class="bd-tab__panel" data-tabpanel="abstract" role="tabpanel">
    {{#if abstractHtml}}<div class="bd-notes bd-notes--wide">{{{abstractHtml}}}</div>{{else}}<p class="bd-notes__empty">No abstract for this entry.</p>{{/if}}
  </div>
  <div class="bd-tab__panel" data-tabpanel="attachments" role="tabpanel">
    {{#if attachments}}<div class="bd-thumbs">{{#each attachments}}<figure class="bd-thumb" data-thumb data-file="{{url}}" title="Double-click to open {{displayName}}"><div class="bd-thumb__img">{{icon "file"}}</div><figcaption class="bd-thumb__name">{{displayName}}</figcaption></figure>{{/each}}</div>{{else}}<p class="bd-notes__empty">No attachments for this entry.</p>{{/if}}
  </div>
</div>`;

/**
 * The built-in MULTI-SELECT details template, shown in place of the single-item
 * detail when 2+ rows are selected. A sticky header ("Multiple entries selected")
 * sits above a scrollable list of each entry's pretty-printed BibTeX preview (no
 * per-field breakdown). Batch editing (set field / add-remove keyword) lives in
 * the floating bar at the bottom of the window (`BatchBar`), not in this template.
 *
 * Context: `{ count, moreCount, items: [{ id, citeKey, previewHtml }] }`.
 */
export const DEFAULT_MULTI_DETAILS_TEMPLATE = `<div class="bd-multi">
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
</div>`;

/**
 * The built-in MULTI-SELECT bottom-panel template: the same sticky indicator over
 * a scrollable list of each selected entry's annotation (no batch tools — those
 * live in the details pane). Context: `{ count, moreCount, items: [{ citeKey, notesHtml }] }`.
 */
export const DEFAULT_MULTI_BOTTOM_TEMPLATE = `<div class="bd-multi bd-multi--bottom">
  <div class="bd-multi__sticky">
    <div class="bd-multi__head">Multiple entries selected <span class="bd-multi__count">{{count}}</span></div>
  </div>
  <ul class="bd-multi__list">
    {{#each items}}
    <li class="bd-multi__item">
      <div class="bd-multi__key">{{citeKey}}</div>
      {{#if notesHtml}}<div class="bd-notes bd-notes--wide">{{{notesHtml}}}</div>{{else}}<div class="bd-notes__empty">No annotation.</div>{{/if}}
    </li>
    {{/each}}
    {{#if moreCount}}<li class="bd-multi__more">+{{moreCount}} more not shown</li>{{/if}}
  </ul>
</div>`;

/** Which panel a template/fork targets. */
export type PanelWhich = 'details' | 'bottom';

/** The built-in default body for a panel — what "Fork default" copies from. */
export function defaultPanelBody(which: PanelWhich): string {
  return which === 'bottom' ? DEFAULT_BOTTOM_TEMPLATE : DEFAULT_DETAILS_TEMPLATE;
}
