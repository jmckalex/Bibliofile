/**
 * Byte-faithful Apple XML property-list (`NSPropertyListXMLFormat_v1_0`) codec,
 * used for the BibDesk group `@comment` blocks.
 *
 * BibDesk serialises each group block's payload with
 * `NSPropertyListSerialization dataWithPropertyList:format:NSPropertyListXMLFormat_v1_0`
 * (`BibDocument.m:1713`). To round-trip a `.bib` byte-for-byte we must reproduce
 * Apple's exact XML layout:
 *
 *   - header `<?xml version="1.0" encoding="UTF-8"?>\n`
 *   - Apple DOCTYPE line
 *   - `<plist version="1.0">\n`
 *   - tab-indented (one `\t` per nesting level) elements
 *   - `<dict>` keys emitted **alphabetically** (NSDictionary → sorted by Apple)
 *   - text escaping limited to `&`/`<`/`>` (quotes are NOT escaped)
 *   - empty string → `<string></string>`
 *   - integers → `<integer>N</integer>`, booleans → `<true/>`/`<false/>`
 *
 * The parser is a small hand-rolled XML reader that produces plain JS values
 * (`PlistValue`). It is intentionally narrow: it only handles the node kinds
 * Apple emits for BibDesk group dictionaries (dict / array / string / integer /
 * real / true / false / data). That is sufficient for faithful round-trip.
 */

/** A decoded plist scalar/aggregate value (plain JS). */
export type PlistValue =
  | string
  | number
  | boolean
  | PlistInteger
  | PlistValue[]
  | { [key: string]: PlistValue };

/**
 * An integer plist value. We wrap integers so the serializer can distinguish
 * `<integer>` from `<real>` and from a numeric `<string>` on the way back out.
 * Apple-XML integers have no fractional part; we preserve the textual form.
 */
export interface PlistInteger {
  readonly __plistInteger: string;
}

/** Construct a tagged plist integer from a textual digit string. */
export function plistInteger(text: string): PlistInteger {
  return { __plistInteger: text };
}

/** Type guard for a tagged plist integer. */
export function isPlistInteger(v: unknown): v is PlistInteger {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as PlistInteger).__plistInteger === 'string'
  );
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';
const XML_DOCTYPE =
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n';
const PLIST_OPEN = '<plist version="1.0">\n';
const PLIST_CLOSE = '</plist>\n';

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/** Escape the three characters Apple escapes in XML plist text nodes. */
function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Serialize a {@link PlistValue} to an Apple-XML plist string, byte-for-byte
 * matching `NSPropertyListSerialization`'s `NSPropertyListXMLFormat_v1_0`
 * output (tabs, alphabetical dict keys, trailing newline).
 */
export function serializePlist(value: PlistValue): string {
  return XML_HEADER + XML_DOCTYPE + PLIST_OPEN + serializeNode(value, 0) + PLIST_CLOSE;
}

function indent(level: number): string {
  return '\t'.repeat(level);
}

