/**
 * `parse(text): BibLibrary` — the BibTeX + BibDesk-extension reader.
 *
 * Strategy (mirrors `BDSKBibTeXParser.m`, simplified for the cross-platform
 * port; subsystem-02 §2):
 *   1. Normalise line endings to `\n` and capture the volatile `%%` header lines.
 *   2. Scan top-level `@type{ … }` / `@type( … )` blocks with brace/quote/paren
 *      nesting awareness; lexical `%`-comments outside entries are ignored.
 *   3. Dispatch on the lowercased type:
 *        - `string`        → define file-tier macros
 *        - `preamble`      → frontMatter (preamble) text
 *        - `comment`       → either a `BibDesk … Groups` block (decoded into a
 *                            GroupRecord) or a free comment (frontMatter)
 *        - `bibdesk_info`  → the document-info block
 *        - anything else   → a publication BibItem
 *   4. Field values are parsed into FieldValue (brace/quote/number/macro + `#`),
 *      mapped to canonical-cased field names; `bdsk-file-N` blobs are decoded.
 */

import {
  createBibItem,
  MacroResolver,
  sharedTypeManager,
  type BibItem,
  type FieldValue,
  isComplex,
} from '@bibdesk/model';

import type {
  BibLibrary,
  DocumentInfoEntry,
  HeaderInfo,
} from './library.js';
import { bdskFileKey } from './library.js';
import { parseValue } from './value-parser.js';
import {
  groupKindForCommentText,
  parseGroup,
  type GroupRecord,
} from './groups.js';
import { decodeBdskFile, isBdskFileBlob, type BdskFilePlist } from './bdsk-file.js';
import { canonicalFieldName } from './field-names.js';

/** A raw top-level block scanned out of the file. */
interface RawBlock {
  type: string; // lowercased
  /** `{` or `(` — the body delimiter used in the source. */
  delim: '{' | '(';
  body: string; // text between the delimiters
}

// ---------------------------------------------------------------------------
// Header capture
// ---------------------------------------------------------------------------

function captureHeader(text: string): HeaderInfo {
  const info: { createdFor?: string; savedEncoding?: string } = {};
  const createdRe = /^%%\s*Created for (.*)$/m;
  const savedRe = /^%%\s*Saved with string encoding (.*)$/m;
  const cm = createdRe.exec(text);
  if (cm && cm[1] !== undefined) info.createdFor = cm[1];
  const sm = savedRe.exec(text);
  if (sm && sm[1] !== undefined) info.savedEncoding = sm[1];
  return info;
}

// ---------------------------------------------------------------------------
// Top-level block scanner
// ---------------------------------------------------------------------------

/**
 * Scan all `@type<delim> … <closedelim>` blocks. Text outside blocks (lexical
 * comments, stray whitespace) is ignored — BibDesk does not round-trip it.
 */
