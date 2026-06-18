/**
 * Proves the "author-count-dependent" cite-key scheme the user asked for is
 * expressible as a plain format string (no engine change), exploiting the `%p`
 * specifier's "et al with a trailing digit" feature:
 *
 *   FORMAT = %p[/][/etal1]2:%Y%u0
 *            └──┬──┘└──┬──┘│ │  │
 *          authSep   etal  │ │  └ %u0 = disambiguator letter ONLY on collision
 *               (=/) (=/etal1, the trailing "1" caps the shown names at 1
 *                     once there are MORE than the requested 2)
 *                          └ request 2 names
 *
 *   1 person   -> Surname:Year            (+ a/b/… on clash)
 *   2 people   -> Surname1/Surname2:Year  (+ a/b/… on clash)
 *   3+ people  -> Surname1/etal:Year      (+ a/b/… on clash)
 *
 * `%p` (not `%a`) so that an entry with no Author but an Editor — an edited book,
 * say — keys off the editor instead of generating an author-less key. When an
 * Author IS present it wins; the editor is only a fallback.
 */
import { describe, it, expect } from 'vitest';
import { TypeManager, createBibItem, type BibItem } from '@bibdesk/model';
import { generateCiteKey } from './generate.js';

const tm = new TypeManager();
const FORMAT = '%p[/][/etal1]2:%Y%u0';

function make(fields: Record<string, string>): BibItem {
  return createBibItem({ type: 'book', fields: { Year: '2020', ...fields }, typeManager: tm }, tm);
}
const author = (a: string): BibItem => make({ Author: a });

describe('author-count cite-key format %p[/][/etal1]2:%Y%u0', () => {
  it('1 author -> Surname:Year', () => {
    expect(generateCiteKey(FORMAT, author('John Smith'), [])).toBe('Smith:2020');
  });

  it('2 authors -> Surname1/Surname2:Year', () => {
    expect(generateCiteKey(FORMAT, author('John Smith and Jane Doe'), [])).toBe('Smith/Doe:2020');
  });

  it('3 authors -> Surname1/etal:Year', () => {
    expect(generateCiteKey(FORMAT, author('John Smith and Jane Doe and Bob Roe'), [])).toBe(
      'Smith/etal:2020',
    );
  });

  it('4+ authors -> still Surname1/etal:Year', () => {
    expect(generateCiteKey(FORMAT, author('A Smith and B Doe and C Roe and D Poe'), [])).toBe(
      'Smith/etal:2020',
    );
  });

  it('disambiguates with a/b/… only on collision, in every arity', () => {
    expect(generateCiteKey(FORMAT, author('John Smith'), ['Smith:2020'])).toBe('Smith:2020a');
    expect(generateCiteKey(FORMAT, author('John Smith'), ['Smith:2020', 'Smith:2020a'])).toBe(
      'Smith:2020b',
    );
    expect(generateCiteKey(FORMAT, author('John Smith and Jane Doe'), ['Smith/Doe:2020'])).toBe(
      'Smith/Doe:2020a',
    );
    expect(
      generateCiteKey(FORMAT, author('John Smith and Jane Doe and Bob Roe'), ['Smith/etal:2020']),
    ).toBe('Smith/etal:2020a');
  });

  describe('editor fallback (%p): no Author -> key off the Editor(s)', () => {
    it('1 editor -> Surname:Year (not an author-less key)', () => {
      expect(generateCiteKey(FORMAT, make({ Editor: 'Jane Doe' }), [])).toBe('Doe:2020');
    });

    it('2 editors -> Surname1/Surname2:Year', () => {
      expect(generateCiteKey(FORMAT, make({ Editor: 'John Smith and Jane Doe' }), [])).toBe(
        'Smith/Doe:2020',
      );
    });

    it('3+ editors -> Surname1/etal:Year', () => {
      expect(
        generateCiteKey(FORMAT, make({ Editor: 'John Smith and Jane Doe and Bob Roe' }), []),
      ).toBe('Smith/etal:2020');
    });

    it('an Author present wins over the Editor', () => {
      expect(
        generateCiteKey(FORMAT, make({ Author: 'Ann Author', Editor: 'Ed Editor' }), []),
      ).toBe('Author:2020');
    });
  });
});
