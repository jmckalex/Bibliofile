/**
 * Tests for {@link PluginApi} / {@link createPluginApi}.
 *
 * Strategy: build a real {@link BibLibrary} via `parse(...)` from `@bibdesk/bibtex`,
 * then exercise the whole surface — query, every mutation (asserted via the model
 * AND via `serialize`/round-trip), cite-key uniqueness on add/duplicate/import,
 * import-merge with key collisions, duplicate detection, macros, and event firing.
 */

import { describe, it, expect, vi } from 'vitest';
import { parse, serialize } from '@bibdesk/bibtex';
import { createPluginApi, PluginApi } from './plugin-api.js';
import type { LibraryChangeEvent } from './types.js';

/**
 * A small library in the serializer's CANONICAL form (lowercase field names +
 * the BibDesk header), so `serialize(parse(SAMPLE)) === SAMPLE` holds. Accents
 * use the `{\'e}` form (the parser round-trips it cleanly).
 */
const SAMPLE = `%% This BibTeX bibliography file was created using BibDesk.
%% https://bibdesk.sourceforge.io/


@article{turing1950,
\tauthor = {Alan Turing},
\tjournal = {Mind},
\ttitle = {Computing Machinery and Intelligence},
\tyear = {1950}}

@book{godel1931,
\tauthor = {Kurt G{\\'e}del},
\tpublisher = {Monatshefte},
\ttitle = {Formal Undecidability},
\tyear = {1931}}

@misc{note1,
\ttitle = {A note},
\turl = {https://example.com/x}}
`;

function api(text = SAMPLE): PluginApi {
  return createPluginApi(parse(text));
}

describe('PluginApi — query', () => {
  it('counts and lists entries in file order', () => {
    const a = api();
    expect(a.count()).toBe(3);
    expect(a.entries().map((e) => e.citeKey)).toEqual([
      'turing1950',
      'godel1931',
      'note1',
    ]);
  });

  it('getByCiteKey is case-insensitive and returns the first match', () => {
    const a = api();
    expect(a.getByCiteKey('TURING1950')?.citeKey).toBe('turing1950');
    expect(a.getByCiteKey('missing')).toBeUndefined();
  });

  it('getById round-trips an entry by its stable id', () => {
    const a = api();
    const id = a.entries()[0]!.id;
    expect(a.getById(id)?.citeKey).toBe('turing1950');
    expect(a.getById('nope')).toBeUndefined();
  });

  it('find / filter run a predicate over entries', () => {
    const a = api();
    expect(a.find((e) => e.type === 'book')?.citeKey).toBe('godel1931');
    expect(a.filter((e) => e.field('Year') !== '').map((e) => e.citeKey)).toEqual([
      'turing1950',
      'godel1931',
    ]);
  });

  it('search is case-insensitive, de-TeXifies, and spans common fields', () => {
    const a = api();
    expect(a.search('intelligence').map((e) => e.citeKey)).toEqual(['turing1950']);
    // de-TeXified: "G{\'e}del" must match a plain accented "gédel" query
    expect(a.search('gédel').map((e) => e.citeKey)).toEqual(['godel1931']);
    // cite-key + type also searched
    expect(a.search('note1').map((e) => e.citeKey)).toEqual(['note1']);
    expect(a.search('article').map((e) => e.citeKey)).toEqual(['turing1950']);
    // empty query returns everything
    expect(a.search('   ').length).toBe(3);
  });
});

describe('Entry — read accessors', () => {
  it('exposes citeKey, type, raw + display fields', () => {
    const e = api().getByCiteKey('godel1931')!;
    expect(e.type).toBe('book');
    // raw value keeps the TeX; display de-TeXifies
    expect(e.field('Author')).toContain("G{\\'e}del");
    expect(e.displayField('Author')).toBe('Kurt Gédel');
    expect(e.field('Missing')).toBe('');
  });

  it('parses authors (de-TeXified) into structured objects', () => {
    const e = api().getByCiteKey('godel1931')!;
    const authors = e.authors();
    expect(authors).toHaveLength(1);
    expect(authors[0]!.first).toBe('Kurt');
    // `last` is the raw BibTeX part; only `displayName` is de-TeXified
    expect(authors[0]!.last).toBe("G{\\'e}del");
    expect(authors[0]!.displayName).toBe('Kurt Gédel');
  });

  it('detects cite-key’d file/URL attachments', () => {
    const e = api().getByCiteKey('note1')!;
    const att = e.attachments();
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({
      field: 'Url',
      kind: 'remoteURL',
      value: 'https://example.com/x',
    });
    // an entry with no file/url fields has no attachments
    expect(api().getByCiteKey('turing1950')!.attachments()).toEqual([]);
  });

  it('serializes a single entry to BibTeX', () => {
    const e = api().getByCiteKey('turing1950')!;
    const tex = e.toBibTeX();
    expect(tex).toContain('@article{turing1950');
    expect(tex).toContain('title = {Computing Machinery and Intelligence}');
  });
});

