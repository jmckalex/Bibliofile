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

/** Which panel a template/fork targets. */
export type PanelWhich = 'details' | 'bottom';

/** The built-in default body for a panel — what "Fork default" copies from. */
export function defaultPanelBody(which: PanelWhich): string {
  return which === 'bottom' ? DEFAULT_BOTTOM_TEMPLATE : DEFAULT_DETAILS_TEMPLATE;
}
