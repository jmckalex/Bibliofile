import { describe, it, expect } from 'vitest';
import { TypeManager } from './type-manager.js';
import { createBibItem, BibItem, type PublicationStore } from './bib-item.js';

const tm = new TypeManager();

/** Tiny in-memory publication store for crossref resolution. */
class Store implements PublicationStore {
  private items: BibItem[] = [];
  add(item: BibItem): BibItem {
    item.setStore(this);
    this.items.push(item);
    return item;
  }
  all(): BibItem[] {
    return this.items;
  }
  itemForCiteKey(citeKey: string): BibItem | undefined {
    const lower = citeKey.toLowerCase();
    return this.items.find((i) => i.citeKey.toLowerCase() === lower);
  }
}

let n = 0;
function mk(store: Store, init: Record<string, unknown>): BibItem {
  return store.add(createBibItem({ idGenerator: () => `x${n++}`, ...init }, tm));
}

describe('crossref inheritance', () => {
  it('child inherits an empty field from its parent', () => {
    const s = new Store();
    const parent = mk(s, {
      citeKey: 'proc',
      type: 'proceedings',
      fields: { Publisher: 'ACM', Year: '2020' },
    });
    const child = mk(s, {
      citeKey: 'paper',
      type: 'inproceedings',
      fields: { Crossref: 'proc', Title: 'My Paper' },
    });
    void parent;
    // child lacks Publisher/Year -> inherited
    expect(child.stringValueOfField('Publisher', true)).toBe('ACM');
    expect(child.stringValueOfField('Year', true)).toBe('2020');
    // without inherit -> empty
    expect(child.stringValueOfField('Publisher', false)).toBe('');
  });

  it('child own value wins over parent', () => {
    const s = new Store();
    mk(s, { citeKey: 'p', type: 'book', fields: { Publisher: 'Parent' } });
    const c = mk(s, {
      citeKey: 'c',
      type: 'inbook',
      fields: { Crossref: 'p', Publisher: 'Child' },
    });
    expect(c.stringValueOfField('Publisher', true)).toBe('Child');
  });

  it('isFieldInherited distinguishes inherited vs own fields', () => {
    const s = new Store();
    mk(s, { citeKey: 'p', type: 'book', fields: { Publisher: 'ACM', Series: 'S' } });
    const c = mk(s, {
      citeKey: 'c',
      type: 'inbook',
      fields: { Crossref: 'p', Series: 'OwnSeries' },
    });
    expect(c.isFieldInherited('Publisher')).toBe(true); // inherited
    expect(c.isFieldInherited('Series')).toBe(false); // own
    expect(c.isFieldInherited('Nonexistent')).toBe(false); // parent lacks it too
  });

  it('citation fields are never inherited', () => {
    const s = new Store();
    mk(s, { citeKey: 'p', type: 'book', fields: { Cites: 'a,b' } });
    const c = mk(s, { citeKey: 'c', type: 'inbook', fields: { Crossref: 'p' } });
    expect(c.stringValueOfField('Cites', true)).toBe('');
    expect(c.isFieldInherited('Cites')).toBe(false);
  });

  it('crossref lookup is case-insensitive', () => {
    const s = new Store();
    mk(s, { citeKey: 'Proc', type: 'proceedings', fields: { Year: '1999' } });
    const c = mk(s, { citeKey: 'c', type: 'inproceedings', fields: { Crossref: 'PROC' } });
    expect(c.stringValueOfField('Year', true)).toBe('1999');
  });
});

