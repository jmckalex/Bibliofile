/**
 * Interop with the BibTeX parser/serializer (`@bibdesk/bibtex`, C4).
 *
 * C4 decodes each `@comment{BibDesk X Groups{ <XML plist> }}` block into plain
 * JS data and exposes it as a {@link RawGroupRecord} `{ kind, data }`. This
 * module builds typed {@link Group}s from that decoded-plist shape and back.
 *
 * Payload key formats are authoritative and match desktop BibDesk's
 * `dictionaryValue` / `initWithDictionary:` (BDSKStaticGroup.m, BDSKSmartGroup.m,
 * BDSKFilter.m, BDSKCondition.m, and the URL/Script group classes):
 *
 *   static : { "group name": string, "keys": string }            (keys comma-joined)
 *   smart  : { "group name": string, "conjunction": 0|1,
 *              "conditions": [ { "comparison": int, "key": string,
 *                                "value": string, "version": int }, … ] }
 *   url    : { "group name": string, "URL": string }
 *   script : { "group name": string, "script arguments": …,
 *              "script path": string, "script type": … }
 *
 * Group `name` and condition `value` carry BibDesk's "group plist entity"
 * escaping (`%7B`→`{` etc., NSString_BDSKExtensions.m) so values can live inside
 * the BibTeX `@comment{…}` braces; we unescape on read and escape on write.
 */
import { Conjunction } from './comparison.js';
import { Condition } from './condition.js';
import { Filter } from './filter.js';
import {
  CategoryGroup,
  EmptyCategoryGroup,
  LibraryGroup,
  ScriptGroup,
  SmartGroup,
  StaticGroup,
  URLGroup,
  type Group,
} from './group.js';

/** The raw, decoded-plist group record produced/consumed by `@bibdesk/bibtex`. */
export type RawGroupRecord =
  | { kind: 'static'; data: StaticGroupPlist }
  | { kind: 'smart'; data: SmartGroupPlist }
  | { kind: 'url'; data: URLGroupPlist }
  | { kind: 'script'; data: ScriptGroupPlist };

export interface StaticGroupPlist {
  'group name': string;
  keys: string;
}

export interface SmartConditionPlist {
  comparison: number;
  key: string;
  value: string;
  version: number;
}

export interface SmartGroupPlist {
  'group name': string;
  conjunction: 0 | 1;
  conditions: SmartConditionPlist[];
}

export interface URLGroupPlist {
  'group name': string;
  URL: string;
}

export interface ScriptGroupPlist {
  'group name': string;
  'script arguments'?: string;
  'script path': string;
  'script type'?: number;
}

// --- group plist entity escaping (NSString_BDSKExtensions.m) ----------------

const ESCAPE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['%', '%25'], // must come first
  ['{', '%7B'],
  ['}', '%7D'],
  ['<', '%3C'],
  ['>', '%3E'],
  ['@', '%40'],
];

/** `-[NSString stringByEscapingGroupPlistEntities]`. */
export function escapeGroupPlistEntities(s: string): string {
  if (!/[%{}<>@]/.test(s)) return s;
  let out = s;
  for (const [ch, esc] of ESCAPE_PAIRS) {
    out = out.split(ch).join(esc);
  }
  return out;
}

/** `-[NSString stringByUnescapingGroupPlistEntities]`. */
export function unescapeGroupPlistEntities(s: string): string {
  if (!s.includes('%')) return s;
  let out = s;
  // reverse order: %25 last (matches BibDesk's ordering)
  out = out.split('%7B').join('{');
  out = out.split('%7D').join('}');
  out = out.split('%3C').join('<');
  out = out.split('%3E').join('>');
  out = out.split('%25').join('%');
  out = out.split('%40').join('@');
  return out;
}

// --- construct typed groups from raw records --------------------------------

