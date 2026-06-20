/**
 * Golden tests for the default details-panel template: the structure must match
 * the legacy React ViewPane (same elements/classes), and conditionals must drop
 * absent sections. This is the "exactly the same" guard for the template-driven
 * pane (the visual equivalence is verified against this structure).
 */
import { describe, it, expect } from 'vitest';
import type { ItemDetail } from '@bibdesk/shared';
import {
  renderDetailsPanel,
  renderBottomPanel,
  renderPanelPreview,
  resolveActivePanelBody,
  renderMultiPanels,
} from './panel.js';
import { PANEL_PRESETS } from '../renderer/src/panel-presets.js';

function detail(over: Partial<ItemDetail> = {}): ItemDetail {
  return {
    id: 'i1',
    citeKey: 'smith2020',
    type: 'article',
    fields: [
      { name: 'Title', value: 'A Title', rawValue: 'A Title', isInherited: false },
      { name: 'Journal', value: 'Nature', rawValue: 'Nature', isInherited: true },
    ],
    files: [],
    notesRaw: '',
    notesHtml: '',
    ...over,
  };
}

describe('renderDetailsPanel — default template', () => {
  it('emits the bd-* elements, edit action, and the fields dl', () => {
    const html = renderDetailsPanel(detail(), 'doc-1', 'apa')!;
    expect(html).toContain('<bd-journal-cover doc-id="doc-1" item-id="i1">');
    expect(html).toContain('<bd-citation doc-id="doc-1" item-id="i1" cite-style="apa">');
    expect(html).toContain('data-action="edit"');
    expect(html).toContain('<dt>Cite Key</dt>');
    expect(html).toContain('<dd class="bd-viewfields__mono">smith2020</dd>');
    expect(html).toContain('<dd>Nature</dd>');
    // the inherited Journal field is muted + badged
    expect(html).toContain('<dt class="bd-viewfields__inherited">Journal<span class="bd-field__badge">(inherited)</span></dt>');
  });

  it('drops the attachments list when empty (shows the empty state, no <ul>)', () => {
    const html = renderDetailsPanel(detail(), 'doc-1', 'apa')!;
    expect(html).toContain('<div class="bd-files__empty">No attachments.</div>');
    expect(html).not.toContain('<ul class="bd-files">');
    expect(html).not.toContain('>Links</div>');
  });

  it('renders attachments and links when present (conditional sections + actions)', () => {
    const html = renderDetailsPanel(
      detail({
        files: [
          { kind: 'file', url: '/p/a.pdf', displayName: 'a.pdf' },
          { kind: 'url', url: 'https://x/y', displayName: 'y' },
        ],
      }),
      'doc-1',
      'apa',
    )!;
    expect(html).toContain('<ul class="bd-files">');
    expect(html).toContain('data-open-file="/p/a.pdf"');
    expect(html).toContain('<span class="bd-file__name">a.pdf</span>');
    expect(html).toContain('<div class="bd-detail__section">Links</div>');
    expect(html).toContain('data-open-url="https://x/y"');
  });

  it('shows notes when present, the empty state otherwise', () => {
    expect(renderDetailsPanel(detail(), 'd', 'apa')!).toContain('No annotation.');
    expect(renderDetailsPanel(detail({ notesHtml: '<p>hi</p>' }), 'd', 'apa')!).toContain(
      '<div class="bd-notes"><p>hi</p></div>',
    );
  });

  it('includes the preview card only when previewHtml is present (raw HTML passthrough)', () => {
    expect(renderDetailsPanel(detail(), 'd', 'apa')!).not.toContain('bd-preview');
    expect(
      renderDetailsPanel(detail({ previewHtml: '<article>x</article>' }), 'd', 'apa')!,
    ).toContain('<div class="bd-preview"><article>x</article></div>');
  });

  it('escapes field values (no HTML injection from data)', () => {
    const html = renderDetailsPanel(
      detail({ fields: [{ name: 'Note', value: '<b>x</b> & "q"', rawValue: '', isInherited: false }] }),
      'd',
      'apa',
    )!;
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });
});

describe('renderBottomPanel — annotation reader', () => {
  it('shows the cite key heading + the annotation when present (wide)', () => {
    const html = renderBottomPanel(detail({ notesHtml: '<p>note body</p>' }), 'd', 'apa')!;
    expect(html).toContain('Annotation — <span class="bd-viewfields__mono">smith2020</span>');
    expect(html).toContain('<div class="bd-notes bd-notes--wide"><p>note body</p></div>');
  });

  it('shows an empty state when the entry has no annotation', () => {
    expect(renderBottomPanel(detail(), 'd', 'apa')!).toContain('No annotation for this entry.');
  });
});

