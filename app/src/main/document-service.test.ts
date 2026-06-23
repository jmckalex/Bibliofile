/**
 * Headless tests for the pure document-service layer (no Electron). Loads the
 * real BibDesk-authored `BD test.bib` fixture and exercises the full open → rows
 * → groups → detail path the IPC handlers expose.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';

import {
  DocumentStore,
  formatAuthorsDisplay,
  openLibraryFromText,
  toDisplay,
} from './document-service.js';
import { FtsIndex } from './fts.js';

/** Whether the native FTS backend loads in this runtime (skips FTS tests if not). */
const FTS_AVAILABLE = ((): boolean => {
  const i = new FtsIndex();
  const ok = i.available;
  i.close();
  return ok;
})();

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

  it('fieldSuggestions dedupes values and tokenizes keywords', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      [
        '@article{a, Journal = {Nature}, Keywords = {physics, optics}}',
        '@article{b, Journal = {Nature}, Keywords = {optics, lasers}}',
        '@article{c, Journal = {Science}}',
      ].join('\n'),
      '/tmp/sug.bib',
    );
    expect(store.fieldSuggestions(documentId, 'Journal').values).toEqual(['Nature', 'Science']);
    // Keywords are split into individual, deduped tags (sorted).
    expect(store.fieldSuggestions(documentId, 'Keywords').values).toEqual(['lasers', 'optics', 'physics']);
  });

  it('batchEdit applies set-field / add-keyword / delete across a selection', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      '@article{a, Title = {A}}\n@article{b, Title = {B}, Keywords = {x}}\n@book{c, Title = {C}}',
      '/tmp/batch.bib',
    );
    const ids = store.listPublications({ documentId, offset: 0, limit: -1 }).rows;
    const idOf = (k: string): string => ids.find((r) => r.citeKey === k)!.id;

    // set a field on a + b
    const r1 = store.batchEdit(documentId, [idOf('a'), idOf('b')], { kind: 'setField', field: 'Year', value: '2020' });
    expect(r1.count).toBe(2);
    expect(store.getItemDetail({ documentId, itemId: idOf('a') }).fields.find((f) => f.name === 'Year')?.rawValue).toBe('2020');

    // add a keyword to a + b (b already has 'x' → union)
    store.batchEdit(documentId, [idOf('a'), idOf('b')], { kind: 'addKeyword', keyword: 'topic' });
    const bKw = store.getItemDetail({ documentId, itemId: idOf('b') }).fields.find((f) => f.name === 'Keywords')?.rawValue ?? '';
    expect(bKw.split(',').map((k) => k.trim()).sort()).toEqual(['topic', 'x']);

    // delete a + c
    const del = store.batchEdit(documentId, [idOf('a'), idOf('c')], { kind: 'delete' });
    expect(del.count).toBe(2);
    expect(store.listPublications({ documentId, offset: 0, limit: -1 }).rows.map((r) => r.citeKey)).toEqual(['b']);
  });

  it('mergeEntries fills missing fields, unions keywords, and deletes the others', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      [
        '@article{a, Author = {A. Smith}, Title = {Widgets}, Keywords = {x, y}}',
        '@article{b, Author = {A. Smith}, Title = {Widgets}, Year = {2020}, Doi = {10.1/w}, Keywords = {y, z}}',
      ].join('\n'),
      '/tmp/m.bib',
    );
    const ids = store.listPublications({ documentId, offset: 0, limit: -1 }).rows;
    const a = ids.find((r) => r.citeKey === 'a')!.id;
    const b = ids.find((r) => r.citeKey === 'b')!.id;

    const res = store.applyEdit({ documentId, command: { kind: 'mergeEntries', primaryId: a, otherIds: [b] } });
    expect(res.affectedItemId).toBe(a);

    const rows = store.listPublications({ documentId, offset: 0, limit: -1 }).rows;
    expect(rows).toHaveLength(1); // b was deleted
    const detail = store.getItemDetail({ documentId, itemId: a });
    const field = (n: string): string => detail.fields.find((f) => f.name.toLowerCase() === n)?.rawValue ?? '';
    expect(field('year')).toBe('2020'); // gained from b (a had none)
    expect(field('doi')).toBe('10.1/w'); // gained from b
    // keywords unioned (order preserved, deduped)
    expect(field('keywords').split(',').map((k) => k.trim()).sort()).toEqual(['x', 'y', 'z']);
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

  it('parses static + smart group blocks (array-of-dicts) and filters by them', () => {
    const fixture = fileURLToPath(
      new URL('../../../core/bibtex/test/fixtures/synthesized/bd-all-groups.bib', import.meta.url),
    );
    const store = new DocumentStore();
    const { documentId } = store.openText(readFileSync(fixture, 'utf8'), fixture);

    const { groups } = store.listGroups({ documentId });
    const toRead = groups.find((g) => g.name === 'To Read');
    expect(toRead).toBeDefined();
    expect(toRead!.kind).toBe('static');
    expect(toRead!.count).toBe(2); // knuth-art + smith-2020
    expect(groups.some((g) => g.name === 'Recent Articles' && g.kind === 'smart')).toBe(true);

    // Selecting the static group filters the table to its members.
    const rows = store.listPublications({ documentId, offset: 0, limit: -1, groupId: toRead!.id }).rows;
    expect(rows.map((r) => r.citeKey).sort()).toEqual(['knuth-art', 'smith-2020']);
  });

  it('groupEdit: create static group, add a member, rename, and it filters', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      '@article{a, Title = {A}}\n@book{b, Title = {B}}',
      '/tmp/g.bib',
    );
    const created = store.groupEdit({ documentId, command: { kind: 'createStatic', name: 'Picks', citeKeys: ['a'] } });
    expect(created.groupId).toBeDefined();
    const gid = created.groupId!;

    // add 'b' too
    store.groupEdit({ documentId, command: { kind: 'setMembers', groupId: gid, citeKeys: ['b'], add: true } });
    let node = store.listGroups({ documentId }).groups.find((g) => g.id === gid)!;
    expect(node.name).toBe('Picks');
    expect(node.count).toBe(2);
    expect(store.listPublications({ documentId, offset: 0, limit: -1, groupId: gid }).rows.map((r) => r.citeKey).sort()).toEqual(['a', 'b']);

    // remove 'b', rename
    store.groupEdit({ documentId, command: { kind: 'setMembers', groupId: gid, citeKeys: ['b'], add: false } });
    store.groupEdit({ documentId, command: { kind: 'rename', groupId: gid, name: 'Favourites' } });
    node = store.listGroups({ documentId }).groups.find((g) => g.id === gid)!;
    expect(node.name).toBe('Favourites');
    expect(node.count).toBe(1);

    // the group survives a serialize → re-parse round-trip
    const reopened = new DocumentStore();
    const r2 = reopened.openText(store.serializeDocument(documentId), '/tmp/g.bib');
    expect(reopened.listGroups({ documentId: r2.documentId }).groups.some((g) => g.name === 'Favourites' && g.kind === 'static')).toBe(true);
  });

  it('groupEdit: create a smart group that round-trips and filters', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      '@article{x, Title = {Quantum optics}}\n@book{y, Title = {Cooking}}',
      '/tmp/sg.bib',
    );
    const res = store.groupEdit({
      documentId,
      command: { kind: 'createSmart', name: 'Optics', conjunction: 0, conditions: [{ key: 'Title', comparison: 2, value: 'optics' }] },
    });
    const gid = res.groupId!;
    const node = store.listGroups({ documentId }).groups.find((g) => g.id === gid)!;
    expect(node.kind).toBe('smart');
    expect(node.count).toBe(1); // only the optics article
    expect(store.listPublications({ documentId, offset: 0, limit: -1, groupId: gid }).rows[0]!.citeKey).toBe('x');

    // smart group (with integer conditions) survives round-trip
    const text = store.serializeDocument(documentId);
    expect(text).toContain('BibDesk Smart Groups');
    const re = new DocumentStore();
    const r2 = re.openText(text, '/tmp/sg.bib');
    const node2 = re.listGroups({ documentId: r2.documentId }).groups.find((g) => g.name === 'Optics')!;
    expect(node2.count).toBe(1);
  });

  it('groupEdit: editSmart changes name/conjunction/conditions; groupConditions reads them back', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      '@article{x, Title = {Quantum optics}, Author = {Bohr}}\n@article{y, Title = {Cooking}, Author = {Child}}',
      '/tmp/sg2.bib',
    );
    const gid = store.groupEdit({
      documentId,
      command: { kind: 'createSmart', name: 'Optics', conjunction: 0, conditions: [{ key: 'Title', comparison: 2, value: 'optics' }] },
    }).groupId!;

    // Read back what we just created.
    const before = store.groupConditions({ documentId, groupId: gid });
    expect(before).toEqual({
      name: 'Optics',
      conjunction: 0,
      conditions: [{ key: 'Title', comparison: 2, value: 'optics' }],
    });

    // Edit: rename, switch to OR, and broaden to two conditions.
    store.groupEdit({
      documentId,
      command: {
        kind: 'editSmart',
        groupId: gid,
        name: 'Physics or Food',
        conjunction: 1,
        conditions: [
          { key: 'Author', comparison: 4, value: 'Bohr' },
          { key: 'Title', comparison: 2, value: 'Cooking' },
        ],
      },
    });

    const after = store.groupConditions({ documentId, groupId: gid });
    expect(after).toEqual({
      name: 'Physics or Food',
      conjunction: 1,
      conditions: [
        { key: 'Author', comparison: 4, value: 'Bohr' },
        { key: 'Title', comparison: 2, value: 'Cooking' },
      ],
    });

    // The OR now matches both entries, and the change survives a round-trip.
    const node = store.listGroups({ documentId }).groups.find((g) => g.id === gid)!;
    expect(node.name).toBe('Physics or Food');
    expect(node.count).toBe(2);
    const re = new DocumentStore();
    const r2 = re.openText(store.serializeDocument(documentId), '/tmp/sg2.bib');
    const node2 = re.listGroups({ documentId: r2.documentId }).groups.find((g) => g.name === 'Physics or Food')!;
    expect(node2.count).toBe(2);
  });

  it('groupConditions throws for a non-smart group', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title = {One}}', '/tmp/ns.bib');
    const gid = store.groupEdit({ documentId, command: { kind: 'createStatic', name: 'Picks', citeKeys: ['a'] } }).groupId!;
    expect(() => store.groupConditions({ documentId, groupId: gid })).toThrow(/smart/i);
  });

  it('importEndnoteText: tagged .enw records merge as entries with generated keys', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{seed, Title = {Seed}}', '/tmp/en.bib');
    const res = store.importEndnoteText(
      documentId,
      '%0 Journal Article\n%A Curie, Marie\n%T On Radioactivity\n%J Annales\n%D 1903',
    );
    expect(res.addedIds).toHaveLength(1);
    expect(res.dirty).toBe(true);
    const added = store.getItemDetail({ documentId, itemId: res.addedIds[0]! });
    const f = (n: string): string | undefined =>
      added.fields.find((x) => x.name.toLowerCase() === n)?.rawValue;
    expect(added.type).toBe('article');
    expect(f('title')).toBe('On Radioactivity');
    expect(f('author')).toBe('Curie, Marie');
    expect(added.citeKey).not.toBe('imported'); // a real key was generated
    expect(store.listPublications({ documentId, offset: 0, limit: -1 }).total).toBe(2);
  });

  it('importEndnoteText: empty input reports a warning and adds nothing', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title = {One}}', '/tmp/en2.bib');
    const res = store.importEndnoteText(documentId, 'no tags here');
    expect(res.addedIds).toHaveLength(0);
    expect(res.warnings[0]).toMatch(/no endnote records/i);
  });

  it('findBrokenLinks reports only attachments missing on disk; relocate repairs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-broken-'));
    const present = join(dir, 'present.pdf');
    const replacement = join(dir, 'replacement.pdf');
    writeFileSync(present, '%PDF-1.4');
    writeFileSync(replacement, '%PDF-1.4');
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title = {One}}', join(dir, 'lib.bib'));
    const itemId = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!.id;
    // Two managed attachments: one real file, one that does not exist.
    store.addAttachments(documentId, itemId, [present, join(dir, 'missing.pdf')]);

    let broken = store.findBrokenLinks(documentId);
    expect(broken).toHaveLength(1);
    expect(broken[0]!.citeKey).toBe('a');
    expect(broken[0]!.path).toBe(join(dir, 'missing.pdf'));
    const field = broken[0]!.field!;
    expect(field).toMatch(/^Bdsk-File-\d+$/i);

    // Point the broken attachment at the real replacement file → no longer broken.
    store.relocateAttachment(documentId, itemId, field, replacement);
    expect(store.findBrokenLinks(documentId)).toHaveLength(0);
  });

  it('renameAuthor rewrites the matched name in Author/Editor across entries (and merges forms)', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      [
        '@article{a, Author = {Smith, J. and Jones, Mary}}',
        '@book{b, Author = {John Smith}, Editor = {Smith, J.}}',
        '@misc{c, Author = {Adams, Ann}}',
      ].join('\n'),
      '/tmp/ra.bib',
    );
    // Matching is by canonical normalized name: "Smith, J." matches a's author and b's
    // editor; b's author "John Smith" (a distinct first-name form) is left untouched.
    const res = store.renameAuthor(documentId, 'Smith, J.', 'Smith, John');
    expect(res.changed).toBe(2); // entry a (author) + entry b (editor); c untouched
    expect(res.dirty).toBe(true);

    const idOf = (key: string): string =>
      store.listPublications({ documentId, offset: 0, limit: -1 }).rows.find((r) => r.citeKey === key)!.id;
    const field = (key: string, f: string): string | undefined =>
      store.getItemDetail({ documentId, itemId: idOf(key) }).fields.find((x) => x.name.toLowerCase() === f)
        ?.rawValue;

    expect(field('a', 'author')).toBe('Smith, John and Jones, Mary'); // only Smith changed; Jones preserved
    expect(field('b', 'author')).toBe('John Smith'); // distinct first-name form not matched
    expect(field('b', 'editor')).toBe('Smith, John'); // the "Smith, J." editor token was rewritten
    expect(field('c', 'author')).toBe('Adams, Ann'); // unrelated author untouched

    // "John Smith" and the new "Smith, John" share a canonical name → one Authors-group entry.
    const authors = store
      .listGroups({ documentId })
      .groups.filter((g) => g.kind === 'author')
      .map((g) => g.name);
    expect(authors.filter((n) => /smith/i.test(n))).toHaveLength(1);
  });

  it('renameAuthor with an unknown name changes nothing', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Author = {Smith, John}}', '/tmp/ra2.bib');
    expect(store.renameAuthor(documentId, 'Nobody, X.', 'Someone, Y.').changed).toBe(0);
  });

  it.runIf(FTS_AVAILABLE)('ftsSearch: includePdf scopes PDF body text in/out of results', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-fts-'));
    const pdf = join(dir, 'paper.pdf');
    writeFileSync(pdf, '%PDF-1.4'); // must exist; extraction is injected below
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{x, Title = {Networks}}', join(dir, 'lib.bib'));
    const itemId = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!.id;
    store.addAttachments(documentId, itemId, [pdf]);
    // Fold a PDF body word ("alexander") into the FULL index only.
    await store.indexAttachments(documentId, async () => 'alexander bargaining dynamics');

    // A field word matches in both scopes.
    expect(store.ftsSearch(documentId, 'networks', false).ids).toEqual([itemId]);
    expect(store.ftsSearch(documentId, 'networks', true).ids).toEqual([itemId]);
    // A PDF-only word matches ONLY when PDF text is included.
    expect(store.ftsSearch(documentId, 'alexander', false).ids).toEqual([]);
    expect(store.ftsSearch(documentId, 'alexander', true).ids).toEqual([itemId]);
  });

  it('toItemDetail marks an entry type’s required fields (so they can’t be deleted)', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      '@article{a, Author = {Roe}, Title = {T}, Journal = {J}, Year = {2020}, Note = {n}}',
      '/tmp/req.bib',
    );
    const itemId = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!.id;
    const fields = store.getItemDetail({ documentId, itemId }).fields;
    const req = (name: string): boolean | undefined =>
      fields.find((f) => f.name.toLowerCase() === name)?.required;
    // BibTeX article requires author/title/journal/year.
    expect(req('author')).toBe(true);
    expect(req('title')).toBe(true);
    expect(req('journal')).toBe(true);
    expect(req('year')).toBe(true);
    // Note is optional → deletable.
    expect(req('note')).toBe(false);
  });

  it('treats Doi/Url as links, not file attachments (no "files" chip / paperclip)', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      '@article{a, Author = {Roe}, Title = {T}, Doi = {10.1000/xyz}, Url = {https://example.org}}',
      '/tmp/links.bib',
    );
    const row = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!;
    // The table paperclip counts only local files → 0 here.
    expect(row.attachmentCount).toBe(0);

    const detail = store.getItemDetail({ documentId, itemId: row.id });
    // Doi + Url surface as link-kind entries, not file attachments.
    expect(detail.files.filter((f) => f.kind === 'file')).toHaveLength(0);
    expect(detail.files.filter((f) => f.kind === 'url')).toHaveLength(2);
    // The preview card must NOT show a "files" chip for link-only entries.
    expect(detail.previewHtml ?? '').not.toMatch(/📎|class="bd-chip bd-chip--files"/);
  });

  it('undo/redo restore prior states across edits', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title = {One}}', '/tmp/u.bib');
    // Re-query the id each time — undo/redo re-parses, so item ids change (the
    // renderer reloads its selection via documentOpened).
    const firstId = (): string => store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!.id;
    const titleOf = (): string =>
      store.getItemDetail({ documentId, itemId: firstId() }).fields.find((f) => f.name.toLowerCase() === 'title')
        ?.rawValue ?? '';
    const setTitle = (v: string): void =>
      void store.applyEdit({ documentId, command: { kind: 'setField', itemId: firstId(), field: 'Title', value: v } });

    expect(store.undoState(documentId).canUndo).toBe(false);
    setTitle('Two');
    setTitle('Three');
    expect(titleOf()).toBe('Three');

    expect(store.undo(documentId)).toBe(true);
    expect(titleOf()).toBe('Two');
    expect(store.undo(documentId)).toBe(true);
    expect(titleOf()).toBe('One');
    expect(store.undo(documentId)).toBe(false); // nothing left

    expect(store.redo(documentId)).toBe(true);
    expect(titleOf()).toBe('Two');
    expect(store.redo(documentId)).toBe(true);
    expect(titleOf()).toBe('Three');

    // A fresh edit clears the redo branch.
    store.undo(documentId);
    setTitle('Four');
    expect(store.undoState(documentId).canRedo).toBe(false);
  });

  it('autoFile moves a managed attachment into the Papers folder and rewrites the path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-autofile-'));
    const docPath = join(dir, 'lib.bib');
    const store = new DocumentStore();
    const { documentId } = store.openText(
      '@article{euler1748, Author = {Leonhard Euler}, Year = {1748}}',
      docPath,
    );
    const itemId = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!.id;

    // A real source file to file away.
    const incoming = join(dir, 'incoming');
    mkdirSync(incoming);
    const src = join(incoming, 'euler.pdf');
    writeFileSync(src, '%PDF-1.4 test');
    store.addAttachments(documentId, itemId, [src]);

    const papers = join(dir, 'Papers');
    store.setEditConfig({ papersFolder: papers, autoFileFormat: '%a1%Y' });

    const res = store.autoFile(documentId, itemId);
    expect(res.moved).toBe(1);
    expect(res.errors).toEqual([]);
    expect(existsSync(src)).toBe(false); // moved out of incoming
    const filed = readdirSync(papers).filter((f) => f.endsWith('.pdf'));
    expect(filed).toHaveLength(1); // one PDF now in Papers
    // The attachment now resolves under Papers/ (the Bdsk-File path was rewritten).
    const detail = store.getItemDetail({ documentId, itemId });
    expect(detail.files[0]!.url).toContain(`${join('Papers')}`);
    expect(detail.files[0]!.url).toContain(filed[0]!);
  });

  it('autoFileOnAdd files an attachment the moment it is added', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-autofile-onadd-'));
    const store = new DocumentStore();
    const { documentId } = store.openText(
      '@article{euler1748, Author = {Leonhard Euler}, Year = {1748}}',
      join(dir, 'lib.bib'),
    );
    const itemId = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!.id;
    const papers = join(dir, 'Papers');
    store.setEditConfig({ papersFolder: papers, autoFileFormat: '%a1%Y', autoFileOnAdd: true });

    const incoming = join(dir, 'incoming');
    mkdirSync(incoming);
    const src = join(incoming, 'euler.pdf');
    writeFileSync(src, '%PDF-1.4 test');

    // Adding the attachment files it immediately — no separate autoFile() call.
    store.addAttachments(documentId, itemId, [src]);

    expect(existsSync(src)).toBe(false); // moved out of incoming on add
    expect(readdirSync(papers).filter((f) => f.endsWith('.pdf'))).toHaveLength(1);
    expect(store.getItemDetail({ documentId, itemId }).files[0]!.url).toContain(join('Papers'));
  });

  it('does NOT auto-file on add when autoFileOnAdd is off (default)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-autofile-off-'));
    const store = new DocumentStore();
    const { documentId } = store.openText(
      '@article{euler1748, Author = {Leonhard Euler}, Year = {1748}}',
      join(dir, 'lib.bib'),
    );
    const itemId = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!.id;
    const papers = join(dir, 'Papers');
    store.setEditConfig({ papersFolder: papers, autoFileFormat: '%a1%Y' }); // autoFileOnAdd off by default

    const incoming = join(dir, 'incoming');
    mkdirSync(incoming);
    const src = join(incoming, 'euler.pdf');
    writeFileSync(src, '%PDF-1.4 test');
    store.addAttachments(documentId, itemId, [src]);

    expect(existsSync(src)).toBe(true); // left in place — not filed
    expect(existsSync(papers)).toBe(false); // Papers folder never created
  });

  it('consolidateLinkedFiles bulk-files every entry, then is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-consolidate-'));
    const store = new DocumentStore();
    const { documentId } = store.openText(
      [
        '@article{euler1748, Author = {Leonhard Euler}, Year = {1748}}',
        '@book{gauss1801, Author = {Carl Gauss}, Year = {1801}}',
      ].join('\n\n'),
      join(dir, 'lib.bib'),
    );
    const rows = store.listPublications({ documentId, offset: 0, limit: -1 }).rows;

    const incoming = join(dir, 'incoming');
    mkdirSync(incoming);
    for (const r of rows) {
      const src = join(incoming, `${r.citeKey}.pdf`);
      writeFileSync(src, '%PDF-1.4 test');
      store.addAttachments(documentId, r.id, [src]);
    }

    const papers = join(dir, 'Papers');
    store.setEditConfig({ papersFolder: papers, autoFileFormat: '%a1%Y' });

    const res = store.consolidateLinkedFiles(documentId);
    expect(res.scanned).toBe(2);
    expect(res.itemsAffected).toBe(2);
    expect(res.moved).toBe(2);
    expect(res.errors).toEqual([]);
    expect(res.dirty).toBe(true);
    expect(readdirSync(papers).filter((f) => f.endsWith('.pdf'))).toHaveLength(2);

    // Re-running is a no-op: every file is already filed under Papers.
    expect(store.consolidateLinkedFiles(documentId).moved).toBe(0);
  });

  it('consolidateLinkedFiles can be limited to a subset of itemIds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-consolidate-sub-'));
    const store = new DocumentStore();
    const { documentId } = store.openText(
      [
        '@article{euler1748, Author = {Leonhard Euler}, Year = {1748}}',
        '@book{gauss1801, Author = {Carl Gauss}, Year = {1801}}',
      ].join('\n\n'),
      join(dir, 'lib.bib'),
    );
    const rows = store.listPublications({ documentId, offset: 0, limit: -1 }).rows;
    const incoming = join(dir, 'incoming');
    mkdirSync(incoming);
    const srcs = new Map<string, string>();
    for (const r of rows) {
      const src = join(incoming, `${r.citeKey}.pdf`);
      writeFileSync(src, '%PDF-1.4 test');
      store.addAttachments(documentId, r.id, [src]);
      srcs.set(r.id, src);
    }
    store.setEditConfig({ papersFolder: join(dir, 'Papers'), autoFileFormat: '%a1%Y' });

    const res = store.consolidateLinkedFiles(documentId, [rows[0]!.id]);
    expect(res.scanned).toBe(1);
    expect(res.moved).toBe(1);
    expect(existsSync(srcs.get(rows[0]!.id)!)).toBe(false); // filed
    expect(existsSync(srcs.get(rows[1]!.id)!)).toBe(true); // untouched
  });

  it('importRisText merges RIS records as new entries', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{seed, Title = {Seed}}', '/tmp/ris.bib');
    const ris = [
      'TY  - JOUR',
      'AU  - Shannon, Claude E.',
      'TI  - A Mathematical Theory of Communication',
      'JO  - Bell System Technical Journal',
      'PY  - 1948',
      'ER  -',
    ].join('\n');
    const res = store.importRisText(documentId, ris);
    expect(res.addedIds).toHaveLength(1);
    expect(res.dirty).toBe(true);

    const text = store.serializeDocument(documentId);
    expect(text.toLowerCase()).toContain('mathematical theory of communication');
    expect(text).toContain('Shannon');
    // The new entry got an auto-generated cite key from author+year.
    const rows = store.listPublications({ documentId, offset: 0, limit: -1 }).rows;
    expect(rows.some((r) => /shannon/i.test(r.citeKey) || /1948/.test(r.citeKey))).toBe(true);
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

    // RIS/CSV/HTML are supported; RTF is not yet.
    expect(store.exportText(documentId, 'ris')).toContain('TY  - ');
    expect(store.exportText(documentId, 'csv')).toContain('Cite Key,');
    expect(() => store.exportText(documentId, 'rtf')).toThrow(/not supported/i);
  });

  it('does not write empty field values to BibTeX (cleared/untouched optional fields)', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title = {T}}', '/tmp/empty.bib');
    const id = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!.id;
    // Clearing an optional field to '' (as the editor would) must not persist it.
    store.applyEdit({ documentId, command: { kind: 'setField', itemId: id, field: 'Url', value: '' } });
    const text = store.exportText(documentId, 'bibtex');
    expect(text).not.toMatch(/^\s*url\s*=/im); // empty field dropped on write
    expect(text).toContain('title = '); // real fields still written
  });

  it('selectFromAux matches cited keys to items (in .aux order) and reports missing ones', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      ['@article{knuth1984, Title = {A}}', '@book{lamport1994, Title = {B}}'].join('\n\n'),
      '/tmp/aux.bib',
    );
    const ids = new Map(
      store.listPublications({ documentId, offset: 0, limit: -1 }).rows.map((r) => [r.citeKey, r.id]),
    );
    const res = store.selectFromAux(documentId, '\\citation{knuth1984,missing2000}\n\\citation{lamport1994}');
    expect(res.matchedKeys).toEqual(['knuth1984', 'lamport1994']);
    expect(res.matchedIds).toEqual([ids.get('knuth1984'), ids.get('lamport1994')]);
    expect(res.missingKeys).toEqual(['missing2000']);
  });

  it('folders: create, nest a group, and round-trip through the .bib', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title = {A}}', '/tmp/folders.bib');
    const groupId = store.groupEdit({
      documentId,
      command: { kind: 'createStatic', name: 'Required', citeKeys: ['a'] },
    }).groupId!;
    const folderId = store.groupEdit({ documentId, command: { kind: 'createFolder', name: 'PH456' } }).groupId!;
    store.groupEdit({ documentId, command: { kind: 'setGroupFolder', groupId, folderId } });

    const { groups } = store.listGroups({ documentId });
    expect(groups.find((n) => n.kind === 'folder' && n.name === 'PH456')?.id).toBe(folderId);
    expect(groups.find((n) => n.id === groupId)?.parentId).toBe(folderId);

    // Serialize → the folder block is embedded in the .bib; reopen and it survives.
    const text = store.exportText(documentId, 'bibtex');
    expect(text).toContain('BibDesk-Electron Folders');
    const reopened = new DocumentStore();
    const { documentId: d2 } = reopened.openText(text, '/tmp/folders.bib');
    const g2 = reopened.listGroups({ documentId: d2 }).groups;
    const folder2 = g2.find((n) => n.kind === 'folder' && n.name === 'PH456');
    expect(folder2).toBeDefined();
    expect(g2.find((n) => n.kind === 'static' && n.name === 'Required')?.parentId).toBe(folder2!.id);
  });

  it('folderExportPlan maps folder→group directories to member attachment paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-folderexport-'));
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title = {A}}', join(dir, 'lib.bib'));
    const itemId = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!.id;
    const src = join(dir, 'a.pdf');
    writeFileSync(src, '%PDF-1.4 test');
    store.addAttachments(documentId, itemId, [src]);

    const groupId = store.groupEdit({
      documentId,
      command: { kind: 'createStatic', name: 'Required', citeKeys: ['a'] },
    }).groupId!;
    const folderId = store.groupEdit({ documentId, command: { kind: 'createFolder', name: 'PH456' } }).groupId!;
    store.groupEdit({ documentId, command: { kind: 'setGroupFolder', groupId, folderId } });

    const plan = store.folderExportPlan(documentId, folderId);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.dir).toBe('PH456/Required');
    expect(plan[0]!.files).toHaveLength(1);
    expect(plan[0]!.files[0]!.endsWith('a.pdf')).toBe(true);
  });

  it('incompleteItemIds flags entries missing a required field for their type', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      [
        '@article{full, Author = {A}, Title = {T}, Journal = {J}, Year = {2020}}',
        '@article{notitle, Author = {A}, Journal = {J}, Year = {2020}}',
      ].join('\n\n'),
      '/tmp/incomplete.bib',
    );
    const rows = store.listPublications({ documentId, offset: 0, limit: -1 }).rows;
    const idOf = (k: string): string => rows.find((r) => r.citeKey === k)!.id;
    const incomplete = store.incompleteItemIds(documentId);
    expect(incomplete).toContain(idOf('notitle')); // missing required Title
    expect(incomplete).not.toContain(idOf('full'));
  });

  it('exportText bibtex-minimal keeps bibliographic fields, drops admin ones', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      '@article{a, Author = {A}, Title = {T}, Year = {2020}, Date-Added = {2020}, Date-Modified = {2021}, Rating = {3}, Read = {1}}',
      '/tmp/min.bib',
    );
    const id = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!.id;
    const text = store.exportText(documentId, 'bibtex-minimal', [id]);
    expect(text).toContain('author = {A}');
    expect(text).toContain('title = {T}');
    expect(text).toContain('year = {2020}');
    expect(text).not.toMatch(/date-added/i);
    expect(text).not.toMatch(/date-modified/i);
    expect(text).not.toMatch(/rating/i);
    expect(text).not.toMatch(/read\s*=/i);
  });

  it('addEntry with a crossref sets the Crossref field on the new entry', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@book{parent, Title = {P}}', '/tmp/cr.bib');
    const res = store.applyEdit({ documentId, command: { kind: 'addEntry', entryType: 'inbook', crossref: 'parent' } });
    const detail = store.getItemDetail({ documentId, itemId: res.affectedItemId! });
    expect(detail.fields.find((f) => f.name.toLowerCase() === 'crossref')?.rawValue).toBe('parent');
  });

  it('undo/redo carry an action label for the Edit menu', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title = {A}}', '/tmp/undo.bib');
    const id = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!.id;
    expect(store.undoState(documentId).canUndo).toBe(false);
    store.applyEdit({ documentId, command: { kind: 'setField', itemId: id, field: 'Year', value: '2020' } });
    expect(store.undoState(documentId)).toMatchObject({ canUndo: true, undoLabel: 'Set Field' });
    expect(store.undo(documentId)).toBe(true);
    expect(store.undoState(documentId)).toMatchObject({ canRedo: true, redoLabel: 'Set Field' });
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
      sort: [{ key: 'citeKey', direction: 'asc' }],
    });
    expect(page.total).toBe(3);
    expect(page.rows).toHaveLength(2);
  });

  it('sorts by multiple keys in priority order (secondary breaks ties)', () => {
    const store = new DocumentStore();
    const text = [
      '@article{a, title={A}, year={2020}}',
      '@book{b, title={B}, year={2019}}',
      '@article{c, title={C}, year={2018}}',
    ].join('\n\n');
    const { documentId } = store.openText(text, '/tmp/multi.bib');

    // Primary: type asc (article < book). Secondary: year desc.
    const { rows } = store.listPublications({
      documentId,
      offset: 0,
      limit: -1,
      sort: [
        { key: 'type', direction: 'asc' },
        { key: 'year', direction: 'desc' },
      ],
    });
    expect(rows.map((r) => r.citeKey)).toEqual(['a', 'c', 'b']);
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

  it('opens a Windows-1252 file, decodes it, and saves back in the same encoding', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-enc-'));
    const file = join(dir, 'lib.bib');
    // '€' is in Windows-1252 (0x80) and has NO TeX form, so it survives serialization
    // as a literal char — a clean probe that the encoding is preserved on save.
    // (Accents like é are written the BibTeX way, {\'e}, so they become ASCII.)
    const original = '@article{a, author = {Café Müller}, title = {Price €5}, year = {2020}}\n';
    writeFileSync(file, iconv.encode(original, 'windows-1252')); // 8-bit bytes, invalid as UTF-8

    const store = new DocumentStore();
    const opened = store.openFile(file);
    expect(opened.encoding).toBe('windows-1252'); // detected (not valid UTF-8 → 8-bit fallback)
    const { rows } = store.listPublications({ documentId: opened.documentId, offset: 0, limit: -1 });
    const detail = store.getItemDetail({ documentId: opened.documentId, itemId: rows[0]!.id });
    expect(detail.fields.find((f) => f.name.toLowerCase() === 'author')?.value).toContain('Café Müller');
    expect(detail.fields.find((f) => f.name.toLowerCase() === 'title')?.value).toContain('€');

    store.saveDocument(opened.documentId);
    const saved = readFileSync(file);
    expect(saved.includes(0x80)).toBe(true); // '€' as one Windows-1252 byte…
    expect(saved.includes(0xe2)).toBe(false); // …NOT re-encoded as the UTF-8 '€' (E2 82 AC)
    const roundtrip = iconv.decode(saved, 'windows-1252');
    expect(roundtrip).toContain('€');
    expect(roundtrip).toContain("{\\'e}"); // accents written as TeX (ASCII)
  });

  it('flags a lossy save and offers UTF-8 / Windows-1252 as non-lossy alternatives', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-enc2-'));
    const file = join(dir, 'lib.bib');
    writeFileSync(file, iconv.encode('@article{a, title = {Price €5}, year = {2020}}\n', 'windows-1252'));
    const store = new DocumentStore();
    const opened = store.openFile(file); // detected windows-1252 (€ = 0x80 there)
    expect(store.saveEncodingPreview(opened.documentId).lossy).toBe(false); // € fits in Windows-1252
    expect(store.saveEncodingPreview(opened.documentId, 'iso-8859-1')).toMatchObject({
      lossy: true,
      lostChars: ['€'], // Latin-1 has no euro sign and € has no TeX form
    });
    expect(store.saveEncodingPreview(opened.documentId, 'utf8').lossy).toBe(false);
  });

  it('reinterpret re-reads the file with a chosen encoding', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-enc3-'));
    const file = join(dir, 'lib.bib');
    // Mac Roman 'é' is 0x8E — auto-detect mis-guesses Windows-1252 (where 0x8E is 'Ž').
    writeFileSync(file, iconv.encode('@article{a, title = {café}, year = {2020}}\n', 'macintosh'));
    const store = new DocumentStore();
    const opened = store.openFile(file);
    const re = store.setDocumentEncoding(opened.documentId, 'macintosh'); // reinterpret
    expect(re.encoding).toBe('macintosh');
    const { rows } = store.listPublications({ documentId: opened.documentId, offset: 0, limit: -1 });
    const title = store
      .getItemDetail({ documentId: opened.documentId, itemId: rows[0]!.id })
      .fields.find((f) => f.name.toLowerCase() === 'title');
    expect(title?.value).toContain('café');
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
