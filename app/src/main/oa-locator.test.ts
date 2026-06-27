import { describe, it, expect } from 'vitest';
import {
  normalizeTitle,
  titleSimilarity,
  firstAuthorSurname,
  looksLikePdf,
  scoreCandidate,
  locateOa,
  nextBackoffMs,
  type Candidate,
  type LocateDeps,
} from './oa-locator.js';

describe('nextBackoffMs', () => {
  it('honours a numeric Retry-After (seconds → ms, capped at 5s)', () => {
    expect(nextBackoffMs(1, '2')).toBe(2000);
    expect(nextBackoffMs(1, '120')).toBe(5000); // capped low so we don't stall
  });
  it('grows exponentially when there is no Retry-After (jitter pinned)', () => {
    expect(nextBackoffMs(1, null, 0)).toBe(500);
    expect(nextBackoffMs(2, null, 0)).toBe(1000);
    expect(nextBackoffMs(3, null, 0)).toBe(2000);
    expect(nextBackoffMs(99, null, 0)).toBe(16_000); // capped
  });
  it('adds up to 25% jitter', () => {
    expect(nextBackoffMs(1, null, 1)).toBe(625); // 500 * 1.25
  });
});

describe('normalizeTitle', () => {
  it('de-TeXifies, strips diacritics and punctuation, lower-cases', () => {
    expect(normalizeTitle('G{\\"o}del, Escher, Bach!')).toBe('godel escher bach');
    expect(normalizeTitle('On the $E=mc^2$ Relation')).toBe('on the relation');
  });
});

describe('titleSimilarity', () => {
  it('is 1 for identical word sets (order/case/punct aside)', () => {
    expect(titleSimilarity('The Evolution of Bargaining', 'the evolution of bargaining')).toBe(1);
  });
  it('drops for unrelated titles', () => {
    expect(titleSimilarity('Quantum Gravity', 'A History of Bees')).toBeLessThan(0.2);
  });
});

describe('firstAuthorSurname', () => {
  it('handles "Last, First and …" and "First Last"', () => {
    expect(firstAuthorSurname('Gödel, Kurt and Turing, Alan')).toBe('Gödel');
    expect(firstAuthorSurname('Alan Turing and John von Neumann')).toBe('Turing');
    expect(firstAuthorSurname('')).toBe('');
  });
});

describe('looksLikePdf', () => {
  it('accepts %PDF- and rejects HTML', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7\n...'))).toBe(true);
    expect(looksLikePdf(Buffer.from('<!doctype html>'))).toBe(false);
  });
});

describe('scoreCandidate', () => {
  const cand = (title: string, year: number, authors: string[] = []): Candidate => ({ title, year, authors });
  it('is confident on a strong title + matching year + author', () => {
    const s = scoreCandidate(
      { title: 'The Evolution of Bargaining', year: '1999', authorLast: 'Alexander' },
      cand('The Evolution of Bargaining', 1999, ['J. McKenzie Alexander']),
    );
    expect(s.confident).toBe(true);
  });
  it('is not plausible when the year is far off', () => {
    const s = scoreCandidate({ title: 'The Evolution of Bargaining', year: '1999' }, cand('The Evolution of Bargaining', 1850));
    expect(s.confident).toBe(false);
    expect(s.plausible).toBe(false);
  });
  it('tolerates a subtitle via coverage', () => {
    const s = scoreCandidate(
      { title: 'Learning to Signal', year: '2009', authorLast: 'Skyrms' },
      cand('Learning to Signal: A Study of Conventions', 2009, ['Brian Skyrms']),
    );
    expect(s.confident).toBe(true);
  });
});

