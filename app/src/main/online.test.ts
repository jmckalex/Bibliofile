import { describe, it, expect } from 'vitest';
import {
  parseCrossref,
  parseArxiv,
  parseOpenAlex,
  parseOpenLibrary,
  parsePubmed,
  extractDoi,
} from './online.js';

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

describe('extractDoi', () => {
  it('finds a DOI in flowing text and trims trailing punctuation', () => {
    expect(extractDoi('See doi:10.1016/j.cognition.2003.10.005, which argues…')).toBe(
      '10.1016/j.cognition.2003.10.005',
    );
    expect(extractDoi('https://doi.org/10.1023/A:1005239929271')).toBe('10.1023/A:1005239929271');
    expect(extractDoi('plain 10.1000/xyz123 here')).toBe('10.1000/xyz123');
  });

  it('returns null when there is no DOI', () => {
    expect(extractDoi('no identifier here')).toBeNull();
  });
});

describe('parseOpenAlex', () => {
  it('maps an OpenAlex work to normalised + BibTeX fields', () => {
    const json = {
      results: [
        {
          title: 'On Bullshit',
          publication_year: 2005,
          type: 'book',
          doi: 'https://doi.org/10.1515/9781400826537',
          authorships: [{ author: { display_name: 'Harry G. Frankfurt' } }],
          primary_location: { source: { display_name: 'Princeton University Press' } },
          biblio: { volume: '1', issue: '2', first_page: '1', last_page: '80' },
        },
      ],
    };
    const [r] = parseOpenAlex(json);
    expect(r!.entryType).toBe('book');
    expect(r!.title).toBe('On Bullshit');
    expect(r!.year).toBe('2005');
    expect(r!.fields.Author).toBe('Harry G. Frankfurt');
    expect(r!.doi).toBe('10.1515/9781400826537'); // doi.org prefix stripped
    expect(r!.fields.Pages).toBe('1--80');
    expect(r!.fields.Booktitle).toBe('Princeton University Press'); // non-article venue
  });
});

describe('parseOpenLibrary', () => {
  it('maps an Open Library book record to a book entry', () => {
    const json = {
      'ISBN:9780691122946': {
        title: 'The Construction of Social Reality',
        authors: [{ name: 'John R. Searle' }],
        publishers: [{ name: 'Free Press' }],
        publish_date: '1995',
        url: 'https://openlibrary.org/books/OL1.M',
      },
    };
    const [r] = parseOpenLibrary(json, '9780691122946');
    expect(r!.entryType).toBe('book');
    expect(r!.title).toBe('The Construction of Social Reality');
    expect(r!.fields.Author).toBe('John R. Searle');
    expect(r!.fields.Publisher).toBe('Free Press');
    expect(r!.year).toBe('1995');
    expect(r!.fields.Isbn).toBe('9780691122946');
  });

  it('returns nothing when the ISBN is not found', () => {
    expect(parseOpenLibrary({}, '0000000000')).toEqual([]);
  });
});

describe('parsePubmed', () => {
  it('maps a PubMed efetch article to normalised + BibTeX fields', () => {
    const xml = `<?xml version="1.0"?>
      <PubmedArticleSet><PubmedArticle><MedlineCitation>
        <PMID>12345678</PMID>
        <Article>
          <ArticleTitle>Consciousness and  the brain.</ArticleTitle>
          <AuthorList>
            <Author><LastName>Dehaene</LastName><ForeName>Stanislas</ForeName></Author>
            <Author><LastName>Naccache</LastName><ForeName>Lionel</ForeName></Author>
          </AuthorList>
          <Journal><Title>Cognition</Title>
            <JournalIssue><Volume>79</Volume><Issue>1</Issue><PubDate><Year>2001</Year></PubDate></JournalIssue>
          </Journal>
          <Pagination><MedlinePgn>1-37</MedlinePgn></Pagination>
          <ELocationID EIdType="doi">10.1016/S0010-0277(00)00123-2</ELocationID>
        </Article>
      </MedlineCitation></PubmedArticle></PubmedArticleSet>`;
    const [r] = parsePubmed(xml);
    expect(r!.entryType).toBe('article');
    expect(r!.title).toBe('Consciousness and the brain.');
    expect(r!.fields.Author).toBe('Dehaene, Stanislas and Naccache, Lionel');
    expect(r!.venue).toBe('Cognition');
    expect(r!.year).toBe('2001');
    expect(r!.fields.Pages).toBe('1--37');
    expect(r!.fields.Pmid).toBe('12345678');
    expect(r!.doi).toBe('10.1016/S0010-0277(00)00123-2');
  });
});
