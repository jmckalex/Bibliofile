import { describe, it, expect } from 'vitest';
import {
  groupFromSerialized,
  toSerialized,
  filterFromSerialized,
  escapeGroupPlistEntities,
  unescapeGroupPlistEntities,
  StaticGroup,
  SmartGroup,
  URLGroup,
  ScriptGroup,
  LibraryGroup,
  StringComparison,
  Conjunction,
  type RawGroupRecord,
  type StaticGroupPlist,
  type SmartGroupPlist,
  type URLGroupPlist,
  type ScriptGroupPlist,
} from './index.js';

describe('group plist entity escaping', () => {
  it('round-trips %{}<>@', () => {
    const raw = 'a{b}c<d>e@f%g';
    expect(unescapeGroupPlistEntities(escapeGroupPlistEntities(raw))).toBe(raw);
  });
  it('escapes to the exact BibDesk codes', () => {
    expect(escapeGroupPlistEntities('{}<>@%')).toBe('%7B%7D%3C%3E%40%25');
  });
  it('is a no-op when no special chars', () => {
    expect(escapeGroupPlistEntities('plain text')).toBe('plain text');
    expect(unescapeGroupPlistEntities('plain text')).toBe('plain text');
  });
});

describe('static group serialized round-trip', () => {
  const raw: RawGroupRecord = {
    kind: 'static',
    data: { 'group name': 'My Picks', keys: 'Dawkins1976,Darwin1859,Gould1981' },
  };

  it('groupFromSerialized builds a StaticGroup', () => {
    const g = groupFromSerialized(raw) as StaticGroup;
    expect(g.kind).toBe('static');
    expect(g.name).toBe('My Picks');
    expect(g.keys).toEqual(['Dawkins1976', 'Darwin1859', 'Gould1981']);
  });

  it('round-trips through toSerialized', () => {
    const back = toSerialized(groupFromSerialized(raw)) as { kind: 'static'; data: StaticGroupPlist };
    expect(back).toEqual(raw);
  });

  it('handles empty keys', () => {
    const g = groupFromSerialized({ kind: 'static', data: { 'group name': 'Empty', keys: '' } }) as StaticGroup;
    expect(g.keys).toEqual([]);
    expect(toSerialized(g)).toEqual({ kind: 'static', data: { 'group name': 'Empty', keys: '' } });
  });
});

describe('smart group serialized round-trip', () => {
  const raw: RawGroupRecord = {
    kind: 'smart',
    data: {
      'group name': 'Recent Dawkins',
      conjunction: 0,
      conditions: [
        { comparison: StringComparison.Contain, key: 'Author', value: 'Dawkins', version: 1 },
        { comparison: StringComparison.Larger, key: 'Year', value: '2000', version: 1 },
      ],
    },
  };

  it('groupFromSerialized builds a SmartGroup whose filter evaluates', () => {
    const g = groupFromSerialized(raw) as SmartGroup;
    expect(g.kind).toBe('smart');
    expect(g.name).toBe('Recent Dawkins');
    expect(g.filter.conjunction).toBe(Conjunction.And);
    expect(g.filter.conditions).toHaveLength(2);
    expect(g.filter.conditions[0]!.key).toBe('Author');
    expect(g.filter.conditions[0]!.comparison).toBe(StringComparison.Contain);
  });

  it('round-trips through toSerialized', () => {
    const back = toSerialized(groupFromSerialized(raw)) as { kind: 'smart'; data: SmartGroupPlist };
    expect(back).toEqual(raw);
  });

  it('OR conjunction = 1 round-trips', () => {
    const orRaw: RawGroupRecord = {
      kind: 'smart',
      data: {
        'group name': 'Either',
        conjunction: 1,
        conditions: [{ comparison: StringComparison.Equal, key: 'Title', value: 'X', version: 1 }],
      },
    };
    const g = groupFromSerialized(orRaw) as SmartGroup;
    expect(g.filter.conjunction).toBe(Conjunction.Or);
    expect(toSerialized(g)).toEqual(orRaw);
  });

  it('empty conditions get a default condition (matches BibDesk)', () => {
    const f = filterFromSerialized({ 'group name': 'x', conjunction: 0, conditions: [] });
    expect(f.conditions).toHaveLength(1);
    expect(f.conditions[0]!.key).toBe('');
  });

  it('unescapes condition values on read, escapes on write', () => {
    const escapedRaw: RawGroupRecord = {
      kind: 'smart',
      data: {
        'group name': 'Braces',
        conjunction: 0,
        conditions: [{ comparison: StringComparison.Contain, key: 'Note', value: 'a%7Bb%7D', version: 1 }],
      },
    };
    const g = groupFromSerialized(escapedRaw) as SmartGroup;
    expect(g.filter.conditions[0]!.value).toBe('a{b}'); // unescaped in memory
    expect(toSerialized(g)).toEqual(escapedRaw); // re-escaped on write
  });
});

describe('url + script group serialized round-trip', () => {
  it('URL group', () => {
    const raw: RawGroupRecord = {
      kind: 'url',
      data: { 'group name': 'Feed', URL: 'https://example.com/refs.bib' },
    };
    const g = groupFromSerialized(raw) as URLGroup;
    expect(g.url).toBe('https://example.com/refs.bib');
    expect(toSerialized(g)).toEqual(raw as { kind: 'url'; data: URLGroupPlist });
  });

  it('Script group', () => {
    const raw: RawGroupRecord = {
      kind: 'script',
      data: {
        'group name': 'Gen',
        'script arguments': '--all',
        'script path': '/usr/bin/gen.sh',
        'script type': 0,
      },
    };
    const g = groupFromSerialized(raw) as ScriptGroup;
    expect(g.scriptPath).toBe('/usr/bin/gen.sh');
    expect(toSerialized(g)).toEqual(raw as { kind: 'script'; data: ScriptGroupPlist });
  });
});

describe('ephemeral groups are not serializable', () => {
  it('toSerialized throws for library/category', () => {
    expect(() => toSerialized(new LibraryGroup())).toThrow(/ephemeral/);
  });
});

describe('group name escaping in serialized form', () => {
  it('a name with braces round-trips', () => {
    const g = new StaticGroup('Set {A}', ['k1']);
    const raw = toSerialized(g) as { kind: 'static'; data: StaticGroupPlist };
    expect(raw.data['group name']).toBe('Set %7BA%7D');
    const back = groupFromSerialized(raw) as StaticGroup;
    expect(back.name).toBe('Set {A}');
  });
});