function serializeNode(value: PlistValue, level: number): string {
  const pad = indent(level);
  if (typeof value === 'string') {
    return value.length === 0
      ? `${pad}<string></string>\n`
      : `${pad}<string>${escapeXmlText(value)}</string>\n`;
  }
  if (typeof value === 'boolean') {
    return value ? `${pad}<true/>\n` : `${pad}<false/>\n`;
  }
  if (isPlistInteger(value)) {
    return `${pad}<integer>${value.__plistInteger}</integer>\n`;
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? `${pad}<integer>${value}</integer>\n`
      : `${pad}<real>${value}</real>\n`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}<array/>\n`;
    let out = `${pad}<array>\n`;
    for (const item of value) out += serializeNode(item, level + 1);
    out += `${pad}</array>\n`;
    return out;
  }
  // dict — keys emitted alphabetically (Apple sorts NSDictionary keys)
  const keys = Object.keys(value).sort();
  if (keys.length === 0) return `${pad}<dict/>\n`;
  let out = `${pad}<dict>\n`;
  const inner = indent(level + 1);
  for (const key of keys) {
    out += `${inner}<key>${escapeXmlText(key)}</key>\n`;
    out += serializeNode(value[key]!, level + 1);
  }
  out += `${pad}</dict>\n`;
  return out;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/** Decode the three XML entities Apple emits (plus the common `&quot;`/`&apos;`). */
function unescapeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&amp;/g, '&');
}

interface Token {
  /** `open` | `close` | `selfclose` | `text` */
  kind: 'open' | 'close' | 'selfclose' | 'text';
  name: string;
  text: string;
}

/**
 * Tokenize the body between `<plist ...>` and `</plist>` into a flat element
 * stream. Skips the prolog, DOCTYPE, comments and the `<plist>` wrapper.
 */
function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;
    // text between elements
    if (lt > i) {
      const raw = xml.slice(i, lt);
      if (raw.trim().length > 0) {
        tokens.push({ kind: 'text', name: '', text: raw });
      }
    }
    // prolog / doctype / comment
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const gt = xml.indexOf('>', lt);
    if (gt === -1) break;
    let inner = xml.slice(lt + 1, gt);
    const selfClose = inner.endsWith('/');
    if (selfClose) inner = inner.slice(0, -1);
    inner = inner.trim();
    const isClose = inner.startsWith('/');
    if (isClose) inner = inner.slice(1).trim();
    // element name = up to first whitespace
    const sp = inner.search(/\s/);
    const name = (sp === -1 ? inner : inner.slice(0, sp)).toLowerCase();
    if (name === 'plist') {
      // skip the plist wrapper tags entirely
      i = gt + 1;
      continue;
    }
    tokens.push({
      kind: isClose ? 'close' : selfClose ? 'selfclose' : 'open',
      name,
      text: '',
    });
    i = gt + 1;
  }
  return tokens;
}

/**
 * Parse an Apple-XML plist string into a {@link PlistValue}. Integers are
 * returned as tagged {@link PlistInteger} so they re-serialize as `<integer>`.
 */
export function parsePlist(xml: string): PlistValue {
  const tokens = tokenize(xml);
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function parseValue(): PlistValue {
    const tok = tokens[pos];
    if (!tok) throw new Error('Unexpected end of plist');
    switch (tok.name) {
      case 'dict':
        return parseDict(tok);
      case 'array':
        return parseArray(tok);
      case 'string':
        return parseScalar(tok, (t) => unescapeXmlText(t));
      case 'integer':
        return parseScalar(tok, (t) => plistInteger(t.trim()));
      case 'real':
        return parseScalar(tok, (t) => Number(t.trim()));
      case 'true':
        pos++;
        return true;
      case 'false':
        pos++;
        return false;
      case 'data':
        // base64 data — keep as a plain (trimmed) string; not used by groups.
        return parseScalar(tok, (t) => t.replace(/\s+/g, ''));
      case 'date':
        return parseScalar(tok, (t) => t.trim());
      default:
        throw new Error(`Unsupported plist element <${tok.name}>`);
    }
  }

  function parseScalar(tok: Token, conv: (t: string) => PlistValue): PlistValue {
    if (tok.kind === 'selfclose') {
      pos++;
      return conv('');
    }
    pos++; // consume open
    let text = '';
    while (pos < tokens.length && tokens[pos]!.kind === 'text') {
      text += tokens[pos]!.text;
      pos++;
    }
    // consume matching close
    if (pos < tokens.length && tokens[pos]!.kind === 'close') pos++;
    return conv(text);
  }

  function parseArray(tok: Token): PlistValue {
    if (tok.kind === 'selfclose') {
      pos++;
      return [];
    }
    pos++; // consume <array>
    const out: PlistValue[] = [];
    while (pos < tokens.length && !(tokens[pos]!.kind === 'close' && tokens[pos]!.name === 'array')) {
      out.push(parseValue());
    }
    if (pos < tokens.length) pos++; // consume </array>
    return out;
  }

  function parseDict(tok: Token): PlistValue {
    if (tok.kind === 'selfclose') {
      pos++;
      return {};
    }
    pos++; // consume <dict>
    const out: { [key: string]: PlistValue } = {};
    while (pos < tokens.length && !(tokens[pos]!.kind === 'close' && tokens[pos]!.name === 'dict')) {
      const keyTok = tokens[pos];
      if (!keyTok || keyTok.name !== 'key') {
        throw new Error('Expected <key> in <dict>');
      }
      const key = parseScalar(keyTok, (t) => unescapeXmlText(t)) as string;
      out[key] = parseValue();
    }
    if (pos < tokens.length) pos++; // consume </dict>
    return out;
  }

  // find first content element
  while (peek() && peek()!.kind === 'text') pos++;
  if (!peek()) {
    // empty plist body
    return [];
  }
  return parseValue();
}
