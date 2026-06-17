import { describe, expect, it } from 'vitest';

import { parseEndnote, parseEndnoteTagged, parseEndnoteXml } from './endnote';

describe('parseEndnoteTagged (Refer / .enw — Google Scholar "EndNote" export)', () => {
  const enw = `%0 Journal Article
%A Smith, John
%A Doe, Jane
%T On the Theory of Everything
%J Journal of Important Results
%D 2020
%V 12
%N 3
%P 100-115
%R 10.1000/xyz
%K relativity; quantum
%X A short abstract.
%U https://example.org/a

%0 Book
%A Knuth, Donald E.
%T The Art of Computer Programming
%I Addison-Wesley
%C Reading, MA
%D 1968
%@ 0-201-03801-3`;

  it('parses a journal article with multiple authors, mapping tags to BibTeX fields', () => {
    const [a] = parseEndnoteTagged(enw);
    expect(a).toBeDefined();
    expect(a!.entryType).toBe('article');
    expect(a!.fields).toMatchObject({
      Author: 'Smith, John and Doe, Jane',
      Title: 'On the Theory of Everything',
      Journal: 'Journal of Important Results',
      Year: '2020',
      Volume: '12',
      Number: '3',
      Pages: '100--115', // single hyphen between digits normalised to --
      Doi: '10.1000/xyz',
      Keywords: 'relativity, quantum',
      Abstract: 'A short abstract.',
      Url: 'https://example.org/a',
    });
  });

  it('parses a second (book) record after a blank line, routing %@ to Isbn and %C to Address', () => {
    const recs = parseEndnoteTagged(enw);
    expect(recs).toHaveLength(2);
    const b = recs[1]!;
    expect(b.entryType).toBe('book');
    expect(b.fields).toMatchObject({
      Author: 'Knuth, Donald E.',
      Title: 'The Art of Computer Programming',
      Publisher: 'Addison-Wesley',
      Address: 'Reading, MA',
      Year: '1968',
      Isbn: '0-201-03801-3',
    });
    expect(b.fields.Journal).toBeUndefined();
  });

  it('returns no records for text with no tags', () => {
    expect(parseEndnoteTagged('just some prose\nwith no tags')).toEqual([]);
  });
});

describe('parseEndnoteXml', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xml>
  <records>
    <record>
      <ref-type name="Journal Article">17</ref-type>
      <contributors>
        <authors>
          <author><style face="normal">Curie, Marie</style></author>
          <author>Curie, Pierre</author>
        </authors>
      </contributors>
      <titles>
        <title><style face="normal">On Radioactivity</style></title>
        <secondary-title>Annales de Physique</secondary-title>
      </titles>
      <dates><year>1903</year></dates>
      <volume>7</volume>
      <pages>289-330</pages>
      <keywords><keyword>radioactivity</keyword><keyword>polonium</keyword></keywords>
      <electronic-resource-num>10.0000/radium</electronic-resource-num>
      <urls><related-urls><url>https://example.org/radium</url></related-urls></urls>
    </record>
  </records>
</xml>`;

  it('parses a record, unwrapping <style> text runs and joining authors/keywords', () => {
    const [r] = parseEndnoteXml(xml);
    expect(r).toBeDefined();
    expect(r!.entryType).toBe('article');
    expect(r!.fields).toMatchObject({
      Author: 'Curie, Marie and Curie, Pierre',
      Title: 'On Radioactivity',
      Journal: 'Annales de Physique',
      Year: '1903',
      Volume: '7',
      Pages: '289--330',
      Keywords: 'radioactivity, polonium',
      Doi: '10.0000/radium',
      Url: 'https://example.org/radium',
    });
  });

  it('parseEndnote sniffs XML vs. tagged automatically', () => {
    expect(parseEndnote(xml)).toHaveLength(1);
    expect(parseEndnote('%0 Book\n%T A Title')[0]!.entryType).toBe('book');
  });
});
