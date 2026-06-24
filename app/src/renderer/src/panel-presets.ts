/**
 * Ready-made panel templates the user can load (Preferences → Panels → Load
 * preset…) to show off the system. Each is plain Handlebars over the per-item
 * panel context (citeKey/type/title/authors/year/venue/doi, fields, attachments,
 * links, notesHtml, previewHtml) plus the bd-* live widgets and data-* actions.
 */
export interface PanelPreset {
  readonly name: string;
  /** Which panel it suits (a 'both' preset is offered in either editor). */
  readonly for: 'details' | 'bottom' | 'both';
  readonly body: string;
}

/** A wide, magazine-style card — cover · metadata + citation · notes side by side.
 *  Designed for the bottom panel so the side pane can stay on Claude. */
const HORIZONTAL_CARD = `<div class="bd-hcard">
  <bd-journal-cover doc-id="{{documentId}}" item-id="{{id}}"></bd-journal-cover>
  <div class="bd-hcard__body">
    <div class="bd-hcard__type">{{type}}</div>
    {{#if title}}<h2 class="bd-hcard__title">{{title}}</h2>{{/if}}
    {{#if authors}}<p class="bd-hcard__authors">{{authors}}</p>{{/if}}
    <p class="bd-hcard__meta">{{#if venue}}<span>{{venue}}</span>{{/if}}{{#if year}}<span>{{year}}</span>{{/if}}<span class="bd-viewfields__mono">{{citeKey}}</span></p>
    <bd-citation doc-id="{{documentId}}" item-id="{{id}}" cite-style="{{citeStyle}}"></bd-citation>
    {{#if attachments}}<p class="bd-hcard__links">{{#each attachments}}<button type="button" class="bd-chip" data-open-file="{{url}}">{{icon "file"}} {{displayName}}</button>{{/each}}</p>{{/if}}
    {{#if links}}<p class="bd-hcard__links">{{#each links}}<button type="button" class="bd-chip" data-open-url="{{url}}">{{icon "link"}} {{displayName}}</button>{{/each}}</p>{{/if}}
  </div>
  {{#if notesHtml}}<div class="bd-hcard__notes">{{{notesHtml}}}</div>{{/if}}
</div>`;

/** A tight one-glance summary — title, byline, citation, attachments, Edit. */
const COMPACT = `<div class="bd-compact">
  {{#if title}}<h2 class="bd-compact__title">{{title}}</h2>{{/if}}
  {{#if authors}}<div class="bd-compact__authors">{{authors}}</div>{{/if}}
  <div class="bd-compact__meta">{{type}}{{#if venue}} · {{venue}}{{/if}}{{#if year}} · {{year}}{{/if}} · <span class="bd-viewfields__mono">{{citeKey}}</span></div>
  <bd-citation doc-id="{{documentId}}" item-id="{{id}}" cite-style="{{citeStyle}}"></bd-citation>
  {{#if attachments}}<div class="bd-compact__files">{{#each attachments}}<button type="button" class="bd-chip" data-open-file="{{url}}">{{icon "file"}} {{displayName}}</button>{{/each}}</div>{{/if}}
  <div class="bd-compact__actions"><button type="button" class="bd-btn bd-btn--small bd-btn--primary" data-action="edit">{{icon "edit"}} Edit…</button></div>
</div>`;

/** A focused reading view: title + byline, then the annotation (or abstract). */
const READING = `<article class="bd-reading">
  {{#if title}}<h1 class="bd-reading__title">{{title}}</h1>{{/if}}
  {{#if authors}}<p class="bd-reading__by">{{authors}}{{#if year}} · {{year}}{{/if}}</p>{{/if}}
  {{#if notesHtml}}<div class="bd-notes bd-notes--wide">{{{notesHtml}}}</div>{{else}}{{#if previewHtml}}<div class="bd-preview">{{{previewHtml}}}</div>{{else}}<p class="bd-notes__empty">No annotation or abstract for this entry.</p>{{/if}}{{/if}}
</article>`;

/** A tabbed reader: Annotation · Abstract (markdown) + an Attachments grid whose
 *  thumbnails open natively on double-click. Tabs/thumbnails are hydrated by the
 *  renderer from the `bd-tabs` / `data-thumb` conventions (see panel-hydrate.ts). */
const TABBED = `<div class="bd-tabs">
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

export const PANEL_PRESETS: readonly PanelPreset[] = [
  { name: 'Horizontal card (wide)', for: 'bottom', body: HORIZONTAL_CARD },
  { name: 'Compact summary', for: 'both', body: COMPACT },
  { name: 'Reading view', for: 'bottom', body: READING },
  { name: 'Tabbed — Annotation · Abstract · Attachments', for: 'bottom', body: TABBED },
];