describe('locateOa', () => {
  const deps = (over: Partial<LocateDeps> = {}): LocateDeps => ({
    oaPdfForDoi: async () => null,
    resolveByTitle: async () => [],
    ...over,
  });

  it('DOI path: Unpaywall finds an OA PDF → attach via:doi', async () => {
    const out = await locateOa(
      { doi: '10.1/x' },
      deps({ oaPdfForDoi: async () => ({ pdfUrl: 'https://x/a.pdf' }) }),
    );
    expect(out).toMatchObject({ status: 'attach', via: 'doi', pdfUrl: 'https://x/a.pdf' });
  });

  it('DOI path: no OA copy → none (does not fall through to a title search)', async () => {
    let searched = false;
    const out = await locateOa(
      { doi: '10.1/x', title: 'Anything' },
      deps({ oaPdfForDoi: async () => null, resolveByTitle: async () => { searched = true; return []; } }),
    );
    expect(out.status).toBe('none');
    expect(searched).toBe(false);
  });

  it('fuzzy path: a confident Crossref match with an OA PDF → attach via:fuzzy', async () => {
    const out = await locateOa(
      { title: 'The Evolution of Bargaining', year: '1999', authorLast: 'Alexander' },
      deps({
        resolveByTitle: async () => [
          { doi: '10.9/no', title: 'Unrelated Work', year: 2020, authors: [] },
          { doi: '10.1/yes', title: 'The Evolution of Bargaining', year: 1999, authors: ['J. McKenzie Alexander'] },
        ],
        oaPdfForDoi: async (doi) => (doi === '10.1/yes' ? { pdfUrl: 'https://x/yes.pdf' } : null),
      }),
    );
    expect(out).toMatchObject({ status: 'attach', via: 'fuzzy', pdfUrl: 'https://x/yes.pdf' });
  });

  it('fuzzy path: a plausible-but-unconfident match → candidate, not attached', async () => {
    const out = await locateOa(
      { title: 'The Evolution of Bargaining', year: '1999' },
      deps({
        resolveByTitle: async () => [
          { doi: '10.1/maybe', title: 'Evolution of Bargaining in Repeated Games', year: 1999, authors: [] },
        ],
        oaPdfForDoi: async () => ({ pdfUrl: 'https://x/maybe.pdf' }),
      }),
    );
    expect(out.status).toBe('candidate');
  });

  it('fuzzy path: tries multiple confident DOIs (preprint + published) for OA', async () => {
    const out = await locateOa(
      { title: 'Sharing Detailed Research Data', year: '2007', authorLast: 'Piwowar' },
      deps({
        resolveByTitle: async () => [
          { doi: '10.preprint/x', title: 'Sharing Detailed Research Data', year: 2007, authors: ['Heather Piwowar'] },
          { doi: '10.published/y', title: 'Sharing Detailed Research Data', year: 2007, authors: ['Heather Piwowar'] },
        ],
        oaPdfForDoi: async (doi) => (doi === '10.published/y' ? { pdfUrl: 'https://x/pub.pdf' } : null),
      }),
    );
    expect(out).toMatchObject({ status: 'attach', via: 'fuzzy', pdfUrl: 'https://x/pub.pdf' });
  });

  it('fuzzy path: a plausible match with NO OA PDF → none (no dead-end candidate)', async () => {
    const out = await locateOa(
      { title: 'The Evolution of Bargaining', year: '1999' },
      deps({
        resolveByTitle: async () => [
          { doi: '10.1/maybe', title: 'Evolution of Bargaining in Repeated Games', year: 1999, authors: [] },
        ],
        oaPdfForDoi: async () => null, // paywalled — nothing to review
      }),
    );
    expect(out.status).toBe('none');
  });

  it('fuzzy path: a confident match whose DOI has no OA PDF → none', async () => {
    const out = await locateOa(
      { title: 'The Evolution of Bargaining', year: '1999', authorLast: 'Alexander' },
      deps({
        resolveByTitle: async () => [
          { doi: '10.1/yes', title: 'The Evolution of Bargaining', year: 1999, authors: ['J. McKenzie Alexander'] },
        ],
        oaPdfForDoi: async () => null,
      }),
    );
    expect(out.status).toBe('none');
  });

  it('returns none when there is neither a usable DOI nor a title', async () => {
    expect((await locateOa({}, deps())).status).toBe('none');
  });
});
