import { describe, it, expect } from 'vitest';
import type { OnlineResult } from '@bibdesk/shared';
import { importPdfsSmart, type SmartPdfDeps } from './import-smart.js';

/** A looked-up result (only entryType + fields are used downstream). */
const result = (fields: Record<string, string>): OnlineResult =>
  ({ entryType: 'article', fields }) as unknown as OnlineResult;

/** Build deps with sensible "nothing found" defaults + call recording. */
function makeDeps(over: Partial<SmartPdfDeps> = {}) {
  const calls = { attached: [] as Array<[string, string]>, imported: [] as Record<string, string>[] };
  let n = 0;
  const deps: SmartPdfDeps = {
    extractText: async () => '',
    extractDoi: () => null,
    extractArxivId: () => null,
    findExisting: () => null,
    attachmentNames: () => [],
    addAttachment: (id, pdf) => calls.attached.push([id, pdf]),
    lookupDoi: async () => [],
    lookupArxiv: async () => [],
    importEntry: (_t, fields) => {
      calls.imported.push(fields);
      return `new${++n}`;
    },
    ...over,
  };
  return { deps, calls };
}

describe('importPdfsSmart', () => {
  it('creates an entry from a DOI and attaches the PDF', async () => {
    const { deps, calls } = makeDeps({
      extractDoi: () => '10.1/abc',
      lookupDoi: async () => [result({ Title: 'Found' })],
    });
    const r = await importPdfsSmart(['/x/paper.pdf'], deps);
    expect(r.summary).toEqual({ created: 1, linked: 0, review: 0 });
    expect(r.addedIds).toEqual(['new1']);
    expect(r.review).toEqual([]);
    expect(calls.attached).toEqual([['new1', '/x/paper.pdf']]);
  });

  it('falls back to the arXiv id when there is no DOI', async () => {
    const { deps, calls } = makeDeps({
      extractArxivId: () => '2301.01234',
      lookupArxiv: async () => [result({ Title: 'Preprint', Eprint: '2301.01234' })],
    });
    const r = await importPdfsSmart(['/x/pre.pdf'], deps);
    expect(r.summary).toEqual({ created: 1, linked: 0, review: 0 });
    expect(calls.imported[0]).toMatchObject({ Eprint: '2301.01234' });
  });

  it('prefers the DOI when both a DOI and an arXiv id are present', async () => {
    const arxiv = spy();
    const { deps } = makeDeps({
      extractDoi: () => '10.1/abc',
      extractArxivId: () => '2301.01234',
      lookupDoi: async () => [result({ Title: 'Found' })],
      lookupArxiv: arxiv.fn,
    });
    await importPdfsSmart(['/x/paper.pdf'], deps);
    expect(arxiv.calls).toBe(0); // arXiv lookup never consulted
  });

  it('links to an existing entry instead of duplicating, and AutoFiles the PDF', async () => {
    const { deps, calls } = makeDeps({
      extractDoi: () => '10.1/abc',
      findExisting: () => 'exist1',
    });
    const r = await importPdfsSmart(['/x/paper.pdf'], deps);
    expect(r.summary).toEqual({ created: 0, linked: 1, review: 0 });
    expect(r.addedIds).toEqual(['exist1']);
    expect(calls.attached).toEqual([['exist1', '/x/paper.pdf']]);
    expect(calls.imported).toEqual([]); // no lookup / new entry
  });

  it('does not re-attach when the existing entry already has that file', async () => {
    const { deps, calls } = makeDeps({
      extractArxivId: () => '2301.01234',
      findExisting: () => 'exist1',
      attachmentNames: () => ['paper.pdf'],
    });
    const r = await importPdfsSmart(['/x/PAPER.pdf'], deps); // basename match is case-insensitive
    expect(r.summary.linked).toBe(1);
    expect(calls.attached).toEqual([]); // skipped — already attached
  });

  it('sends a no-identifier PDF to review (NOT auto-created)', async () => {
    const { deps, calls } = makeDeps();
    const r = await importPdfsSmart(['/x/scan.pdf'], deps);
    expect(r.summary).toEqual({ created: 0, linked: 0, review: 1 });
    expect(r.review).toEqual(['/x/scan.pdf']);
    expect(r.addedIds).toEqual([]);
    expect(calls.imported).toEqual([]); // nothing created
  });

  it('sends a PDF to review when the lookup returns nothing or rejects', async () => {
    const miss = makeDeps({ extractDoi: () => '10.1/none', lookupDoi: async () => [] });
    expect((await importPdfsSmart(['/x/a.pdf'], miss.deps)).review).toEqual(['/x/a.pdf']);

    const reject = makeDeps({
      extractDoi: () => '10.1/err',
      lookupDoi: async () => {
        throw new Error('network');
      },
    });
    expect((await importPdfsSmart(['/x/b.pdf'], reject.deps)).review).toEqual(['/x/b.pdf']);
  });

  it('tallies a mixed batch', async () => {
    let i = 0;
    const { deps } = makeDeps({
      // first PDF → DOI hit (created); second → existing (linked); third → nothing (review)
      extractDoi: () => (i++ === 0 ? '10.1/abc' : null),
      lookupDoi: async () => [result({ Title: 'Found' })],
      findExisting: (ids) => (ids.arxivId === '2301.01234' ? 'exist1' : null),
      extractArxivId: () => (i === 2 ? '2301.01234' : null),
    });
    const r = await importPdfsSmart(['/x/1.pdf', '/x/2.pdf', '/x/3.pdf'], deps);
    expect(r.summary).toEqual({ created: 1, linked: 1, review: 1 });
    expect(r.review).toEqual(['/x/3.pdf']);
  });
});

/** Tiny call-counter (avoids pulling in vitest's mock machinery for one count). */
function spy() {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    fn: async () => {
      state.calls++;
      return [] as OnlineResult[];
    },
  };
}
