/**
 * Golden tests for the default details-panel template: the structure must match
 * the legacy React ViewPane (same elements/classes), and conditionals must drop
 * absent sections. This is the "exactly the same" guard for the template-driven
 * pane (the visual equivalence is verified against this structure).
 */
import { describe, it, expect } from 'vitest';
import type { ItemDetail } from '@bibdesk/shared';
import { renderDetailsPanel, renderBottomPanel, renderPanelPreview } from './panel.js';

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
});
