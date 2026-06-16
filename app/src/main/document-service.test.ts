/**
 * Headless tests for the pure document-service layer (no Electron). Loads the
 * real BibDesk-authored `BD test.bib` fixture and exercises the full open → rows
 * → groups → detail path the IPC handlers expose.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import {
  DocumentStore,
  formatAuthorsDisplay,
  openLibraryFromText,
  toDisplay,
} from './document-service.js';

// The verbatim BD test.bib copied into the repo by the golden-harness task (T1).
const FIXTURE = fileURLToPath(
  new URL('../../../core/bibtex/test/fixtures/reference/bd-test.bib', import.meta.url),
);
const BIB = readFileSync(FIXTURE, 'utf8');

describe('document-service: BD test.bib', () => {
  it('opens with 3 items', () => {
    const { opened, library } = openLibraryFromText(BIB, FIXTURE);
    expect(opened.itemCount).toBe(3);
    expect(library.items).toHaveLength(3);
    expect(opened.displayName).toBe('bd-test.bib');
  });

  it('projects PublicationRows with formatted display fields', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(BIB, FIXTURE);
    const { rows, total } = store.listPublications({ documentId, offset: 0, limit: -1 });
    expect(total).toBe(3);
    expect(rows).toHaveLength(3);

    const row = rows.find((r) => r.citeKey === 'math.DG/0106179');
    expect(row).toBeDefined();
    expect(row!.type).toBe('article');
    expect(row!.year).toBe('2003');
    // two authors joined with " and "
    expect(row!.authorsDisplay).toContain('Murray');
    expect(row!.authorsDisplay).toContain('Stevenson');
    expect(row!.authorsDisplay).toContain(' and ');
    expect(row!.title).toContain('Higgs fields, bundle gerbes and string structures');
    // protective braces are stripped for display
    expect(row!.title).not.toContain('{');
    expect(row!.title).not.toContain('}');

    const chen = rows.find((r) => r.citeKey === 'chen-complex')!;
    expect(chen.title).toContain('Calabi-Yau'); // {C}alabi-{Y}au -> Calabi-Yau
  });

  it('toDisplay de-TeXifies and strips protective braces', () => {
    expect(toDisplay('{{Higgs fields}}')).toBe('Higgs fields');
    expect(toDisplay('a product of {C}alabi-{Y}au surfaces')).toBe(
      'a product of Calabi-Yau surfaces',
    );
    // accented TeX still decodes via detexify
    expect(toDisplay("{\\'E}cole")).toBe('École');
  });

  it('toDisplay preserves braces INSIDE math spans (for MathJax)', () => {
    // braces outside math are stripped; braces inside $…$ are kept verbatim
    expect(toDisplay('the mass $m_{e}$ of {the} electron')).toBe(
      'the mass $m_{e}$ of the electron',
    );
    expect(toDisplay('$\\frac{a}{b}$')).toBe('$\\frac{a}{b}$');
    // display math $$…$$
    expect(toDisplay('$$\\sum_{i}^{n} x_i$$ and {protected}')).toBe(
      '$$\\sum_{i}^{n} x_i$$ and protected',
    );
  });

  it('buildPreviewHtml emits a themeable card with semantic classes', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(BIB, FIXTURE);
    const { rows } = store.listPublications({ documentId, offset: 0, limit: -1 });
    const target = rows.find((r) => r.citeKey === 'math.DG/0106179')!;
    const detail = store.getItemDetail({ documentId, itemId: target.id });
    const html = detail.previewHtml!;
    expect(html).toContain('class="bd-card"');
    expect(html).toContain('data-type="article"');
    expect(html).toContain('bd-card__title');
    expect(html).toContain('Higgs fields');
    expect(html).toContain('bd-chip'); // has a URL and a file attachment
    expect(html).not.toContain('style='); // themeable via CSS, no inline styles
  });

  it('lists at least the Library group with the full count', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(BIB, FIXTURE);
    const { groups } = store.listGroups({ documentId });
    const library = groups.find((g) => g.kind === 'library');
    expect(library).toBeDefined();
    expect(library!.count).toBe(3);
  });

  it('returns full item detail with fields, attachments and a preview card', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(BIB, FIXTURE);
    const { rows } = store.listPublications({ documentId, offset: 0, limit: -1 });
    const target = rows.find((r) => r.citeKey === 'math.DG/0106179')!;

    const detail = store.getItemDetail({ documentId, itemId: target.id });
    expect(detail.citeKey).toBe('math.DG/0106179');
    expect(detail.type).toBe('article');
    expect(detail.fields.length).toBeGreaterThan(3);
    // attachments synthesized from Local-Url + Url fields
    expect(detail.files.some((f) => f.kind === 'file')).toBe(true);
    expect(detail.files.some((f) => f.kind === 'url')).toBe(true);
    expect(detail.previewHtml).toBeDefined();
    expect(detail.previewHtml!).toContain('Higgs fields');
  });

  it('supports paging (offset/limit) and cite-key sort', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(BIB, FIXTURE);
    const page = store.listPublications({
      documentId,
      offset: 0,
      limit: 2,
      sort: { key: 'citeKey', direction: 'asc' },
    });
    expect(page.total).toBe(3);
    expect(page.rows).toHaveLength(2);
  });

  it('builds Author category groups and filters by them', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(BIB, FIXTURE);
    const { groups } = store.listGroups({ documentId });

    const authorsSection = groups.find((g) => g.kind === 'category' && g.name === 'Authors');
    expect(authorsSection).toBeDefined();
    const authorChildren = groups.filter((g) => g.parentId === authorsSection!.id);
    expect(authorChildren.length).toBeGreaterThan(0);
    expect(authorChildren.every((g) => g.kind === 'author')).toBe(true);

    // selecting an author group filters the table to exactly that author's items
    const some = authorChildren[0]!;
    const { rows, total } = store.listPublications({
      documentId,
      offset: 0,
      limit: -1,
      groupId: some.id,
    });
    expect(total).toBe(some.count);
    expect(rows.length).toBe(some.count);
    // BD test.bib has no Keywords, so there is no Keywords section
    expect(groups.find((g) => g.name === 'Keywords')).toBeUndefined();
  });

  it('builds Keyword category groups with correct membership', () => {
    const KW = [
      '@article{a, Author = {A. One}, Keywords = {alpha, beta}, Title = {T1}, Year = {2000}}',
      '@article{b, Author = {B. Two}, Keywords = {beta, gamma}, Title = {T2}, Year = {2001}}',
      '',
    ].join('\n');
    const store = new DocumentStore();
    const { documentId } = store.openText(KW, '/tmp/kw.bib');
    const { groups } = store.listGroups({ documentId });

    const kwSection = groups.find((g) => g.kind === 'category' && g.name === 'Keywords');
    expect(kwSection).toBeDefined();
    const children = groups.filter((g) => g.parentId === kwSection!.id);
    expect(children.map((g) => g.name).sort()).toEqual(['alpha', 'beta', 'gamma']);

    const beta = children.find((g) => g.name === 'beta')!;
    expect(beta.count).toBe(2); // beta is shared by both items
    const { total } = store.listPublications({
      documentId,
      offset: 0,
      limit: -1,
      groupId: beta.id,
    });
    expect(total).toBe(2);
  });

  it('updateField + serializeDocument round-trips an edit', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(BIB, FIXTURE);
    const { rows } = store.listPublications({ documentId, offset: 0, limit: -1 });
    const target = rows.find((r) => r.citeKey === 'chen-complex')!;

    store.updateField(documentId, target.id, 'Note', 'hello world');
    expect(store.isDirty(documentId)).toBe(true);

    const text = store.serializeDocument(documentId);
    expect(text).toContain('hello world');

    // re-parse the serialized text: the edit persists
    const store2 = new DocumentStore();
    const { documentId: d2 } = store2.openText(text, FIXTURE);
    const r2 = store2
      .listPublications({ documentId: d2, offset: 0, limit: -1 })
      .rows.find((r) => r.citeKey === 'chen-complex')!;
    const detail = store2.getItemDetail({ documentId: d2, itemId: r2.id });
    expect(
      detail.fields.some((f) => f.name.toLowerCase() === 'note' && f.value === 'hello world'),
    ).toBe(true);
  });

  it('saveDocument writes atomically and keeps a .bak of the original', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-save-'));
    const file = join(dir, 'lib.bib');
    writeFileSync(file, BIB, 'utf8');

    const store = new DocumentStore();
    const opened = store.openFile(file);
    const { rows } = store.listPublications({ documentId: opened.documentId, offset: 0, limit: -1 });
    store.updateField(opened.documentId, rows[0]!.id, 'Note', 'saved-edit');

    const res = store.saveDocument(opened.documentId);
    expect(res.path).toBe(file);
    expect(store.isDirty(opened.documentId)).toBe(false);

    // the file now contains the edit; the .bak holds the un-edited original
    expect(existsSync(`${file}.bak`)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('saved-edit');
    expect(readFileSync(`${file}.bak`, 'utf8')).not.toContain('saved-edit');

    // and the saved file re-opens cleanly with the same item count
    const reopened = new DocumentStore().openFile(file);
    expect(reopened.itemCount).toBe(3);
  });

  it('throws on unknown documentId / itemId', () => {
    const store = new DocumentStore();
    expect(() => store.listPublications({ documentId: 'nope', offset: 0, limit: 10 })).toThrow();
  });

  it('formatAuthorsDisplay handles a single comma-form author', () => {
    const { library } = openLibraryFromText(BIB, FIXTURE);
    const chen = library.items.find((i) => i.citeKey === 'chen-complex')!;
    expect(formatAuthorsDisplay(chen)).toContain('Chen');
  });
});
