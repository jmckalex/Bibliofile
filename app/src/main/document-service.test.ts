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

  it('importBibtexText merges pasted entries and disambiguates colliding keys', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title = {A}}', '/tmp/p.bib');
    const before = store.listPublications({ documentId, offset: 0, limit: -1 }).total;

    // One fresh key + one that collides with the existing "a".
    const res = store.importBibtexText(
      documentId,
      '@book{newkey, Title = {Fresh}}\n@article{a, Title = {Dup}}',
    );
    expect(res.addedIds).toHaveLength(2);
    expect(res.dirty).toBe(true);

    const rows = store.listPublications({ documentId, offset: 0, limit: -1 });
    expect(rows.total).toBe(before + 2);
    const keys = rows.rows.map((r) => r.citeKey);
    expect(keys).toContain('newkey');
    expect(keys.filter((k) => k === 'a')).toHaveLength(1); // original kept
    expect(keys.some((k) => k.startsWith('a-'))).toBe(true); // collision disambiguated
  });

  it('findReplace previews then applies across fields', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      '@article{a, Title = {Color of the sky}, Note = {color theory}}\n@book{b, Title = {Colorful}}',
      '/tmp/fr.bib',
    );

    // Preview (apply: false) does not mutate.
    const preview = store.findReplace({
      documentId,
      find: 'Color',
      replace: 'Colour',
      regex: false,
      caseSensitive: true,
      apply: false,
    });
    expect(preview.applied).toBe(false);
    expect(preview.total).toBe(2); // "Color of the sky" + "Colorful" (case-sensitive)
    expect(preview.matches).toHaveLength(2);
    expect(store.isDirty(documentId)).toBe(false);

    // Restrict to the Title field, case-insensitive, and apply.
    const applied = store.findReplace({
      documentId,
      field: 'Title',
      find: 'color',
      replace: 'colour',
      regex: false,
      caseSensitive: false,
      apply: true,
    });
    expect(applied.applied).toBe(true);
    expect(applied.total).toBe(2);
    expect(store.isDirty(documentId)).toBe(true);

    const text = store.serializeDocument(documentId);
    expect(text).toContain('colour of the sky');
    expect(text).toContain('colourful');
    expect(text).toContain('color theory'); // Note field untouched (Title-only scope)
  });

  it('findDuplicates groups identical cite keys and equivalent content', () => {
    const store = new DocumentStore();
    // Two entries that are content-equivalent (same type + fields) with different
    // keys, plus a distinct third entry.
    const { documentId } = store.openText(
      [
        '@article{one, Author = {A. Smith}, Title = {Widgets}, Year = {2020}}',
        '@article{two, Author = {A. Smith}, Title = {Widgets}, Year = {2020}}',
        '@book{three, Author = {B. Jones}, Title = {Gadgets}, Year = {2019}}',
      ].join('\n'),
      '/tmp/dup.bib',
    );
    const res = store.findDuplicates(documentId);
    // 'one' and 'two' are equivalent content; 'three' is unique.
    const content = res.groups.find((g) => g.kind === 'content');
    expect(content).toBeDefined();
    expect(content!.entries.map((e) => e.citeKey).sort()).toEqual(['one', 'two']);
    expect(res.total).toBe(2);
  });

  it('findReplace reports an invalid regex instead of throwing', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title = {x}}', '/tmp/fr.bib');
    const res = store.findReplace({
      documentId,
      find: '(',
      replace: 'y',
      regex: true,
      caseSensitive: false,
      apply: true,
    });
    expect(res.error).toBeTruthy();
    expect(res.total).toBe(0);
    expect(store.isDirty(documentId)).toBe(false);
  });

  it('importBibtexText warns when no entries are found', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title = {A}}', '/tmp/p.bib');
    const res = store.importBibtexText(documentId, 'just some prose, not bibtex');
    expect(res.addedIds).toHaveLength(0);
    expect(res.warnings.join(' ')).toMatch(/no bibtex entries/i);
  });

  it('listPublications populates extra-field columns (de-TeXified)', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      '@article{a, Title = {T}, Journal = {J. of {T}ests}, Volume = {12}}',
      '/tmp/cols.bib',
    );
    const res = store.listPublications({
      documentId,
      offset: 0,
      limit: -1,
      extraFields: ['Journal', 'Volume'],
    });
    const row = res.rows[0]!;
    expect(row.extra).toBeDefined();
    expect(row.extra!['Journal']).toBe('J. of Tests'); // protective braces stripped
    expect(row.extra!['Volume']).toBe('12');
    // Without extraFields, no extra map is attached.
    const plain = store.listPublications({ documentId, offset: 0, limit: -1 });
    expect(plain.rows[0]!.extra).toBeUndefined();
  });

  it('exportText: whole library vs a selected subset (BibTeX)', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(BIB, FIXTURE);

    const all = store.exportText(documentId, 'bibtex');
    expect(all).toContain('@'); // serialized entries
    // round-trips to the same shape the serializer produces for the whole lib
    expect(all).toBe(store.serializeDocument(documentId));

    const { rows } = store.listPublications({ documentId, offset: 0, limit: -1 });
    const one = rows.find((r) => r.citeKey === 'chen-complex')!;
    const subset = store.exportText(documentId, 'bibtex', [one.id]);
    expect(subset).toContain('chen-complex');
    expect(subset).not.toContain('math.DG/0106179'); // only the selected entry

    expect(() => store.exportText(documentId, 'ris')).toThrow(/not supported/i);
  });

  it('projects icon-column flags (keywords, attachments, read, rating)', () => {
    const store = new DocumentStore();
    const FLAGS = `
@article{flagged,
  Author = {A. Author},
  Title = {Flagged entry},
  Keywords = {alpha, beta},
  Read = {Yes},
  Rating = {4},
  Local-Url = {file:///tmp/x.pdf},
  Bdsk-File-1 = {ignored-blob}}

@book{bare,
  Author = {B. Author},
  Title = {Bare entry}}
`;
    const { documentId } = store.openText(FLAGS, '/tmp/flags.bib');
    const { rows } = store.listPublications({ documentId, offset: 0, limit: -1 });

    const flagged = rows.find((r) => r.citeKey === 'flagged')!;
    expect(flagged.hasKeywords).toBe(true);
    expect(flagged.read).toBe(1);
    expect(flagged.rating).toBe(4);
    expect(flagged.attachmentCount).toBe(2); // Local-Url + Bdsk-File-1

    const bare = rows.find((r) => r.citeKey === 'bare')!;
    expect(bare.hasKeywords).toBe(false);
    expect(bare.read).toBe(0); // unset -> tri-state 0
    expect(bare.rating).toBe(0);
    expect(bare.attachmentCount).toBe(0);
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

  it('applyEdit: add / duplicate / delete entries and edit cite keys', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(BIB, FIXTURE);
    const idOf = (citeKey: string) =>
      store.listPublications({ documentId, offset: 0, limit: -1 }).rows.find(
        (r) => r.citeKey === citeKey,
      )!.id;

    // add a new entry
    const added = store.applyEdit({ documentId, command: { kind: 'addEntry', entryType: 'book' } });
    expect(added.dirty).toBe(true);
    expect(added.affectedItemId).toBeDefined();
    expect(store.listPublications({ documentId, offset: 0, limit: -1 }).total).toBe(4);

    // set a field + cite key on the new entry
    store.applyEdit({
      documentId,
      command: { kind: 'setField', itemId: added.affectedItemId!, field: 'Title', value: 'A New Book' },
    });
    store.applyEdit({
      documentId,
      command: { kind: 'setCiteKey', itemId: added.affectedItemId!, citeKey: 'new-book' },
    });
    const newRow = store
      .listPublications({ documentId, offset: 0, limit: -1 })
      .rows.find((r) => r.id === added.affectedItemId);
    expect(newRow?.citeKey).toBe('new-book');
    expect(newRow?.title).toBe('A New Book');

    // duplicate it -> unique cite key
    const dup = store.applyEdit({
      documentId,
      command: { kind: 'duplicateEntry', itemId: added.affectedItemId! },
    });
    expect(store.listPublications({ documentId, offset: 0, limit: -1 }).total).toBe(5);
    const dupRow = store
      .listPublications({ documentId, offset: 0, limit: -1 })
      .rows.find((r) => r.id === dup.affectedItemId);
    expect(dupRow?.citeKey).toBe('new-book-copy');
    expect(dupRow?.title).toBe('A New Book');

    // delete the duplicate
    store.applyEdit({ documentId, command: { kind: 'deleteEntry', itemId: dup.affectedItemId! } });
    expect(store.listPublications({ documentId, offset: 0, limit: -1 }).total).toBe(4);
    // original chen-complex still present
    expect(idOf('chen-complex')).toBeDefined();
  });

  it('applyEdit: generateCiteKey derives a key from author+year', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(BIB, FIXTURE);
    const target = store
      .listPublications({ documentId, offset: 0, limit: -1 })
      .rows.find((r) => r.citeKey === 'chen-complex')!;
    const res = store.applyEdit({
      documentId,
      command: { kind: 'generateCiteKey', itemId: target.id },
    });
    const newKey = res.detail!.citeKey;
    // Chen, 1999 -> a key containing the author surname and the year
    expect(newKey.toLowerCase()).toContain('chen');
    expect(newKey).toContain('1999');
  });

  it('applyEdit: macros can be set, listed, and removed', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(BIB, FIXTURE);
    store.applyEdit({ documentId, command: { kind: 'setMacro', name: 'jacm', value: 'J. ACM' } });
    let macros = store.listMacros({ documentId }).macros;
    expect(macros.find((m) => m.name.toLowerCase() === 'jacm')?.value).toBe('J. ACM');
    store.applyEdit({ documentId, command: { kind: 'removeMacro', name: 'jacm' } });
    macros = store.listMacros({ documentId }).macros;
    expect(macros.find((m) => m.name.toLowerCase() === 'jacm')).toBeUndefined();
  });

  it('cslItemFor maps a BibItem to CSL-JSON', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(BIB, FIXTURE);
    const id = store
      .listPublications({ documentId, offset: 0, limit: -1 })
      .rows.find((r) => r.citeKey === 'chen-complex')!.id;
    const csl = store.cslItemFor(documentId, id) as Record<string, unknown>;
    expect(csl.type).toBe('article-journal');
    expect(csl.id).toBe('chen-complex');
    expect(String(csl.title)).toContain('Calabi-Yau'); // braces stripped
    expect(csl.issued).toEqual({ 'date-parts': [[1999]] });
    const authors = csl.author as Array<Record<string, string>>;
    expect(authors[0]?.family).toBe('Chen');
    expect(authors[0]?.given).toBe('Jingyi');
  });

  it('attachments: add (Bdsk-File-N), resolve, round-trip, and remove', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-att-'));
    const file = join(dir, 'lib.bib');
    writeFileSync(file, BIB, 'utf8');
    const pdf = join(dir, 'paper.pdf');
    writeFileSync(pdf, '%PDF-1.4 fake', 'utf8');

    const store = new DocumentStore();
    const opened = store.openFile(file);
    const target = store
      .listPublications({ documentId: opened.documentId, offset: 0, limit: -1 })
      .rows.find((r) => r.citeKey === 'chen-complex')!;

    const res = store.addAttachments(opened.documentId, target.id, [pdf]);
    const att = res.detail!.files.find((f) => f.field);
    expect(att).toBeDefined();
    expect(att!.displayName).toBe('paper.pdf');
    expect(att!.field).toBe('Bdsk-File-1');

    // round-trip: serialize -> reparse -> the attachment resolves again
    const text = store.serializeDocument(opened.documentId);
    expect(text.toLowerCase()).toContain('bdsk-file-1'); // serializer lowercases field names
    const store2 = new DocumentStore();
    const opened2 = store2.openText(text, file);
    const t2 = store2
      .listPublications({ documentId: opened2.documentId, offset: 0, limit: -1 })
      .rows.find((r) => r.citeKey === 'chen-complex')!;
    const d2 = store2.getItemDetail({ documentId: opened2.documentId, itemId: t2.id });
    expect(d2.files.some((f) => f.displayName === 'paper.pdf' && f.field)).toBe(true);

    // remove
    store.removeAttachment(opened.documentId, target.id, 'Bdsk-File-1');
    const d3 = store.getItemDetail({ documentId: opened.documentId, itemId: target.id });
    expect(d3.files.some((f) => f.field === 'Bdsk-File-1')).toBe(false);
  });

  it('importEntry creates a new entry with a generated cite key', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(BIB, FIXTURE);
    const before = store.listPublications({ documentId, offset: 0, limit: -1 }).total;
    const res = store.importEntry(documentId, 'article', {
      Author: 'Smith, Jane',
      Title: 'An Imported Paper',
      Year: '2021',
      Journal: 'J. Imports',
    });
    expect(res.dirty).toBe(true);
    expect(store.listPublications({ documentId, offset: 0, limit: -1 }).total).toBe(before + 1);
    const detail = res.detail!;
    expect(detail.citeKey.toLowerCase()).toContain('smith');
    expect(detail.citeKey).toContain('2021');
    expect(detail.fields.find((f) => f.name === 'Title')?.value).toBe('An Imported Paper');
  });

  it('ftsSearch finds entries by field text (SQLite FTS5)', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(BIB, FIXTURE);
    const res = store.ftsSearch(documentId, 'gerbes');
    if (!res.available) return; // native FTS not loadable for this ABI → skip
    expect(res.ids.length).toBeGreaterThanOrEqual(1);
    const rows = store.listPublications({ documentId, offset: 0, limit: -1 }).rows;
    const keys = res.ids.map((id) => rows.find((r) => r.id === id)?.citeKey ?? '');
    // "gerbes" appears in the two math.DG entry titles
    expect(keys.some((k) => k.startsWith('math.DG'))).toBe(true);
    // a word that doesn't occur returns nothing
    expect(store.ftsSearch(documentId, 'zzzznotaword').ids).toEqual([]);
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
