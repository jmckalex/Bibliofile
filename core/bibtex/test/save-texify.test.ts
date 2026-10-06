/**
 * What a save may change: BibDesk's TeXify-on-save (`BibItem.m:1806-1808`) and
 * nothing more.
 *
 * - URL fields are written verbatim, including BibDesk's linked `Bdsk-Url-N`,
 *   which no field set names. TeXifying one turned `POSC_a_00166` into the
 *   different, broken URL `POSC\_a\_00166`.
 * - Only CharacterConversion-table characters are converted. BibDesk never
 *   escapes `& % # _`, so a save must not either (`Taylor & Francis`, `%%`).
 * - A letter + combining mark is converted whole or not at all; converting the
 *   base alone wrote `na{\i}̈ve` for PDF-extracted "naïve".
 */

import { describe, it, expect } from 'vitest';

import { parse, serialize } from '../src/index';

const save = (bib: string): string => serialize(parse(bib));
/** One field's `name = {value}` line, without the `,` or entry-closing `}` after it. */
const fieldLine = (out: string, field: string): string | undefined =>
  out
    .split('\n')
    .find((l) => l.trimStart().startsWith(`${field} = `))
    ?.trim()
    .replace(/[,}]$/, '');

describe('save writes URL fields verbatim', () => {
  const bib = `@misc{k,
\ttitle = {T},
\tbdsk-url-1 = {https://en.wikipedia.org/w/index.php?title=Two_Minutes_Hate&oldid=1}}

@misc{k2,
\ttitle = {T},
\tbdsk-url-1 = {https://doi.org/10.1007%2Fs10670-018-0064-y},
\tbdsk-url-2 = {https://de.wikipedia.org/wiki/Gödel},
\turl = {https://example.org/a_b?x=1&y=2}}
`;
  const out = save(bib);

  it('keeps `_`, `&` and `%` in a Bdsk-Url-N unescaped', () => {
    expect(out).toContain('{https://en.wikipedia.org/w/index.php?title=Two_Minutes_Hate&oldid=1}');
    expect(out).toContain('{https://doi.org/10.1007%2Fs10670-018-0064-y}');
  });
  it('does not TeXify an accented letter in a Bdsk-Url-N', () => {
    expect(out).toContain('{https://de.wikipedia.org/wiki/Gödel}');
  });
  it('still writes a Url field verbatim', () => {
    expect(fieldLine(out, 'url')).toBe('url = {https://example.org/a_b?x=1&y=2}');
  });
});

describe('save converts only what BibDesk converts', () => {
  const bib = `@book{k,
\tpublisher = {Taylor & Francis},
\tnote = {50% of #1 a_b; Farrar {\\&} Rinehart},
\tslaccitation = {%%CITATION = JINST,3,S08003;%%},
\ttitle = {Automating Gödel's Proof},
\tauthor = {Benzmüller, Christoph}}
`;
  const out = save(bib);

  it('leaves `& % # _` alone in an ordinary field', () => {
    expect(fieldLine(out, 'publisher')).toBe('publisher = {Taylor & Francis}');
    expect(fieldLine(out, 'note')).toBe('note = {50% of #1 a_b; Farrar {\\&} Rinehart}');
    expect(fieldLine(out, 'slaccitation')).toBe('slaccitation = {%%CITATION = JINST,3,S08003;%%}');
  });
  it('still TeXifies accented letters, as BibDesk does on save', () => {
    expect(fieldLine(out, 'title')).toBe('title = {Automating G{\\"o}del\'s Proof}');
    expect(fieldLine(out, 'author')).toBe('author = {Benzm{\\"u}ller, Christoph}');
  });
  it('is a fixed point: a second save changes nothing', () => {
    expect(save(out)).toBe(out);
  });
});

describe('save converts a letter + combining mark whole', () => {
  it('writes PDF-extracted dotless ı + diaeresis as `{\\"\\i}`', () => {
    const out = save('@article{k,\n\ttitle = {the na\u0131\u0308ve theory}}\n');
    expect(fieldLine(out, 'title')).toBe('title = {the na{\\"\\i}ve theory}');
  });
});
