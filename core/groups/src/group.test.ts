import { describe, it, expect } from 'vitest';
import {
  LibraryGroup,
  StaticGroup,
  SmartGroup,
  CategoryGroup,
  EmptyCategoryGroup,
  URLGroup,
  ScriptGroup,
  Filter,
  Condition,
  Conjunction,
  StringComparison,
  type Author,
} from './index.js';
import { makeItem } from './test-helpers.js';

describe('LibraryGroup', () => {
  it('contains everything', () => {
    const g = new LibraryGroup();
    expect(g.kind).toBe('library');
    expect(g.containsItem(makeItem({}))).toBe(true);
  });
});

describe('StaticGroup', () => {
  const g = new StaticGroup('My Picks', ['Dawkins1976', 'Darwin1859']);
  it('membership by cite key, case-insensitive', () => {
    expect(g.containsItem(makeItem({ citeKey: 'Dawkins1976' }))).toBe(true);
    expect(g.containsItem(makeItem({ citeKey: 'dawkins1976' }))).toBe(true);
    expect(g.containsItem(makeItem({ citeKey: 'DARWIN1859' }))).toBe(true);
    expect(g.containsItem(makeItem({ citeKey: 'Other2000' }))).toBe(false);
  });
  it('exposes kind/name/keys', () => {
    expect(g.kind).toBe('static');
    expect(g.name).toBe('My Picks');
    expect(g.keys).toEqual(['Dawkins1976', 'Darwin1859']);
  });
});

describe('SmartGroup', () => {
  it('delegates to its filter', () => {
    const filter = new Filter(
      [new Condition({ key: 'Year', comparison: StringComparison.Larger, value: '2000' })],
      Conjunction.And,
    );
    const g = new SmartGroup('Recent', filter);
    expect(g.kind).toBe('smart');
    expect(g.containsItem(makeItem({ fields: { Year: '2010' } }))).toBe(true);
    expect(g.containsItem(makeItem({ fields: { Year: '1990' } }))).toBe(false);
  });
});

describe('CategoryGroup', () => {
  it('string field membership', () => {
    const g = new CategoryGroup('Keywords', 'evolution');
    expect(g.kind).toBe('category');
    expect(g.name).toBe('evolution');
    expect(g.containsItem(makeItem({ fields: { Keywords: 'evolution, biology' } }))).toBe(true);
    expect(g.containsItem(makeItem({ fields: { Keywords: 'chemistry' } }))).toBe(false);
  });

  it('person field membership with fuzzy equivalence', () => {
    const target: Author = {
      originalName: 'Dawkins, Richard',
      first: 'Richard',
      fuzzyName: 'dawkins',
      firstNames: ['Richard'],
    };
    const g = new CategoryGroup('Author', target);
    expect(g.name).toBe('Dawkins, Richard');
    expect(g.containsItem(makeItem({ fields: { Author: 'Dawkins, Richard' } }))).toBe(true);
    expect(g.containsItem(makeItem({ fields: { Author: 'Darwin, Charles' } }))).toBe(false);
  });
});

describe('EmptyCategoryGroup', () => {
  it('matches items with no value for the field', () => {
    const g = new EmptyCategoryGroup('Keywords');
    expect(g.kind).toBe('empty-category');
    expect(g.containsItem(makeItem({ fields: { Title: 'X' } }))).toBe(true);
    expect(g.containsItem(makeItem({ fields: { Keywords: 'x' } }))).toBe(false);
  });
});

describe('external group stubs (type-only)', () => {
  it('URLGroup never contains, carries url', () => {
    const g = new URLGroup('Feed', 'https://example.com/refs.bib');
    expect(g.kind).toBe('url');
    expect(g.url).toBe('https://example.com/refs.bib');
    expect(g.containsItem()).toBe(false);
  });
  it('ScriptGroup never contains, carries metadata', () => {
    const g = new ScriptGroup('Gen', '/bin/echo', '--all', 1);
    expect(g.kind).toBe('script');
    expect(g.scriptPath).toBe('/bin/echo');
    expect(g.scriptArguments).toBe('--all');
    expect(g.scriptType).toBe(1);
    expect(g.containsItem()).toBe(false);
  });
});
