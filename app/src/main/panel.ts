/**
 * Renders the detail pane as an HTML string from a Handlebars template + the
 * `bd-*` web components, so the pane is user-configurable while the default
 * template reproduces the legacy React `ViewPane` exactly.
 *
 * The async/interactive bits are handled outside the string: `<bd-journal-cover>`
 * and `<bd-citation>` self-render (Phase 2 web components); open-url/file, cite
 * cross-refs, the Edit action, and the multi-file popup are wired by one delegated
 * click handler in the renderer (`panel-hydrate.ts`); MathJax runs over the pane.
 *
 * The string is built in MAIN (where the detail already is) and travels on
 * `ItemDetail.detailsPanelHtml`.
 */
import Handlebars from 'handlebars';
import type { ItemDetail } from '@bibdesk/shared';

/**
 * The built-in details template. Emits the INNER content of `.bd-detail.bd-view`
 * (the host div provides those classes), mirroring `ViewPane` section-for-section
 * and class-for-class. `{{value}}` is auto-escaped; `{{{previewHtml}}}` /
 * `{{{notesHtml}}}` are trusted main-rendered HTML. Conditionals (`{{#if}}`) drop
 * a section entirely when its data is absent (Handlebars treats `[]` as falsy).
 */
export const DEFAULT_DETAILS_TEMPLATE = `<div class="bd-view__actions">
  <button type="button" class="bd-btn bd-btn--small bd-btn--primary" title="Edit this publication in a separate window" data-action="edit">✎ Edit…</button>
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
{{#if notesHtml}}<div class="bd-notes">{{{notesHtml}}}</div>{{else}}<div class="bd-notes__empty">No annotation.</div>{{/if}}
<div class="bd-detail__section bd-detail__section--withaction"><span>Attachments</span></div>
{{#if attachments}}<ul class="bd-files">{{#each attachments}}<li class="bd-file"><button type="button" class="bd-file__btn" title="Open {{displayName}}" data-open-file="{{url}}"><span class="bd-file__icon" aria-hidden="true">📄</span><span class="bd-file__name">{{displayName}}</span></button></li>{{/each}}</ul>{{else}}<div class="bd-files__empty">No attachments.</div>{{/if}}
{{#if links}}<div class="bd-detail__section">Links</div><ul class="bd-files">{{#each links}}<li class="bd-file"><button type="button" class="bd-file__btn" title="Open {{displayName}}" data-open-url="{{url}}"><span class="bd-file__icon" aria-hidden="true">🔗</span><span class="bd-file__name">{{displayName}}</span></button></li>{{/each}}</ul>{{/if}}`;

/**
 * The built-in BOTTOM panel template: a full-width annotation reader for the
 * current selection (the wider format is easier to read than the narrow side
 * pane). Shares the same per-item context as the details template.
 */
export const DEFAULT_BOTTOM_TEMPLATE = `<div class="bd-detail__section">Annotation — <span class="bd-viewfields__mono">{{citeKey}}</span></div>
{{#if notesHtml}}<div class="bd-notes bd-notes--wide">{{{notesHtml}}}</div>{{else}}<div class="bd-notes__empty">No annotation for this entry.</div>{{/if}}`;

/** Per-item context exposed to the details/panel template. */
export interface DetailPanelContext {
  readonly documentId: string;
  readonly id: string;
  readonly citeKey: string;
  readonly type: string;
  readonly citeStyle: string;
  readonly previewHtml?: string;
  readonly fields: ItemDetail['fields'];
  readonly notesHtml: string;
  readonly attachments: ItemDetail['files'];
  readonly links: ItemDetail['files'];
}

/** Build the template context from an already-built {@link ItemDetail}. */
export function buildDetailContext(
  detail: ItemDetail,
  documentId: string,
  citeStyle: string,
): DetailPanelContext {
  return {
    documentId,
    id: detail.id,
    citeKey: detail.citeKey,
    type: detail.type,
    citeStyle,
    previewHtml: detail.previewHtml,
    fields: detail.fields,
    notesHtml: detail.notesHtml,
    attachments: detail.files.filter((f) => f.kind === 'file'),
    links: detail.files.filter((f) => f.kind === 'url'),
  };
}

// Cache compiled templates by body so a custom user template (Phase 4) isn't
// recompiled on every selection.
const cache = new Map<string, Handlebars.TemplateDelegate>();
function compile(body: string): Handlebars.TemplateDelegate {
  let fn = cache.get(body);
  if (!fn) {
    fn = Handlebars.compile(body, { noEscape: false });
    cache.set(body, fn);
  }
  return fn;
}

/**
 * Render the details pane HTML for `detail`. Uses `templateBody` if given, else
 * the built-in default. Returns `undefined` on a template error so the renderer
 * falls back to its legacy React pane (never a broken pane).
 */
export function renderDetailsPanel(
  detail: ItemDetail,
  documentId: string,
  citeStyle: string,
  templateBody?: string,
): string | undefined {
  return renderPanel(detail, documentId, citeStyle, templateBody || DEFAULT_DETAILS_TEMPLATE);
}

/** Render the bottom panel HTML (default = the annotation reader). See above. */
export function renderBottomPanel(
  detail: ItemDetail,
  documentId: string,
  citeStyle: string,
  templateBody?: string,
): string | undefined {
  return renderPanel(detail, documentId, citeStyle, templateBody || DEFAULT_BOTTOM_TEMPLATE);
}

/** Compile + render a panel body against the item context; undefined on error. */
function renderPanel(
  detail: ItemDetail,
  documentId: string,
  citeStyle: string,
  body: string,
): string | undefined {
  try {
    return compile(body)(buildDetailContext(detail, documentId, citeStyle));
  } catch {
    return undefined;
  }
}