/** Build a {@link Filter} from a decoded smart-group plist (`BDSKFilter initWithDictionary:`). */
export function filterFromSerialized(data: SmartGroupPlist): Filter {
  const conditions: Condition[] = (data.conditions ?? []).map(
    (c) =>
      new Condition({
        key: c.key,
        comparison: c.comparison,
        value: unescapeGroupPlistEntities(c.value ?? ''),
        version: c.version ?? 1,
      }),
  );
  // BibDesk guarantees at least one condition.
  if (conditions.length === 0) conditions.push(new Condition({ key: '', comparison: 2, value: '' }));
  const conjunction = (data.conjunction ?? 0) === 1 ? Conjunction.Or : Conjunction.And;
  return new Filter(conditions, conjunction);
}

/**
 * Build a typed {@link Group} from a raw decoded-plist record. Static, smart,
 * url, and script kinds are supported (the persisted set).
 */
export function groupFromSerialized(raw: RawGroupRecord): Group {
  switch (raw.kind) {
    case 'static': {
      const name = unescapeGroupPlistEntities(raw.data['group name'] ?? '');
      const keysStr = raw.data.keys ?? '';
      const keys = keysStr === '' ? [] : keysStr.split(',').map((k) => k.trim()).filter((k) => k.length > 0);
      return new StaticGroup(name, keys);
    }
    case 'smart': {
      const name = unescapeGroupPlistEntities(raw.data['group name'] ?? '');
      return new SmartGroup(name, filterFromSerialized(raw.data));
    }
    case 'url': {
      const name = unescapeGroupPlistEntities(raw.data['group name'] ?? '');
      return new URLGroup(name, raw.data.URL ?? '');
    }
    case 'script': {
      const name = unescapeGroupPlistEntities(raw.data['group name'] ?? '');
      return new ScriptGroup(
        name,
        raw.data['script path'] ?? '',
        raw.data['script arguments'] ?? '',
        raw.data['script type'] ?? 0,
      );
    }
  }
}

// --- serialize typed groups back to raw records -----------------------------

/** Serialize a {@link Filter}'s conditions/conjunction into plist fields. */
export function filterToSerialized(
  filter: Filter,
): Pick<SmartGroupPlist, 'conjunction' | 'conditions'> {
  return {
    conjunction: filter.conjunction === Conjunction.Or ? 1 : 0,
    conditions: filter.conditions.map((c) => ({
      comparison: c.comparison,
      key: c.key,
      value: escapeGroupPlistEntities(c.value),
      version: c.version,
    })),
  };
}

/**
 * Inverse of {@link groupFromSerialized}: produce the raw `{ kind, data }`
 * record the serializer hands back. Only the persisted kinds (static/smart/
 * url/script) are serializable; library/category/empty-category are ephemeral
 * (BibDesk does not persist them) and throw.
 */
export function toSerialized(group: Group): RawGroupRecord {
  switch (group.kind) {
    case 'static':
      return {
        kind: 'static',
        data: {
          'group name': escapeGroupPlistEntities(group.name),
          keys: group.keys.join(','),
        },
      };
    case 'smart':
      return {
        kind: 'smart',
        data: {
          'group name': escapeGroupPlistEntities(group.name),
          ...filterToSerialized(group.filter),
        },
      };
    case 'url':
      return {
        kind: 'url',
        data: {
          'group name': escapeGroupPlistEntities(group.name),
          URL: group.url,
        },
      };
    case 'script':
      return {
        kind: 'script',
        data: {
          'group name': escapeGroupPlistEntities(group.name),
          'script arguments': group.scriptArguments,
          'script path': group.scriptPath,
          'script type': group.scriptType,
        },
      };
    case 'library':
    case 'category':
    case 'empty-category':
      throw new Error(
        `Group kind "${group.kind}" is ephemeral and not persisted (matches BibDesk).`,
      );
  }
}

// Re-export concrete classes referenced by callers building groups directly.
export { LibraryGroup, CategoryGroup, EmptyCategoryGroup };
