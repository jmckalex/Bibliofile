import { describe, it, expect } from 'vitest';
import { DocumentStore } from './document-service.js';
import { runScript, fireDocumentChange, clearDocumentHooks } from './script-host.js';

const BIB =
  '@article{a, author = {Smith, Jane}, title = {Alpha}, year = {2020}}\n' +
  '@book{b, author = {G{\\"o}del, Kurt}, title = {Beta}, year = {1931}}\n' +
  '@article{c, author = {Roe, Sam}, title = {Gamma}, year = {2021}}';

function fresh() {
  const store = new DocumentStore();
  const { documentId } = store.openText(BIB, '/tmp/script.bib');
  return { store, documentId };
}
/** Run a script body (auto-`return`s the last expression-less form via explicit return in tests). */
const run = (store: DocumentStore, documentId: string, code: string, timeoutMs = 2000) =>
  runScript(store, documentId, code, { timeoutMs });

describe('script-host: reads', () => {
  it('lists entries and reads fields', () => {
    const { store, documentId } = fresh();
    const r = run(store, documentId, `return bibliofile.activeDocument.entries().map(e => e.citeKey);`);
    expect(r.error).toBeUndefined();
    expect(r.result).toEqual(['a', 'b', 'c']);
    expect(r.mutated).toBe(false);
  });

  it('get() reads a field; displayField de-TeXifies', () => {
    const { store, documentId } = fresh();
    expect(run(store, documentId, `return bibliofile.activeDocument.get('a').field('Title');`).result).toBe('Alpha');
    expect(run(store, documentId, `return bibliofile.activeDocument.get('b').displayField('Author');`).result).toBe(
      'Gödel, Kurt',
    );
  });

  it('search and authors work', () => {
    const { store, documentId } = fresh();
    expect(run(store, documentId, `return bibliofile.activeDocument.search('beta').map(e=>e.citeKey);`).result).toEqual(['b']);
    expect(run(store, documentId, `return bibliofile.activeDocument.get('a').authors()[0].last;`).result).toBe('Smith');
  });

  it('count + filter', () => {
    const { store, documentId } = fresh();
    expect(run(store, documentId, `return bibliofile.activeDocument.count();`).result).toBe(3);
    expect(
      run(store, documentId, `return bibliofile.activeDocument.filter(e => Number(e.field('Year')) > 2000).map(e=>e.citeKey);`).result,
    ).toEqual(['a', 'c']);
  });
});

describe('script-host: mutations route through the store', () => {
  it('setField is visible via the store and flags mutated', () => {
    const { store, documentId } = fresh();
    const r = run(store, documentId, `bibliofile.activeDocument.get('a').setField('Keywords', 'todo');`);
    expect(r.error).toBeUndefined();
    expect(r.mutated).toBe(true);
    const id = store.itemIdForCiteKey(documentId, 'a')!;
    expect(store.getItemDetail({ documentId, itemId: id }).fields.find((f) => f.name === 'Keywords')?.value).toBe('todo');
  });

  it('addEntry and import add entries', () => {
    const { store, documentId } = fresh();
    run(store, documentId, `bibliofile.activeDocument.addEntry({ type:'misc', fields:{ Title:'New' }, citeKey:'newkey' });`);
    expect(store.itemIdForCiteKey(documentId, 'newkey')).toBeTruthy();
    run(store, documentId, `bibliofile.activeDocument.import('@book{z, title={Zed}}');`);
    expect(store.itemIdForCiteKey(documentId, 'z')).toBeTruthy();
  });

  it('setMacro / removeMacro reflected in listMacros', () => {
    const { store, documentId } = fresh();
    run(store, documentId, `bibliofile.activeDocument.setMacro('pnas', 'Proc. Natl. Acad. Sci.');`);
    expect(store.listMacros({ documentId }).macros.some((m) => m.name === 'pnas')).toBe(true);
    run(store, documentId, `bibliofile.activeDocument.removeMacro('pnas');`);
    expect(store.listMacros({ documentId }).macros.some((m) => m.name === 'pnas')).toBe(false);
  });
});