describe('crossref booktitle workaround', () => {
  const CHILD_TYPES = ['inbook', 'incollection', 'inproceedings', 'conference'];

  it("a crossref-ed child inherits the parent's Booktitle, not its own Title", () => {
    const s = new Store();
    mk(s, {
      citeKey: 'proc',
      type: 'proceedings',
      fields: { Title: 'Proceedings of FOO 2020', Booktitle: 'FOO 2020' },
    });
    const child = mk(s, {
      citeKey: 'paper',
      type: 'inproceedings',
      fields: { Crossref: 'proc', Title: 'My Paper' },
    });
    expect(child.rawValueOfField('Booktitle')).toBeUndefined();
    expect(child.isFieldInherited('Booktitle')).toBe(true);
    expect(child.stringValueOfField('Booktitle', true)).toBe('FOO 2020');
  });

  it('constructing an entry never invents a Booktitle', () => {
    const s = new Store();
    for (const type of CHILD_TYPES) {
      const it = mk(s, { type, fields: { Title: 'T' } });
      expect(it.rawValueOfField('Booktitle'), type).toBeUndefined();
    }
  });

  it('editing Title never writes Booktitle', () => {
    const s = new Store();
    for (const type of [...CHILD_TYPES, 'book', 'proceedings', 'article']) {
      const it = mk(s, { type, fields: {} });
      it.setField('Title', 'T');
      expect(it.rawValueOfField('Booktitle'), type).toBeUndefined();
    }
  });

  it('explicit duplicateTitleToBooktitle fills an empty Booktitle on a parent', () => {
    const s = new Store();
    const parent = mk(s, { type: 'proceedings', fields: { Title: 'Proc' } });
    expect(parent.duplicateTitleToBooktitle()).toBe(true);
    expect(parent.stringValueOfField('Booktitle', false)).toBe('Proc');
    expect(parent.duplicateTitleToBooktitle()).toBe(false); // already equal
  });

  it('explicit duplicateTitleToBooktitle(overwrite) overwrites', () => {
    const s = new Store();
    const it = mk(s, { type: 'article', fields: { Title: 'T', Booktitle: 'B' } });
    expect(it.duplicateTitleToBooktitle(false)).toBe(false);
    expect(it.duplicateTitleToBooktitle(true)).toBe(true);
    expect(it.stringValueOfField('Booktitle', false)).toBe('T');
  });
});

describe('crossref chain/cycle prevention', () => {
  it('rejects self-reference', () => {
    const s = new Store();
    const a = mk(s, { citeKey: 'a', type: 'inbook' });
    expect(a.canSetCrossref('a')).toBe('self');
    expect(a.canSetCrossref('A')).toBe('self'); // case-insensitive
  });

  it('rejects a chain (parent already has a crossref)', () => {
    const s = new Store();
    mk(s, { citeKey: 'grand', type: 'book' });
    mk(s, { citeKey: 'parent', type: 'inbook', fields: { Crossref: 'grand' } });
    const child = mk(s, { citeKey: 'child', type: 'inbook' });
    expect(child.canSetCrossref('parent')).toBe('chain');
  });

  it('allows a valid single-level crossref', () => {
    const s = new Store();
    mk(s, { citeKey: 'parent', type: 'book' });
    const child = mk(s, { citeKey: 'child', type: 'inbook' });
    expect(child.canSetCrossref('parent')).toBe('none');
  });

  it('rejects setting a crossref on an item that is itself crossreffed', () => {
    const s = new Store();
    const parent = mk(s, { citeKey: 'parent', type: 'book' });
    mk(s, { citeKey: 'child', type: 'inbook', fields: { Crossref: 'parent' } });
    const other = mk(s, { citeKey: 'other', type: 'proceedings' });
    void other;
    // 'parent' is referenced by 'child', so parent cannot become a child
    expect(parent.canSetCrossref('other', s.all())).toBe('isCrossreffed');
  });

  it('empty candidate is allowed (clearing crossref)', () => {
    const s = new Store();
    const a = mk(s, { citeKey: 'a', type: 'inbook' });
    expect(a.canSetCrossref('')).toBe('none');
  });

  it('self-referential crossref does not loop in inheritance reads', () => {
    const s = new Store();
    const a = mk(s, { citeKey: 'a', type: 'inbook', fields: { Crossref: 'a' } });
    // crossrefParent guards against self -> undefined, so no infinite loop
    expect(a.crossrefParent()).toBeUndefined();
    expect(a.stringValueOfField('Publisher', true)).toBe('');
  });
});
