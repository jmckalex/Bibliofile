/**
 * BibDesk group `@comment` blocks.
 *
 * Groups live INSIDE the `.bib` as four `@comment{BibDesk <Label> Groups{ <XML
 * plist> }}` blocks (subsystem-04 §5). Each payload is an `NSArray` of
 * per-group dictionaries (subsystem-12 §2). To keep `core/bibtex` independent of
 * `@bibdesk/groups`, we decode the plist into a plain {@link GroupRecord} that
 * carries the group `kind` plus the raw decoded plist `data` (an array of
 * dictionaries) — faithful enough for byte-exact re-serialization AND for the
 * app / `@bibdesk/groups` (C6) to build typed groups later.
 *
 * Payload dictionary shapes (keys emitted ALPHABETICALLY by Apple's serializer):
 *   - static : `{ "group name", "keys" }`            (keys = cite keys, comma-joined)
 *   - smart  : `{ conditions:[{comparison,key,value,version}], conjunction, "group name" }`
 *   - url    : `{ URL, "group name" }`
 *   - script : `{ "group name", "script arguments", "script path", "script type" }`
 *
 * BibDesk percent-escapes `% { } < > @` in group strings (so they survive
 * btparse) via `stringByEscapingGroupPlistEntities` and reverses it on read. We
 * mirror that: unescape on parse, re-escape on serialize. For the common case
 * (no such characters) it is a no-op.
 */

import { parsePlist, serializePlist, type PlistValue } from './plist.js';

/** The four persisted BibDesk group kinds. */
export type GroupKind = 'static' | 'smart' | 'url' | 'script';

/**
 * A decoded group `@comment` block. `data` is the raw decoded plist array (one
 * dictionary per group) with BibDesk group-entity escaping reversed; the app /
 * `@bibdesk/groups` consumes it to build typed groups, and {@link serializeGroup}
 * re-emits it byte-faithfully.
 */
export interface GroupRecord {
  readonly kind: GroupKind;
  /** Decoded plist payload — an array of per-group dictionaries. */
  readonly data: PlistValue;
}

/** Map a group kind to the canonical `@comment` block label. */
const KIND_LABEL: Record<GroupKind, string> = {
  static: 'Static',
  smart: 'Smart',
  url: 'URL',
  script: 'Script',
};

/** Canonical write order of the group blocks (BibDocument.m:1828-1864). */
export const GROUP_ORDER: readonly GroupKind[] = ['static', 'smart', 'url', 'script'];

/** Recognise a `BibDesk <Label> Groups` comment header → its {@link GroupKind}. */
export function groupKindForCommentText(text: string): GroupKind | undefined {
  if (text.startsWith('BibDesk Static Groups')) return 'static';
  if (text.startsWith('BibDesk Smart Groups')) return 'smart';
  if (text.startsWith('BibDesk URL Groups')) return 'url';
  if (text.startsWith('BibDesk Script Groups')) return 'script';
  return undefined;
}

// --- group-plist entity escaping (BibDesk stringByEscapingGroupPlistEntities) -

const ESCAPE_MAP: ReadonlyArray<readonly [string, string]> = [
  ['%', '%25'], // must be first
  ['{', '%7B'],
  ['}', '%7D'],
  ['<', '%3C'],
  ['>', '%3E'],
  ['@', '%40'],
];

function escapeGroupEntities(s: string): string {
  let out = s;
  for (const [ch, enc] of ESCAPE_MAP) out = out.split(ch).join(enc);
  return out;
}

function unescapeGroupEntities(s: string): string {
  let out = s;
  // reverse order; %25 last so we don't double-decode
  for (let i = ESCAPE_MAP.length - 1; i >= 0; i--) {
    const [ch, enc] = ESCAPE_MAP[i]!;
    out = out.split(enc).join(ch);
  }
  return out;
}

/** Recursively map every string in a plist value through `fn`. */
function mapStrings(v: PlistValue, fn: (s: string) => string): PlistValue {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (typeof v === 'object' && v !== null && !('__plistInteger' in v)) {
    const out: { [k: string]: PlistValue } = {};
    for (const [k, val] of Object.entries(v as { [k: string]: PlistValue })) {
      out[k] = mapStrings(val, fn);
    }
    return out;
  }
  return v;
}

/**
 * Parse a group `@comment` block's extracted XML-plist payload into a
 * {@link GroupRecord}. `payload` is the text between the inner `{` and `}` of
 * `BibDesk <Label> Groups{ … }` (i.e. the leading `\n` + the plist + trailing
 * `\n`). Group-entity escaping is reversed on the decoded strings.
 */
export function parseGroup(kind: GroupKind, payload: string): GroupRecord {
  const decoded = parsePlist(payload);
  return { kind, data: mapStrings(decoded, unescapeGroupEntities) };
}

/**
 * Serialize one {@link GroupRecord} to its full `@comment` block, INCLUDING the
 * leading `\n\n` separator (matching BibDocument.m, which prefixes each block
 * with `"\n\n@comment{BibDesk <Label> Groups{\n"` and suffixes `"}}"`).
 * Group-entity escaping is re-applied before plist serialization.
 */
export function serializeGroup(record: GroupRecord): string {
  const escaped = mapStrings(record.data, escapeGroupEntities);
  const plistXml = serializePlist(escaped);
  return `\n\n@comment{BibDesk ${KIND_LABEL[record.kind]} Groups{\n${plistXml}}}`;
}