describe('script-host: one undo step per run', () => {
  it('a bulk edit over every entry is a single undo', () => {
    const { store, documentId } = fresh();
    run(store, documentId, `for (const e of bibliofile.activeDocument.entries()) e.setField('Note', 'x');`);
    const noteCount = () =>
      store
        .listPublications({ documentId, offset: 0, limit: -1 })
        .rows.map((r) => store.getItemDetail({ documentId, itemId: r.id }).fields.find((f) => f.name === 'Note')?.value)
        .filter((v) => v === 'x').length;
    expect(noteCount()).toBe(3);
    expect(store.undo(documentId)).toBe(true); // ONE undo
    expect(noteCount()).toBe(0); // …reverts all three
    expect(store.undoState(documentId).canUndo).toBe(false);
  });

  it('a read-only run adds no undo step', () => {
    const { store, documentId } = fresh();
    run(store, documentId, `return bibliofile.activeDocument.count();`);
    expect(store.undoState(documentId).canUndo).toBe(false);
  });

  it('nested transaction() still collapses to one undo step', () => {
    const { store, documentId } = fresh();
    run(
      store,
      documentId,
      `bibliofile.activeDocument.transaction('batch', d => { for (const e of d.entries()) e.setField('Note','y'); });`,
    );
    expect(store.undo(documentId)).toBe(true);
    expect(store.undoState(documentId).canUndo).toBe(false);
  });
});

describe('script-host: sandbox + errors', () => {
  it('reports a runtime error with the source line', () => {
    const { store, documentId } = fresh();
    const r = run(store, documentId, `const x = 1;\nthrow new Error('boom');`);
    expect(r.error?.message).toContain('boom');
    expect(r.error?.line).toBe(2);
    expect(r.result).toBeUndefined();
  });

  it('a syntax error is reported, not thrown', () => {
    const { store, documentId } = fresh();
    expect(run(store, documentId, `this is not js (((`).error?.message).toBeTruthy();
  });

  it('captures console output in order', () => {
    const { store, documentId } = fresh();
    const r = run(store, documentId, `console.log('one', 1); console.warn('two');`);
    expect(r.output).toEqual(['one 1', 'two']);
  });

  it('does not expose require / process', () => {
    const { store, documentId } = fresh();
    expect(run(store, documentId, `return typeof require + ',' + typeof process;`).result).toBe('undefined,undefined');
  });

  it('aborts a runaway loop via the timeout', () => {
    const { store, documentId } = fresh();
    const r = run(store, documentId, `while (true) {}`, 200);
    expect(r.error?.message).toMatch(/timed out/i);
  });

  it('returns a clone-safe value for an entry', () => {
    const { store, documentId } = fresh();
    const r = run(store, documentId, `return bibliofile.activeDocument.get('a');`);
    expect(r.result).toMatchObject({ citeKey: 'a', type: 'article' });
    expect(JSON.parse(JSON.stringify(r.result))).toBeTruthy(); // clone-safe
  });
});

describe('script-host: controlled I/O (injected capabilities)', () => {
  it('exposes bibliofile.io + fetch when capabilities are provided', () => {
    const { store, documentId } = fresh();
    const written: Record<string, string> = {};
    const r = runScript(
      store,
      documentId,
      `bibliofile.io.writeText('/out.txt', 'hi');
       return [bibliofile.io.readText('/a'), bibliofile.io.exists('/yes'), bibliofile.io.exists('/no'), bibliofile.fetch('http://x/').text];`,
      {
        capabilities: {
          readText: (p) => `contents of ${p}`,
          writeText: (p, t) => void (written[p] = t),
          exists: (p) => p === '/yes',
          fetch: (url) => ({ status: 200, headers: {}, text: `body of ${url}` }),
        },
      },
    );
    expect(r.error).toBeUndefined();
    expect(r.result).toEqual(['contents of /a', true, false, 'body of http://x/']);
    expect(written['/out.txt']).toBe('hi');
  });

  it('throws when I/O is not available (default, e.g. unit context)', () => {
    const { store, documentId } = fresh();
    expect(run(store, documentId, `return bibliofile.io.readText('/x');`).error?.message).toMatch(/not available/);
    expect(run(store, documentId, `return bibliofile.fetch('http://x/');`).error?.message).toMatch(/not available/);
  });
});