function scanBlocks(text: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const at = text.indexOf('@', i);
    if (at === -1) break;
    // read type name (letters/digits/_)
    let j = at + 1;
    while (j < n && /[A-Za-z0-9_]/.test(text[j]!)) j++;
    const type = text.slice(at + 1, j).toLowerCase();
    // skip whitespace before the delimiter
    while (j < n && /\s/.test(text[j]!)) j++;
    const open = text[j];
    if (type.length === 0 || (open !== '{' && open !== '(')) {
      // not a real entry start; advance past the '@'
      i = at + 1;
      continue;
    }
    // Scan the body to its matching delimiter. BibTeX bodies are brace-balanced
    // (btparse balances `{`/`}` regardless of quotes/parens inside), so we track
    // brace depth and ignore quotes entirely FOR BRACE COUNTING — the embedded XML
    // plist of a group `@comment` is full of `"` attribute quotes that must NOT
    // be treated as string delimiters. For a paren-delimited body we additionally
    // need balanced parens (the `@comment(…)` form may contain nested parens).
    //
    // In-entry `%` line comments are skipped for brace counting so a comment like
    // `% see { note` can't desync the block boundary and swallow the entry (H2).
    // But this applies ONLY to FIELD-LIST bodies (entries, `@string`,
    // `@bibdesk_info`): a free-text `@comment{…}`/`@preamble{…}` body legitimately
    // carries a literal `%` (e.g. `@comment{Coverage 95% done}` from a JabRef/Zotero
    // export, or LaTeX in a preamble) at brace depth 0, which must NOT be treated as
    // a comment — doing so ate the block's own closing delimiter and corrupted the
    // (well-formed) body on save. `inQuote` is tracked only to gate that `%` skip;
    // it never affects brace counting.
    const stripFieldComments = type !== 'comment' && type !== 'preamble';
    let depthBrace = 0;
    let depthParen = 0;
    let inQuote = false;
    let k = j + 1;
    let end = -1;
    for (; k < n; k++) {
      const c = text[k];
      if (stripFieldComments && c === '"' && depthBrace === 0 && depthParen === 0) {
        inQuote = !inQuote;
        continue;
      }
      if (stripFieldComments && c === '%' && !inQuote && depthBrace === 0 && depthParen === 0) {
        const nl = text.indexOf('\n', k);
        if (nl === -1) break; // comment runs to EOF → block is unterminated
        k = nl; // resume at the newline (the loop's k++ steps past it)
        continue;
      }
      if (c === '{') {
        depthBrace++;
      } else if (c === '}') {
        if (open === '{' && depthBrace === 0) {
          end = k;
          break;
        }
        if (depthBrace > 0) depthBrace--;
      } else if (c === '(' && open === '(') {
        depthParen++;
      } else if (c === ')' && open === '(') {
        if (depthBrace === 0 && depthParen === 0) {
          end = k;
          break;
        }
        if (depthParen > 0) depthParen--;
      }
    }
    if (end === -1) {
      // Unterminated body (a missing `}`/`)`). Rather than swallow the rest of the
      // file — which silently deletes EVERY following entry on the next save — try
      // to resynchronise at the next top-level `@type{`/`@type(` start, so only
      // THIS malformed block is affected. btparse likewise resyncs at the next
      // entry (and reports an error). Falls back to consuming the rest only when no
      // further entry start is found.
      const resync = findNextEntryStart(text, j + 1);
      if (resync !== -1) {
        blocks.push({ type, delim: open, body: text.slice(j + 1, resync) });
        i = resync;
        continue;
      }
      end = n;
    }
    const body = text.slice(j + 1, end);
    blocks.push({ type, delim: open, body });
    i = end + 1;
  }
  return blocks;
}

/**
 * Find the next plausible top-level entry start (`@type{` / `@type(`) at or after
 * `from`, used to resynchronise after an unterminated block. To avoid matching a
 * stray `@` inside a field value (e.g. an email address), the `@` must sit at the
 * start of a line (only whitespace between the preceding newline and it) and be
 * followed by a type name and an opening delimiter. Returns -1 if none remains.
 */
function findNextEntryStart(text: string, from: number): number {
  const n = text.length;
  for (let p = from; p < n; p++) {
    if (text[p] !== '@') continue;
    // require line-start: only spaces/tabs between the previous newline and here
    let b = p - 1;
    while (b >= 0 && (text[b] === ' ' || text[b] === '\t')) b--;
    if (b >= 0 && text[b] !== '\n') continue;
    // require a type name followed by an opening delimiter
    let j = p + 1;
    while (j < n && /[A-Za-z0-9_]/.test(text[j]!)) j++;
    if (j === p + 1) continue; // no type name
    while (j < n && /\s/.test(text[j]!)) j++;
    if (text[j] === '{' || text[j] === '(') return p;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Field splitting (entry / @string body)
// ---------------------------------------------------------------------------

interface RawField {
  name: string;
  /** Raw value region text (between `=` and the comma/end). */
  valueText: string;
}

/**
 * Split an entry body into a leading cite key and its `name = value` fields,
 * honouring brace/quote/paren nesting (commas inside values don't split).
 */
function splitEntryBody(body: string): { citeKey: string; fields: RawField[] } {
  // first segment up to the first top-level comma is the cite key
  const segments = splitTopLevel(body, ',');
  const citeKey = (segments[0] ?? '').trim();
  const fields: RawField[] = [];
  for (let s = 1; s < segments.length; s++) {
    const seg = segments[s]!;
    const field = parseFieldAssignment(seg);
    if (field) fields.push(field);
  }
  return { citeKey, fields };
}

/** Split `@string`/`@bibdesk_info` body (no cite key) into `name = value` fields. */
function splitAssignmentList(body: string): RawField[] {
  const segments = splitTopLevel(body, ',');
  const fields: RawField[] = [];
  for (const seg of segments) {
    const field = parseFieldAssignment(seg);
    if (field) fields.push(field);
  }
  return fields;
}

/** Parse one `name = value` segment; returns undefined if blank/no `=`. */
function parseFieldAssignment(segment: string): RawField | undefined {
  const eq = findTopLevelEquals(segment);
  if (eq === -1) {
    return undefined;
  }
  const name = segment.slice(0, eq).trim();
  const valueText = segment.slice(eq + 1).trim();
  if (name.length === 0) return undefined;
  return { name, valueText };
}

/** Index of the first top-level `=` (outside braces/quotes), or -1. */
function findTopLevelEquals(s: string): number {
  let depthBrace = 0;
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === '{') depthBrace++;
      else if (c === '}') {
        if (depthBrace > 0) depthBrace--;
      } else if (c === '"' && depthBrace === 0) inQuote = false;
      continue;
    }
    if (c === '"' && depthBrace === 0) inQuote = true;
    else if (c === '{') depthBrace++;
    else if (c === '}') {
      if (depthBrace > 0) depthBrace--;
    } else if (c === '=' && depthBrace === 0) return i;
  }
  return -1;
}

