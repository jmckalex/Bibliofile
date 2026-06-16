import { describe, it, expect } from 'vitest';
import { parseRis } from './ris-import.js';

const RIS = `TY  - JOUR
AU  - Euler, Leonhard
AU  - Bernoulli, Daniel
TI  - On the sums of series of reciprocals
JO  - Comm. Acad. Sci.
PY  - 1748
VL  - 7
IS  - 2
SP  - 123
EP  - 134
DO  - 10.1000/euler
KW  - analysis
KW  - series
ER  -

TY  - BOOK
AU  - Gauss, C. F.
TI  - Disquisitiones
PY  - 1801
PB  - Fleischer
ER  -
`;

describe('parseRis', () => {
  it('parses records, maps types, and joins multi-valued tags', () => {
    const recs = parseRis(RIS);
    expect(recs).toHaveLength(2);

    const a = recs[0]!;
    expect(a.entryType).toBe('article'); // JOUR
    expect(a.fields['Author']).toBe('Euler, Leonhard and Bernoulli, Daniel');
    expect(a.fields['Title']).toBe('On the sums of series of reciprocals');
    expect(a.fields['Journal']).toBe('Comm. Acad. Sci.');
    expect(a.fields['Year']).toBe('1748');
    expect(a.fields['Volume']).toBe('7');
    expect(a.fields['Number']).toBe('2');
    expect(a.fields['Pages']).toBe('123--134');
    expect(a.fields['Doi']).toBe('10.1000/euler');
    expect(a.fields['Keywords']).toBe('analysis, series');

    const b = recs[1]!;
    expect(b.entryType).toBe('book'); // BOOK
    expect(b.fields['Publisher']).toBe('Fleischer');
  });

  it('tolerates a missing final ER and ignores junk lines', () => {
    const recs = parseRis('junk\nTY  - JOUR\nTI  - Hi\n');
    expect(recs).toHaveLength(1);
    expect(recs[0]!.fields['Title']).toBe('Hi');
  });

  it('returns nothing for non-RIS text', () => {
    expect(parseRis('just prose')).toEqual([]);
  });
});
