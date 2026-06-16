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
}

/** Parse a `{ … }` brace-delimited literal starting at `text[i] === '{'`. */
function parseBraced(text: string, i: number): PieceResult {
  let depth = 0;
  let j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
  }
  // inner content excludes the outer braces
  const inner = text.slice(i + 1, j - 1);
  return { node: stringNode(inner), next: j };
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
  return { node: stringNode(inner), next: j + 1 };
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