describe('script-host: citations (CSL)', () => {
  const apa = { capabilities: { defaultCiteStyle: 'apa' } };

  it('entry.citation formats a bibliography reference', () => {
    const { store, documentId } = fresh();
    const r = runScript(store, documentId, `return bibliofile.activeDocument.get('a').citation();`, apa);
    expect(r.error).toBeUndefined();
    expect(String(r.result)).toMatch(/Smith.*2020.*Alpha/);
  });

  it('doc.cite produces parenthetical and textual inline citations', () => {
    const { store, documentId } = fresh();
    expect(runScript(store, documentId, `return bibliofile.activeDocument.cite(['a']);`, apa).result).toContain('(Smith, 2020)');
    expect(runScript(store, documentId, `return bibliofile.activeDocument.cite(['a'], { textual: true });`, apa).result).toContain('Smith (2020)');
  });

  it('doc.cite supports author mode (et al. / all) and pre/post-notes', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText(
      '@article{m, author = {One, A. and Two, B. and Three, C.}, title = {M}, year = {2019}}\n' +
        '@article{s, author = {Smith, Jane}, title = {Alpha}, year = {2020}}',
      '/tmp/cite.bib',
    );
    const go = (code: string): unknown => runScript(store, documentId, code, apa).result;
    expect(go(`return bibliofile.activeDocument.cite(['s'], { mode: 'author' });`)).toBe('Smith');
    expect(go(`return bibliofile.activeDocument.cite(['m'], { mode: 'author' });`)).toBe('One et al.');
    expect(go(`return bibliofile.activeDocument.cite(['m'], { mode: 'author', allAuthors: true });`)).toBe('One, Two, and Three');
    expect(go(`return bibliofile.activeDocument.cite(['s'], { prenote: 'see', postnote: 'p. 4' });`)).toContain('(see Smith, 2020, p. 4)');
    expect(go(`return bibliofile.activeDocument.cite(['s'], { textual: true, postnote: 'ch. 2' });`)).toContain('Smith (2020, ch. 2)');
  });

  it('doc.bibliography lists multiple entries; entry.cslItem returns CSL-JSON', () => {
    const { store, documentId } = fresh();
    const bib = String(runScript(store, documentId, `return bibliofile.activeDocument.bibliography(['a','c']);`, apa).result);
    expect(bib).toMatch(/Alpha/);
    expect(bib).toMatch(/Gamma/);
    expect(runScript(store, documentId, `return bibliofile.activeDocument.get('a').cslItem().title;`).result).toBe('Alpha');
  });

  it('bibliofile.citationStyles returns the injected list', () => {
    const { store, documentId } = fresh();
    const r = runScript(store, documentId, `return bibliofile.citationStyles();`, {
      capabilities: { citationStyles: () => ['apa', 'vancouver'] },
    });
    expect(r.result).toEqual(['apa', 'vancouver']);
  });
});

describe('script-host: onChange hooks', () => {
  const noteOf = (store: DocumentStore, documentId: string, key: string): string | undefined => {
    const id = store.itemIdForCiteKey(documentId, key)!;
    return store.getItemDetail({ documentId, itemId: id }).fields.find((f) => f.name === 'Note')?.value;
  };

  it('a registered hook fires on a later document change', () => {
    const { store, documentId } = fresh();
    run(store, documentId, `bibliofile.onChange(() => bibliofile.activeDocument.get('a').setField('Note', 'hooked'));`);
    expect(noteOf(store, documentId, 'a')).toBeUndefined();
    fireDocumentChange(documentId); // simulate an external mutation
    expect(noteOf(store, documentId, 'a')).toBe('hooked');
  });

  it('a new run replaces the prior run’s hooks', () => {
    const { store, documentId } = fresh();
    run(store, documentId, `bibliofile.onChange(() => bibliofile.activeDocument.get('a').setField('Note', 'first'));`);
    run(store, documentId, `return 1;`); // no hooks → clears the prior one
    fireDocumentChange(documentId);
    expect(noteOf(store, documentId, 'a')).toBeUndefined();
  });

  it('a throwing hook is isolated from its siblings', () => {
    const { store, documentId } = fresh();
    run(
      store,
      documentId,
      `bibliofile.onChange(() => { throw new Error('boom'); });
       bibliofile.onChange(() => bibliofile.activeDocument.get('a').setField('Note', 'ok'));`,
    );
    expect(() => fireDocumentChange(documentId)).not.toThrow();
    expect(noteOf(store, documentId, 'a')).toBe('ok');
  });

  it('clearDocumentHooks removes hooks', () => {
    const { store, documentId } = fresh();
    run(store, documentId, `bibliofile.onChange(() => bibliofile.activeDocument.get('a').setField('Note', 'x'));`);
    clearDocumentHooks(documentId);
    fireDocumentChange(documentId);
    expect(noteOf(store, documentId, 'a')).toBeUndefined();
  });
});