describe('PluginApi — mutation', () => {
  it('setField sets a field and is reflected in serialize()', () => {
    const a = api();
    const id = a.getByCiteKey('turing1950')!.id;
    a.setField(id, 'Note', 'A classic paper');
    expect(a.getById(id)!.field('Note')).toBe('A classic paper');
    expect(a.toBibTeX()).toContain('note = {A classic paper}');
  });

  it('removeField deletes a field', () => {
    const a = api();
    const id = a.getByCiteKey('godel1931')!.id;
    expect(a.getById(id)!.field('Publisher')).not.toBe('');
    a.removeField(id, 'Publisher');
    expect(a.getById(id)!.field('Publisher')).toBe('');
    expect(a.toBibTeX()).not.toContain('publisher = {Monatshefte}');
  });

  it('setType lowercases and updates the entry', () => {
    const a = api();
    const id = a.getByCiteKey('note1')!.id;
    a.setType(id, 'Booklet');
    expect(a.getById(id)!.type).toBe('booklet');
    expect(a.toBibTeX()).toContain('@booklet{note1');
  });

  it('setCiteKey renames and keeps uniqueness (collision -> key-1)', () => {
    const a = api();
    const note = a.getByCiteKey('note1')!;
    // rename to a free key
    a.setCiteKey(note.id, 'fresh');
    expect(a.getById(note.id)!.citeKey).toBe('fresh');
    // rename to a colliding key disambiguates
    const result = a.setCiteKey(note.id, 'turing1950');
    expect(result.citeKey).toBe('turing1950-1');
  });

  it('setCiteKey to an entry’s own key is a no-op (not key-1)', () => {
    const a = api();
    const t = a.getByCiteKey('turing1950')!;
    a.setCiteKey(t.id, 'turing1950');
    expect(a.getById(t.id)!.citeKey).toBe('turing1950');
  });

  it('requireItem throws for unknown ids', () => {
    const a = api();
    expect(() => a.setField('bad-id', 'Title', 'x')).toThrow(/No entry/);
  });
});