/**
 * Split `s` on a top-level `sep` character (default `,`), respecting brace and
 * quote nesting.
 *
 * `%` line comments are stripped from the WHOLE body FIRST, in a single
 * brace/quote-aware pre-pass, so a comment's own `,` / `{` / `}` / `"` can't
 * desync the split. (Stripping per already-split segment — as this used to —
 * came too late: the splitter had already treated a comment comma as a field
 * separator and a comment brace as raising the nesting depth, silently dropping
 * or corrupting the following real field. btparse removes comments during
 * lexing, i.e. before splitting; this matches that.)
 */
function splitTopLevel(s: string, sep: ',' | ';'): string[] {
  const cleaned = stripLineComments(s);
  const out: string[] = [];
  let depthBrace = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inQuote) {
      if (c === '{') depthBrace++;
      else if (c === '}') {
        if (depthBrace > 0) depthBrace--;
      } else if (c === '"' && depthBrace === 0) inQuote = false;
      continue;
    }
    if (c === '"' && depthBrace === 0) inQuote = true;
    else if (c === '{') depthBrace++;
    else if (c === '}') {
      if (depthBrace > 0) depthBrace--;
    } else if (c === sep && depthBrace === 0) {
      out.push(cleaned.slice(start, i));
      start = i + 1;
    }
  }
  out.push(cleaned.slice(start));
  return out;
}

/**
 * Strip btparse-style in-entry `%` line comments from an entry / `@string` body:
 * a `%` that is not inside braces/quotes comments out the rest of its line. Runs
 * over the WHOLE body (see {@link splitTopLevel}) so a comment's own delimiters
 * are removed before the field split, not after. BibDesk does not round-trip
 * these. (The block scanner independently skips these comments for brace
 * counting; this removes their text from the split.)
 */
function stripLineComments(seg: string): string {
  let depthBrace = 0;
  let inQuote = false;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (inQuote) {
      if (c === '{') depthBrace++;
      else if (c === '}') {
        if (depthBrace > 0) depthBrace--;
      } else if (c === '"' && depthBrace === 0) inQuote = false;
      continue;
    }
    if (c === '"' && depthBrace === 0) inQuote = true;
    else if (c === '{') depthBrace++;
    else if (c === '}') {
      if (depthBrace > 0) depthBrace--;
    } else if (c === '%' && depthBrace === 0) {
      // remove from % to end of its line, keep the rest
      const nl = seg.indexOf('\n', i);
      if (nl === -1) return seg.slice(0, i);
      seg = seg.slice(0, i) + seg.slice(nl);
      // continue scanning from i (now the newline)
    }
  }
  return seg;
}

// ---------------------------------------------------------------------------
// Block handlers
// ---------------------------------------------------------------------------

