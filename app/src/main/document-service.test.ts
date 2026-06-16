/**
 * Headless tests for the pure document-service layer (no Electron). Loads the
 * real BibDesk-authored `BD test.bib` fixture and exercises the full open → rows
 * → groups → detail path the IPC handlers expose.
 */
import { readFileSync } from 'node:fs';
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