describe('PluginApi — addEntry / duplicate / delete', () => {
  it('addEntry appends, auto-generates a unique cite key, and serializes', () => {
    const a = api();
    const e = a.addEntry({
      type: 'article',
      fields: { Author: 'Ada Lovelace', Title: 'Notes', Year: '1843' },
    });
    expect(a.count()).toBe(4);
    expect(e.citeKey).not.toBe('');
    // generated key must be unique within the library
    const keys = a.entries().map((x) => x.citeKey.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(a.toBibTeX()).toContain('author = {Ada Lovelace}');
  });

  it('addEntry honors a supplied cite key and disambiguates collisions', () => {
    const a = api();
    const e1 = a.addEntry({ type: 'misc', citeKey: 'myKey', fields: { Title: 'X' } });
    expect(e1.citeKey).toBe('myKey');
    const e2 = a.addEntry({ type: 'misc', citeKey: 'myKey', fields: { Title: 'Y' } });
    expect(e2.citeKey).toBe('myKey-1');
  });

  it('duplicateEntry copies fields with a fresh id and unique -copy key', () => {
    const a = api();
    const src = a.getByCiteKey('turing1950')!;
    const dup = a.duplicateEntry(src.id);
    expect(dup.id).not.toBe(src.id);
    expect(dup.citeKey).toBe('turing1950-copy');
    expect(dup.field('Title')).toBe(src.field('Title'));
    // duplicating again disambiguates the -copy key
    const dup2 = a.duplicateEntry(src.id);
    expect(dup2.citeKey).toBe('turing1950-copy-1');
    expect(a.count()).toBe(5);
  });

  it('deleteEntry removes the entry and drops it from serialize()', () => {
    const a = api();
    const id = a.getByCiteKey('note1')!.id;
    expect(a.deleteEntry(id)).toBe(true);
    expect(a.getById(id)).toBeUndefined();
    expect(a.count()).toBe(2);
    expect(a.toBibTeX()).not.toContain('@misc{note1');
    // deleting again is a no-op
    expect(a.deleteEntry(id)).toBe(false);
  });

  it('generateCiteKey assigns a key from the format and stays unique', () => {
    const a = api();
    const e = a.addEntry({
      type: 'article',
      citeKey: 'placeholder',
      fields: { Author: 'Alan Turing', Year: '1950' },
    });
    const key = a.generateCiteKey(e.id);
    expect(key).not.toBe('');
    // must not collide with the existing turing1950 entry
    const keys = a.entries().map((x) => x.citeKey.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(a.getById(e.id)!.citeKey).toBe(key);
  });
});

describe('PluginApi — macros', () => {
  const WITH_MACRO = `@string{pub = {Big Publisher}}

@book{b1,
\tPublisher = pub,
\tTitle = {Title},
\tYear = {2000}}
`;

  it('lists, sets, and removes file-tier macros (excludes built-in months)', () => {
    const a = api(WITH_MACRO);
    expect(a.macros()).toMatchObject({ pub: 'Big Publisher' });
    expect(a.macros()).not.toHaveProperty('jan'); // built-in, lower tier
    a.setMacro('venue', 'Some Venue');
    expect(a.macros()).toMatchObject({ venue: 'Some Venue' });
    a.removeMacro('pub');
    expect(a.macros()).not.toHaveProperty('pub');
  });

  it('a macro reference in a field expands when read', () => {
    const a = api(WITH_MACRO);
    expect(a.getByCiteKey('b1')!.field('Publisher')).toBe('Big Publisher');
  });
});

describe('PluginApi — import / merge', () => {
  it('imports new entries, keeping free keys', () => {
    const a = api();
    const added = a.import(`@article{newkey,
\tAuthor = {New Author},
\tTitle = {New Title},
\tYear = {2020}}
`);
    expect(added).toHaveLength(1);
    expect(added[0]!.citeKey).toBe('newkey');
    expect(a.count()).toBe(4);
    expect(a.getByCiteKey('newkey')).toBeDefined();
  });

  it('disambiguates a colliding cite key on import (a -> a-1)', () => {
    const a = api();
    const added = a.import(`@article{turing1950,
\tAuthor = {Someone Else},
\tTitle = {Different Paper},
\tYear = {1999}}
`);
    expect(added[0]!.citeKey).toBe('turing1950-1');
    // the original is untouched, both now exist
    expect(a.getByCiteKey('turing1950')!.field('Title')).toBe(
      'Computing Machinery and Intelligence',
    );
    expect(a.count()).toBe(4);
  });

  it('generates a cite key for an imported keyless entry', () => {
    const a = api();
    const added = a.import(`@misc{,
\tTitle = {Keyless}}
`);
    expect(added).toHaveLength(1);
    expect(added[0]!.citeKey.trim()).not.toBe('');
  });

  it('imported entries resolve crossref against the host library', () => {
    const a = api();
    a.import(`@incollection{child,
\tCrossref = {godel1931},
\tTitle = {A Chapter}}
`);
    // Year should inherit from the existing godel1931 parent.
    expect(a.getByCiteKey('child')!.field('Year', true)).toBe('1931');
  });
});

describe('PluginApi — duplicate detection', () => {
  it('groups equivalent entries and ignores singletons', () => {
    const a = api();
    // duplicate turing1950 (different cite key, same content) -> equivalent
    a.import(`@article{turingCopy,
\tAuthor = {Alan Turing},
\tJournal = {Mind},
\tTitle = {Computing Machinery and Intelligence},
\tYear = {1950}}
`);
    const groups = a.duplicates();
    expect(groups).toHaveLength(1);
    const keys = groups[0]!.map((e) => e.citeKey).sort();
    expect(keys).toEqual(['turing1950', 'turingCopy']);
  });

  it('returns [] when there are no duplicates', () => {
    expect(api().duplicates()).toEqual([]);
  });
});

describe('PluginApi — round-trip', () => {
  it('serialize(parse(text)) is byte-faithful with no mutations', () => {
    const a = api();
    expect(a.toBibTeX()).toBe(SAMPLE);
  });

  it('a no-op API leaves the canonical document unchanged', () => {
    const a = api();
    // touch query methods only
    a.entries();
    a.search('mind');
    expect(serialize(a.bibLibrary)).toBe(SAMPLE);
  });
});

describe('PluginApi — events', () => {
  it('fires onChange after each mutation with the right kind', () => {
    const a = api();
    const events: LibraryChangeEvent[] = [];
    const off = a.onChange((e) => events.push(e));

    const id = a.getByCiteKey('turing1950')!.id;
    a.setField(id, 'Note', 'x');
    a.removeField(id, 'Note');
    a.setType(id, 'inproceedings');
    a.setCiteKey(id, 'renamed');
    const added = a.addEntry({ type: 'misc', fields: { Title: 'T' } });
    a.duplicateEntry(added.id);
    a.deleteEntry(added.id);
    a.setMacro('m', 'v');
    a.removeMacro('m');
    a.import('@misc{imp, Title = {I}}\n');

    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual([
      'field',
      'field',
      'type',
      'citeKey',
      'addEntry',
      'addEntry',
      'deleteEntry',
      'macro',
      'macro',
      'import',
    ]);
    // entry-scoped events carry the entry id
    expect(events[0]).toMatchObject({ kind: 'field', entryId: id, field: 'Note' });
    // import carries the added ids
    expect(events.at(-1)!.addedIds).toHaveLength(1);

    off();
    a.setField(id, 'Note', 'y');
    expect(events).toHaveLength(10); // no further events after unsubscribe
  });

  it('onChange unsubscribe is idempotent and isolated per-listener', () => {
    const a = api();
    const l1 = vi.fn();
    const l2 = vi.fn();
    const off1 = a.onChange(l1);
    a.onChange(l2);
    off1();
    off1(); // second call is a harmless no-op
    a.addEntry({ type: 'misc', fields: { Title: 'Z' } });
    expect(l1).not.toHaveBeenCalled();
    expect(l2).toHaveBeenCalledTimes(1);
  });
});
