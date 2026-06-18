import { describe, it, expect } from 'vitest';
import { TypeManager, createBibItem, type BibItem } from '@bibdesk/model';
import { generateCiteKey, DEFAULT_CITE_KEY_FORMAT } from './generate.js';
import { parseFormat } from './parser.js';
import { CITE_KEY_FIELD } from './sanitize.js';

const tm = new TypeManager();

function makeItem(fields: Record<string, string>): BibItem {
  return createBibItem({ type: 'article', fields, typeManager: tm }, tm);
}

const item = () =>
  makeItem({ Author: 'John Smith', Title: 'Quantum Things', Year: '2020' });

describe('generateCiteKey — uniquifier collision avoidance', () => {
  it('no collision: %u yields the first letter "a"', () => {
    // %a1%Y%u : Smith2020 + lowercase letter
    expect(generateCiteKey('%a1%Y%u', item(), [])).toBe('Smith2020a');
  });

  it('skips taken suffixes to the next available letter', () => {
    const existing = ['Smith2020a', 'Smith2020b'];
    expect(generateCiteKey('%a1%Y%u', item(), existing)).toBe('Smith2020c');
  });

  it('case-insensitive collision by default', () => {
    const existing = ['SMITH2020A'];
    expect(generateCiteKey('%a1%Y%u', item(), existing)).toBe('Smith2020b');
  });

  it('%n0 -> minimal numeric suffix, growing as needed', () => {
    // %n0: variable-length numeric, first try empty (Smith2020), then digits.
    // No collisions => the plain key (no suffix) is valid.
    expect(generateCiteKey('%a1%Y%n0', item(), [])).toBe('Smith2020');
  });

  it('%n0 grows past single digits when many are taken', () => {
    // Take the base and 1..9, forcing a two-digit suffix.
    const taken = ['Smith2020'];
    for (let d = 1; d <= 9; d++) taken.push(`Smith2020${d}`);
    const out = generateCiteKey('%a1%Y%n0', item(), taken);
    // first available is "10" (single-digit 1..9 taken, base taken)
    expect(out).toBe('Smith202010');
  });

  it('the item keeps its own existing key (no false collision)', () => {
    const it = item();
    it.setCiteKey('Smith2020a');
    // existingKeys includes the item's own key; with %u it should still allow "a"
    expect(
      generateCiteKey('%a1%Y%u', it, ['Smith2020a'], {
        currentCiteKey: 'Smith2020a',
      }),
    ).toBe('Smith2020a');
  });

  it('default format %a1:%Y%u2 produces a 2-letter suffix', () => {
    const out = generateCiteKey(DEFAULT_CITE_KEY_FORMAT, item(), []);
    expect(out.startsWith('Smith:2020')).toBe(true);
    expect(out).toMatch(/^Smith:2020[a-z]{2}$/);
  });

  it('app default %a1:%Y%u0 adds a letter only on collision', () => {
    expect(generateCiteKey('%a1:%Y%u0', item(), [])).toBe('Smith:2020'); // unique: no suffix
    expect(generateCiteKey('%a1:%Y%u0', item(), ['Smith:2020'])).toBe('Smith:2020a');
    expect(generateCiteKey('%a1:%Y%u0', item(), ['Smith:2020', 'Smith:2020a'])).toBe(
      'Smith:2020b',
    );
  });

  it('empty format falls back to a numeric uniquifier (never empty)', () => {
    const empty = makeItem({});
    const out = parseFormat('', empty, CITE_KEY_FIELD, {
      citeKeyAvailable: () => true,
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/^\d+$/);
  });
});

describe('generateCiteKey — deterministic CRC32 hash suffix (Papers-compat)', () => {
  it('%n2 with a [field] derives a deterministic suffix from the hashed field', () => {
    // %a1%Y%n[Title]2 : hash the Title to seed the 2-digit numeric suffix.
    const a = generateCiteKey('%a1%Y%n[Title]2', item(), []);
    const b = generateCiteKey('%a1%Y%n[Title]2', item(), []);
    expect(a).toBe(b); // deterministic
    expect(a).toMatch(/^Smith2020\d{2}$/);
  });

  it('different titles generally yield different deterministic suffixes', () => {
    const a = generateCiteKey('%a1%Y%n[Title]2', item(), []);
    const other = makeItem({
      Author: 'John Smith',
      Title: 'Completely Different Subject Matter',
      Year: '2020',
    });
    const b = generateCiteKey('%a1%Y%n[Title]2', other, []);
    expect(a).not.toBe(b);
  });
});
