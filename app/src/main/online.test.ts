import { describe, it, expect } from 'vitest';
import { parseCrossref, parseArxiv } from './online.js';

describe('parseCrossref', () => {
  it('maps a CrossRef journal-article to normalised + BibTeX fields', () => {
    const json = {
      message: {
        items: [
          {
            type: 'journal-article',
            title: ['The Evolution of Bargaining'],
            author: [{ family: 'Alexander', given: 'J. McKenzie' }],
            'container-title': ['Synthese'],
            issued: { 'date-parts': [[1999]] },
            DOI: '10.1023/A:1005239929271',
            volume: '120',
            issue: '2',
            page: '193-228',
            publisher: 'Springer',
          },
        ],
      },
    };
    const [r] = parseCrossref(json);
    expect(r).toBeDefined();
    expect(r!.entryType).toBe('article');
    expect(r!.title).toBe('The Evolution of Bargaining');
    expect(r!.year).toBe('1999');
    expect(r!.venue).toBe('Synthese');
    expect(r!.doi).toBe('10.1023/A:1005239929271');
    expect(r!.fields.Author).toBe('Alexander, J. McKenzie');
    expect(r!.fields.Journal).toBe('Synthese');
    expect(r!.fields.Pages).toBe('193--228');
    expect(r!.fields.Url).toBe('https://doi.org/10.1023/A:1005239929271');
  });
});

describe('parseArxiv', () => {
  it('maps an arXiv Atom entry to normalised + BibTeX fields', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2001.01234v2</id>
          <title>A Study of  Something</title>
          <summary>The abstract text.</summary>
          <published>2020-01-15T00:00:00Z</published>
          <author><name>Jane Doe</name></author>
          <author><name>John Roe</name></author>
        </entry>
      </feed>`;
    const [r] = parseArxiv(xml);
    expect(r).toBeDefined();
    expect(r!.entryType).toBe('article');
    expect(r!.title).toBe('A Study of Something'); // whitespace collapsed
    expect(r!.year).toBe('2020');
    expect(r!.fields.Author).toBe('Jane Doe and John Roe');
    expect(r!.fields.Eprint).toBe('2001.01234v2');
    expect(r!.fields.Archiveprefix).toBe('arXiv');
    expect(r!.fields.Abstract).toBe('The abstract text.');
    expect(r!.url).toBe('http://arxiv.org/abs/2001.01234v2');
  });

  it('handles a single-entry / single-author feed', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <id>http://arxiv.org/abs/9901.0001</id><title>Solo</title>
      <published>1999-02-02T00:00:00Z</published><author><name>A. Solo</name></author>
      </entry></feed>`;
    const results = parseArxiv(xml);
    expect(results).toHaveLength(1);
    expect(results[0]!.fields.Author).toBe('A. Solo');
    expect(results[0]!.year).toBe('1999');
  });
});