describe('custom template overrides + preview', () => {
  it('renderDetailsPanel / renderBottomPanel honor a custom body', () => {
    expect(renderDetailsPanel(detail(), 'd', 'apa', 'Custom: {{type}}')).toBe('Custom: article');
    expect(renderBottomPanel(detail(), 'd', 'apa', 'B: {{citeKey}}')).toBe('B: smith2020');
  });

  it('renderPanelPreview returns html for a valid body, an error for a malformed one', () => {
    expect(renderPanelPreview(detail(), 'd', 'apa', 'Key: {{citeKey}}')).toEqual({ html: 'Key: smith2020' });
    const bad = renderPanelPreview(detail(), 'd', 'apa', '{{#if}}oops');
    expect(bad.error).toBeTruthy();
    expect(bad.html).toBeUndefined();
  });

  it('exposes convenience context fields (title/authors/year/venue)', () => {
    const html = renderDetailsPanel(detail(), 'd', 'apa', 'T:{{title}}|A:{{authors}}|V:{{venue}}')!;
    expect(html).toBe('T:A Title|A:|V:Nature'); // Journal=Nature (the inherited field); Author unset
  });
});

describe('showcase presets', () => {
  const sample = detail({
    fields: [
      { name: 'Title', value: 'The Title', rawValue: '', isInherited: false },
      { name: 'Author', value: 'A. Smith', rawValue: '', isInherited: false },
      { name: 'Year', value: '2021', rawValue: '', isInherited: false },
      { name: 'Journal', value: 'Nature', rawValue: '', isInherited: false },
    ],
    files: [{ kind: 'file', url: '/a.pdf', displayName: 'a.pdf' }],
    notesHtml: '<p>note</p>',
  });

  for (const p of PANEL_PRESETS) {
    it(`"${p.name}" compiles + renders without error`, () => {
      const r = renderPanelPreview(sample, 'd1', 'apa', p.body);
      expect(r.error).toBeUndefined();
      expect(r.html).toBeTruthy();
    });
  }

  it('horizontal card uses the convenience fields + live widgets', () => {
    const body = PANEL_PRESETS.find((p) => p.name.startsWith('Horizontal'))!.body;
    const html = renderPanelPreview(sample, 'd1', 'apa', body).html!;
    expect(html).toContain('The Title');
    expect(html).toContain('A. Smith');
    expect(html).toContain('<bd-citation doc-id="d1" item-id="i1"');
    expect(html).toContain('data-open-file="/a.pdf"');
  });
});

describe('renderMultiPanels — multi-select view', () => {
  const ctx = {
    count: 3,
    moreCount: 1,
    items: [
      { id: 'i1', citeKey: 'smith2020', previewHtml: '<article>S</article>', notesHtml: '<p>n1</p>' },
      { id: 'i2', citeKey: 'jones2021', previewHtml: '<article>J</article>', notesHtml: '' },
    ],
  };

  it('details pane: indicator + batch tools + per-entry previews + "+N more"', () => {
    const { detailsHtml } = renderMultiPanels(ctx);
    expect(detailsHtml).toContain('Multiple entries selected');
    expect(detailsHtml).toContain('<span class="bd-multi__count">3</span>');
    // batch tools (read by panel-hydrate)
    expect(detailsHtml).toContain('data-batch-tools');
    expect(detailsHtml).toContain('data-batch="field"');
    expect(detailsHtml).toContain('data-action="batch-set"');
    expect(detailsHtml).toContain('data-action="batch-delete"');
    // per-entry pretty-printed preview (raw HTML passthrough), with cite-key labels
    expect(detailsHtml).toContain('smith2020');
    expect(detailsHtml).toContain('<div class="bd-preview bd-preview--multi"><article>S</article></div>');
    expect(detailsHtml).toContain('+1 more not shown');
  });

  it('bottom pane: indicator + per-entry annotations, NO batch tools', () => {
    const { bottomHtml } = renderMultiPanels(ctx);
    expect(bottomHtml).toContain('Multiple entries selected');
    expect(bottomHtml).toContain('<div class="bd-notes bd-notes--wide"><p>n1</p></div>');
    expect(bottomHtml).toContain('No annotation.'); // i2 has no notes
    expect(bottomHtml).not.toContain('data-batch-tools');
  });

  it('omits the "+N more" line when nothing was elided', () => {
    const { detailsHtml } = renderMultiPanels({ ...ctx, moreCount: 0 });
    expect(detailsHtml).not.toContain('more not shown');
  });
});

describe('resolveActivePanelBody', () => {
  const forks = [
    { name: 'Card', body: 'C:{{citeKey}}' },
    { name: 'Reader', body: 'R:{{type}}' },
  ];

  it('returns the named fork body when it is active', () => {
    expect(resolveActivePanelBody(forks, 'Reader')).toBe('R:{{type}}');
  });

  it('returns undefined (⇒ built-in default) when nothing is active', () => {
    expect(resolveActivePanelBody(forks, undefined)).toBeUndefined();
  });

  it('returns undefined when the active name is unknown (stale selection)', () => {
    expect(resolveActivePanelBody(forks, 'Gone')).toBeUndefined();
  });

  it('treats an empty fork body as undefined (built-in default)', () => {
    expect(resolveActivePanelBody([{ name: 'Empty', body: '' }], 'Empty')).toBeUndefined();
  });

  it('feeds the resolved body into renderDetailsPanel', () => {
    const body = resolveActivePanelBody(forks, 'Card');
    expect(renderDetailsPanel(detail(), 'd', 'apa', body)).toBe('C:smith2020');
  });

  it('renders the built-in default when resolution yields undefined', () => {
    const body = resolveActivePanelBody(forks, 'Gone');
    expect(renderDetailsPanel(detail(), 'd', 'apa', body)).toContain('bd-view__actions');
  });
});
