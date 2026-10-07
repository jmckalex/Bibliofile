/**
 * Field-value parsing: turn the raw text on the right-hand side of a BibTeX
 * `field = …` (or a `@string`/`@preamble` body) into a model {@link FieldValue}.
 *
 * Handles the four BibTeX value pieces and `#` concatenation:
 *   - brace-delimited `{ … }`   → literal string (depth-tracked, braces kept inside)
 *   - quote-delimited `" … "`   → literal string (brace-depth-aware for `"`)
 *   - bare number `1922`        → number node
 *   - bare name `jan`           → macro node
 *   - `a # b # c`               → ComplexValue of the joined nodes
 *
 * A single literal/number collapses to a bare string via {@link normalizeValue}
 * (so the common case is a plain `string`), matching BibDesk where such a value
 * is not "complex". The text passed in must already be the value region (the
 * caller has located the `= … ,`/`}` boundaries with brace/quote awareness).
 */

import {
  type FieldValue,
  type StringNode,
  stringNode,
  numberNode,
  macroNode,
  complexValue,
  normalizeValue,
} from '@bibdesk/model';

/** A single parsed value piece plus the index just past it. */
interface PieceResult {
  node: StringNode;
  next: number;
  /** For a braced/quoted piece: was its closing delimiter found? */
  closed?: boolean;
}

/** Parse a `{ … }` brace-delimited literal starting at `text[i] === '{'`. */
function parseBraced(text: string, i: number): PieceResult {
  let depth = 0;
  let closed = false;
  let j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        j++;
        closed = true;
        break;
      }
    }
  }
  // Normal case: `j` is just past the closing `}`, so the inner content is
  // `[i+1, j-1)`. If the group was never closed (missing `}` in a malformed
  // file), `j === text.length` and `j - 1` would chop the last REAL character —
  // keep everything after the opening brace instead.
  const inner = closed ? text.slice(i + 1, j - 1) : text.slice(i + 1);
  return { node: stringNode(inner), next: j, closed };
}

/** Parse a `" … "` quote-delimited literal starting at `text[i] === '"'`. */
function parseQuoted(text: string, i: number): PieceResult {
  let depth = 0;
  let j = i + 1;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '{') depth++;
    else if (c === '}') {
      if (depth > 0) depth--;
    } else if (c === '"' && depth === 0) {
      break;
    }
  }
  const inner = text.slice(i + 1, j);
  // consume the closing quote
  return { node: stringNode(inner), next: j + 1, closed: j < text.length };
}

/** Parse a bare token (number or macro name) starting at `text[i]`. */
function parseBare(text: string, i: number): PieceResult {
  let j = i;
  // a bare token runs until whitespace, a '#', or end
  for (; j < text.length; j++) {
    const c = text[j]!;
    if (c === '#' || /\s/.test(c)) break;
  }
  const token = text.slice(i, j);
  const node = /^[0-9]+$/.test(token) ? numberNode(token) : macroNode(token);
  return { node, next: j };
}

/**
 * Parse a complete value region into a {@link FieldValue}. The region is the
 * text between `=` and the field terminator, with surrounding whitespace
 * already trimmed by the caller is NOT required — this is whitespace-tolerant.
 */
export function parseValue(region: string): FieldValue {
  const nodes: StringNode[] = [];
  let i = 0;
  const n = region.length;
  while (i < n) {
    // skip leading whitespace
    while (i < n && /\s/.test(region[i]!)) i++;
    if (i >= n) break;
    const c = region[i]!;
    if (c === '#') {
      // concatenation separator — just advance
      i++;
      continue;
    }
    let piece: PieceResult;
    if (c === '{') piece = parseBraced(region, i);
    else if (c === '"') piece = parseQuoted(region, i);
    else piece = parseBare(region, i);
    nodes.push(piece.node);
    i = piece.next;
  }
  if (nodes.length === 0) {
    // empty value (e.g. `field = {}` or `field = ""`)
    return '';
  }
  return normalizeValue(complexValue(nodes));
}

/** A bare token that can stand alone in a value: a number or a plain macro name. */
const BARE_TOKEN = /^[^\s#{}"%'(),=]+$/;

/**
 * Parse text a person typed as a BibTeX value expression (`dec`, `"Proc. " # acm`,
 * `{May} # " 2020"`), or `undefined` when it is not one: an unclosed brace or quote,
 * two pieces with no `#` between them, a dangling `#`, or a bare token that is not a
 * number or a macro name. {@link parseValue} must accept whatever is on disk; this
 * decides whether typed text was meant as an expression at all (`Spring term` wasn't).
 */
export function parseValueStrict(text: string): FieldValue | undefined {
  const nodes: StringNode[] = [];
  let expectPiece = true;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '#') {
      if (expectPiece) return undefined;
      expectPiece = true;
      i++;
      continue;
    }
    if (!expectPiece) return undefined;
    let piece: PieceResult;
    if (c === '{') piece = parseBraced(text, i);
    else if (c === '"') piece = parseQuoted(text, i);
    else {
      piece = parseBare(text, i);
      if (!BARE_TOKEN.test(text.slice(i, piece.next))) return undefined;
    }
    if (piece.closed === false) return undefined;
    nodes.push(piece.node);
    i = piece.next;
    expectPiece = false;
  }
  if (expectPiece) return undefined; // empty, or a trailing `#`
  return normalizeValue(complexValue(nodes));
}
