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
import type { ItemDetail, PanelTemplate } from '@bibdesk/shared';
import { DEFAULT_DETAILS_TEMPLATE, DEFAULT_BOTTOM_TEMPLATE } from '@bibdesk/shared';
import { panelIconSvg } from '../icon-svg.js';

// The built-in default bodies now live in @bibdesk/shared (so the renderer can
// seed a fork from them too); re-export here for existing main-side importers.
export { DEFAULT_DETAILS_TEMPLATE, DEFAULT_BOTTOM_TEMPLATE };

// Equality helper for panel templates, e.g. `{{#if (eq type "book")}}…{{/if}}`.
// Registered on the shared Handlebars singleton (idempotent across imports).
Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

// Inline-icon helper, e.g. `{{icon "file"}}` → a FontAwesome SVG (file/link/edit).
// Emits trusted markup, so it returns a SafeString (not auto-escaped).
Handlebars.registerHelper('icon', (name: unknown) => new Handlebars.SafeString(panelIconSvg(String(name))));

/** Look up a display field value by (case-insensitive) name. */
function fieldValue(fields: ItemDetail['fields'], name: string): string {
  const lower = name.toLowerCase();
  return fields.find((f) => f.name.toLowerCase() === lower)?.value ?? '';
}

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
  // Convenience fields (derived from `fields`) so templates needn't loop to get
  // the common bibliographic values.
  readonly title: string;
  readonly authors: string;
  readonly year: string;
  readonly venue: string;
  readonly doi: string;
}

/** Build the template context from an already-built {@link ItemDetail}. */
export function buildDetailContext(
  detail: ItemDetail,
  documentId: string,
  citeStyle: string,
): DetailPanelContext {
  const f = detail.fields;
  return {
    documentId,
    id: detail.id,
    citeKey: detail.citeKey,
    type: detail.type,
    citeStyle,
    previewHtml: detail.previewHtml,
    fields: f,
    notesHtml: detail.notesHtml,
    attachments: detail.files.filter((file) => file.kind === 'file'),
    links: detail.files.filter((file) => file.kind === 'url'),
    title: fieldValue(f, 'Title'),
    authors: fieldValue(f, 'Author') || fieldValue(f, 'Editor'),
    year: fieldValue(f, 'Year'),
    venue: fieldValue(f, 'Journal') || fieldValue(f, 'Booktitle'),
    doi: fieldValue(f, 'Doi'),
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
 * Resolve the active fork's body for a panel: the body of the fork named
 * `activeName`, or `undefined` (⇒ the built-in default) when nothing is selected,
 * the name is unknown, or the fork body is empty. The `undefined` return flows
 * straight into the `renderDetailsPanel`/`renderBottomPanel` default fallback.
 */
export function resolveActivePanelBody(
  forks: readonly PanelTemplate[],
  activeName: string | undefined,
): string | undefined {
  if (!activeName) return undefined;
  return forks.find((f) => f.name === activeName)?.body || undefined;
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

/** Render a panel body for the Preferences live preview — returns the error text. */
export function renderPanelPreview(
  detail: ItemDetail,
  documentId: string,
  citeStyle: string,
  body: string,
): { html?: string; error?: string } {
  try {
    return { html: compile(body)(buildDetailContext(detail, documentId, citeStyle)) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
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
