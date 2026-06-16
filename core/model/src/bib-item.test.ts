import { describe, it, expect } from 'vitest';
import { TypeManager } from './type-manager.js';
import { MacroResolver } from './macro-resolver.js';
import {
  createBibItem,
  generateId,
  type ItemChangeEvent,
} from './bib-item.js';
import { complexValue, macroNode, stringNode } from './complex-value.js';

const tm = new TypeManager();
let counter = 0;
const fixedIds = () => `id-${counter++}`;

function item(init = {}) {
  return createBibItem({ idGenerator: fixedIds, ...init }, tm);
}

describe('BibItem — identity & basics', () => {
  it('generates a stable id', () => {
    const a = createBibItem({ idGenerator: fixedIds }, tm);
    expect(a.id).toMatch(/^id-/);
  });

  it('generateId returns a non-empty string', () => {
    expect(generateId().length).toBeGreaterThan(0);
  });

  it('lowercases the type', () => {
    const a = item({ type: 'ARTICLE' });
    expect(a.type).toBe('article');
    a.setType('Book');
    expect(a.type).toBe('book');
  });

  it('defaults type to misc', () => {
    expect(item().type).toBe('misc');
  });
});

describe('BibItem — field access: case-insensitive + canonical casing', () => {
  it('stores canonical casing and looks up case-insensitively', () => {
    const a = item();
    a.setField('title', 'Hello');
    // canonical casing capitalized
    expect(a.canonicalFieldName('title')).toBe('Title');
    expect(a.fieldNames()).toContain('Title');
    // case-insensitive reads
    expect(a.stringValueOfField('TITLE')).toBe('Hello');
    expect(a.stringValueOfField('Title')).toBe('Hello');
  });

  it('preserves provided canonical casing for known multi-part names', () => {
    const a = item();
    a.setField('Date-Added', '2020-01-01');
    expect(a.canonicalFieldName('date-added')).toBe('Date-Added');
  });

  it('updating an existing field keeps the original casing', () => {
    const a = item();
    a.setField('Journal', 'J1');
    a.setField('journal', 'J2');
    expect(a.canonicalFieldName('JOURNAL')).toBe('Journal');
    expect(a.stringValueOfField('journal')).toBe('J2');
  });

  it('removeField deletes the field', () => {
    const a = item();
    a.setField('Note', 'x');
    a.removeField('NOTE');
    expect(a.rawValueOfField('Note')).toBeUndefined();
    expect(a.fieldNames()).not.toContain('Note');
  });

  it('normalizes a single-literal complex value to a string on set', () => {
    const a = item();
    a.setField('Title', complexValue([stringNode('Plain')]));
    expect(a.rawValueOfField('Title')).toBe('Plain');
  });
});

describe('BibItem — complex values & macro expansion', () => {
  it('expands complex field values via the bound resolver', () => {
    const r = MacroResolver.createStandardStack('en-US');
    const a = createBibItem({ idGenerator: fixedIds, macroResolver: r }, tm);
    a.setField('Month', complexValue([macroNode('jan')]));
    expect(a.stringValueOfField('Month')).toBe('January');
    // raw value remains complex
    expect(typeof a.rawValueOfField('Month')).not.toBe('string');
  });

  it('without a resolver, a complex value expands macros to bare names', () => {
    const a = item();
    a.setField('Month', complexValue([macroNode('jan')]));
    expect(a.stringValueOfField('Month')).toBe('jan');
  });
});

