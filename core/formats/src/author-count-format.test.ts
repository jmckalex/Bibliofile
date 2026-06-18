/**
 * Proves the "author-count-dependent" cite-key scheme the user asked for is
 * expressible as a plain format string (no engine change), exploiting the `%a`
 * specifier's "et al with a trailing digit" feature:
 *
 *   FORMAT = %a[/][/etal1]2:%Y%u0
 *            └──┬──┘└──┬──┘│ │  │
 *          authSep   etal  │ │  └ %u0 = disambiguator letter ONLY on collision
 *               (=/) (=/etal1, the trailing "1" caps the shown authors at 1
 *                     once there are MORE than the requested 2)
 *                          └ request 2 authors
 *
 *   1 author   -> Surname:Year            (+ a/b/… on clash)
 *   2 authors  -> Surname1/Surname2:Year  (+ a/b/… on clash)
 *   3+ authors -> Surname1/etal:Year      (+ a/b/… on clash)
 */
import { describe, it, expect } from 'vitest';
import { TypeManager, createBibItem, type BibItem } from '@bibdesk/model';
import { generateCiteKey } from './generate.js';

const tm = new TypeManager();
const FORMAT = '%a[/][/etal1]2:%Y%u0';

function item(author: string, year = '2020'): BibItem {
  return createBibItem({ type: 'article', fields: { Author: author, Year: year }, typeManager: tm }, tm);
}

describe('author-count cite-key format %a[/][/etal1]2:%Y%u0', () => {
  it('1 author -> Surname:Year', () => {
    expect(generateCiteKey(FORMAT, item('John Smith'), [])).toBe('Smith:2020');
  });

  it('2 authors -> Surname1/Surname2:Year', () => {
    expect(generateCiteKey(FORMAT, item('John Smith and Jane Doe'), [])).toBe('Smith/Doe:2020');
  });

  it('3 authors -> Surname1/etal:Year', () => {
    expect(generateCiteKey(FORMAT, item('John Smith and Jane Doe and Bob Roe'), [])).toBe(
      'Smith/etal:2020',
    );
  });

  it('4+ authors -> still Surname1/etal:Year', () => {
    expect(
      generateCiteKey(FORMAT, item('A Smith and B Doe and C Roe and D Poe'), []),
    ).toBe('Smith/etal:2020');
  });

  it('disambiguates with a/b/… only on collision, in every arity', () => {
    // 1 author
    expect(generateCiteKey(FORMAT, item('John Smith'), ['Smith:2020'])).toBe('Smith:2020a');
    expect(generateCiteKey(FORMAT, item('John Smith'), ['Smith:2020', 'Smith:2020a'])).toBe(
      'Smith:2020b',
    );
    // 2 authors
    expect(
      generateCiteKey(FORMAT, item('John Smith and Jane Doe'), ['Smith/Doe:2020']),
    ).toBe('Smith/Doe:2020a');
    // 3+ authors
    expect(
      generateCiteKey(FORMAT, item('John Smith and Jane Doe and Bob Roe'), ['Smith/etal:2020']),
    ).toBe('Smith/etal:2020a');
  });
});