function handleString(block: RawBlock, fileTier: MacroResolver): void {
  for (const f of splitAssignmentList(block.body)) {
    const value = parseValue(f.valueText);
    fileTier.define(f.name, value);
  }
}

function handlePreamble(block: RawBlock, preambles: string[]): void {
  // frontMatter stores the @preamble verbatim, re-wrapped on write. We keep the
  // raw body text (the value region) so it can be re-emitted.
  preambles.push(`@preamble{${block.body.trim()}}`);
}

function handleComment(
  block: RawBlock,
  groups: GroupRecord[],
  preambles: string[],
): void {
  const bodyTrimmed = block.body.trimStart();
  const kind = groupKindForCommentText(bodyTrimmed);
  if (kind) {
    // extract the inner plist between the first `{` and the last `}`
    const first = block.body.indexOf('{');
    const last = block.body.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      const payload = block.body.slice(first + 1, last);
      groups.push(parseGroup(kind, payload));
      return;
    }
  }
  // free comment → frontMatter
  preambles.push(`@comment{${block.body}}`);
}

function handleDocumentInfo(block: RawBlock): DocumentInfoEntry[] {
  const entries: DocumentInfoEntry[] = [];
  const { fields } = splitEntryBody(block.body);
  for (const f of fields) {
    entries.push({ key: f.name, value: parseValue(f.valueText) });
  }
  return entries;
}

function handleEntry(
  block: RawBlock,
  fileTier: MacroResolver,
  documentResolver: MacroResolver,
  bdskFiles: Map<string, BdskFilePlist>,
): BibItem {
  const { citeKey, fields } = splitEntryBody(block.body);
  const parsedFields: Record<string, FieldValue> = {};
  // collect bdsk-file decodes keyed by canonical field name (filled after item id known)
  const fileDecodes: { canonical: string; plist: BdskFilePlist }[] = [];

  for (const f of fields) {
    const canonical = canonicalFieldName(f.name);
    const value = parseValue(f.valueText);
    parsedFields[canonical] = value;
    // decode bdsk-file-N blobs (raw string values only)
    if (/^bdsk-file-\d+$/i.test(f.name) && !isComplex(value) && isBdskFileBlob(value)) {
      const decoded = decodeBdskFile(value);
      if (decoded !== undefined) {
        fileDecodes.push({ canonical, plist: decoded });
      }
    }
  }

  const item = createBibItem(
    {
      citeKey,
      type: block.type,
      fields: parsedFields,
      macroResolver: documentResolver,
    },
    sharedTypeManager,
  );

  for (const d of fileDecodes) {
    bdskFiles.set(bdskFileKey(item.id, d.canonical), d.plist);
  }
  return item;
}

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

/** Parse BibTeX/BibDesk text into a {@link BibLibrary}. */
export function parse(text: string): BibLibrary {
  // N1: normalise line endings.
  const normalized = text.replace(/\r\n?/g, '\n');
  const header = captureHeader(normalized);

  // 3-tier resolver: document <- file <- global(months). File @strings load
  // into the file tier so complex values expand correctly.
  const documentResolver = MacroResolver.createStandardStack();
  const fileTier = documentResolver.parent!; // file tier

  const items: BibItem[] = [];
  const preambles: string[] = [];
  const groups: GroupRecord[] = [];
  const bdskFiles = new Map<string, BdskFilePlist>();
  let documentInfo: DocumentInfoEntry[] | undefined;

  for (const block of scanBlocks(normalized)) {
    switch (block.type) {
      case 'string':
        handleString(block, fileTier);
        break;
      case 'preamble':
        handlePreamble(block, preambles);
        break;
      case 'comment':
        handleComment(block, groups, preambles);
        break;
      case 'bibdesk_info':
        documentInfo = handleDocumentInfo(block);
        break;
      default:
        items.push(handleEntry(block, fileTier, documentResolver, bdskFiles));
        break;
    }
  }

  const lib: BibLibrary = documentInfo
    ? {
        items,
        macroResolver: documentResolver,
        preambles,
        documentInfo,
        groups,
        header,
        bdskFiles,
      }
    : {
        items,
        macroResolver: documentResolver,
        preambles,
        groups,
        header,
        bdskFiles,
      };
  return lib;
}