describe('BibItem — typed accessors', () => {
  it('parses person fields into Author[]', () => {
    const a = item();
    a.setField('Author', 'Donald E. Knuth and Leslie Lamport');
    const authors = a.authors();
    expect(authors).toHaveLength(2);
    expect(authors[0]!.last).toBe('Knuth');
    expect(authors[1]!.last).toBe('Lamport');
  });

  it('caches and invalidates parsed people on change', () => {
    const a = item();
    a.setField('Author', 'A. One');
    expect(a.authors()).toHaveLength(1);
    a.setField('Author', 'A. One and B. Two');
    expect(a.authors()).toHaveLength(2); // cache invalidated
  });

  it('reads rating values clamped to 0..5', () => {
    const a = item();
    a.setField('Rating', '3');
    expect(a.ratingValueOfField('Rating')).toBe(3);
    a.setField('Rating', '9');
    expect(a.ratingValueOfField('Rating')).toBe(5);
    a.setField('Rating', 'x');
    expect(a.ratingValueOfField('Rating')).toBe(0);
  });

  it('reads boolean values', () => {
    const a = item();
    a.setField('Read', 'Yes');
    expect(a.boolValueOfField('Read')).toBe(true);
    a.setField('Read', 'No');
    expect(a.boolValueOfField('Read')).toBe(false);
  });

  it('reads tri-state values', () => {
    const a = item();
    a.setField('Verified', '');
    expect(a.triStateValueOfField('Verified')).toBe(0);
    a.setField('Verified', '2');
    expect(a.triStateValueOfField('Verified')).toBe(1);
    a.setField('Verified', '0');
    expect(a.triStateValueOfField('Verified')).toBe(-1);
  });
});

describe('BibItem — change events', () => {
  it('emits field change with old/new/field/itemId', () => {
    const a = item();
    const events: ItemChangeEvent[] = [];
    a.subscribe((e) => events.push(e));
    a.setField('Title', 'First');
    a.setField('Title', 'Second');
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('field');
    expect(events[0]!.field).toBe('Title');
    expect(events[0]!.oldValue).toBeUndefined();
    expect(events[0]!.newValue).toBe('First');
    expect(events[0]!.itemId).toBe(a.id);
    expect(events[1]!.oldValue).toBe('First');
    expect(events[1]!.newValue).toBe('Second');
  });

  it('no-op set (same value) does not emit', () => {
    const a = item();
    a.setField('Title', 'X');
    const events: ItemChangeEvent[] = [];
    a.subscribe((e) => events.push(e));
    a.setField('Title', 'X');
    expect(events).toHaveLength(0);
  });

  it('emits citeKey and type changes', () => {
    const a = item();
    const events: ItemChangeEvent[] = [];
    a.subscribe((e) => events.push(e));
    a.setCiteKey('knuth84');
    a.setType('book');
    expect(events.map((e) => e.type)).toEqual(['citeKey', 'type']);
    expect(events[0]!.newValue).toBe('knuth84');
    expect(events[1]!.newValue).toBe('book');
  });

  it('removeField emits with newValue undefined', () => {
    const a = item();
    a.setField('Note', 'x');
    const events: ItemChangeEvent[] = [];
    a.subscribe((e) => events.push(e));
    a.removeField('Note');
    expect(events[0]!.type).toBe('field');
    expect(events[0]!.oldValue).toBe('x');
    expect(events[0]!.newValue).toBeUndefined();
  });

  it('emits files change', () => {
    const a = item();
    const events: ItemChangeEvent[] = [];
    a.subscribe((e) => events.push(e));
    a.addFile({ kind: 'url', url: 'https://x' });
    expect(events[0]!.type).toBe('files');
    expect(a.files).toHaveLength(1);
  });
});

describe('BibItem — dates mirrored into fields', () => {
  it('mirrors init dates into fields', () => {
    const a = createBibItem(
      {
        idGenerator: fixedIds,
        dateAdded: '2020-01-01T00:00:00Z',
        dateModified: '2021-01-01T00:00:00Z',
      },
      tm,
    );
    expect(a.stringValueOfField('Date-Added')).toBe('2020-01-01T00:00:00Z');
    expect(a.stringValueOfField('Date-Modified')).toBe('2021-01-01T00:00:00Z');
  });

  it('setting Date-Added field updates the property mirror', () => {
    const a = item();
    a.setField('Date-Added', '2022-05-05');
    expect(a.dateAdded).toBe('2022-05-05');
  });
});

describe('BibItem — toJSON snapshot', () => {
  it('produces a structured-clone-friendly object', () => {
    const a = item({ citeKey: 'k', type: 'article' });
    a.setField('Title', 'T');
    const json = a.toJSON();
    expect(json.citeKey).toBe('k');
    expect(json.type).toBe('article');
    expect(json.fields['Title']).toBe('T');
    // round-trips through JSON
    expect(JSON.parse(JSON.stringify(json)).fields.Title).toBe('T');
  });
});
