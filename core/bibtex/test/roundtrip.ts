/**
 * Golden round-trip test harness (T1) for `@bibdesk/bibtex`.
 *
 * This module is the ACCEPTANCE CONTRACT for the BibTeX parser/serializer (C4).
 * It targets exactly the two public entry points of `../src/index`:
 *
 *     parse(text: string): BibLibrary
 *     serialize(lib: BibLibrary): string
 *
 * and the round-trip property:
 *
 *     serialize(parse(text)) === text          (strict / byte-exact)
 *     normalize(serialize(parse(text))) === normalize(text)   (normalized)
 *
 * The normalizations below are transcribed from
 *   port-analysis/subsystem-12-lifecycle-build.md §2  (on-disk format + what
 *   BibDesk normalizes on write), cross-checked against the BibDesk sources
 *   BibDocument.m (write order / group blocks) and BibItem.m (per-entry write).
 *
 * Everything here is pure (no parse/serialize calls) so the C4 author can reuse
 * the normalizers and helpers when implementing and self-testing the codec.
 */

import { parse, serialize } from '../src/index';
import type { BibLibrary } from '../src/index';

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/**
 * How a fixture is expected to round-trip.
 *  - `byte-exact`   : already in BibDesk-canonical form; `serialize(parse(x)) === x`.
 *  - `normalized`   : only round-trips after applying the documented normalizers
 *                     (subsystem-12 §2) to BOTH the input and the re-serialized output.
 *  - `structural`   : not text-comparable (e.g. lossy re-sort/merge that we don't
 *                     model in the text normalizer); compare parsed structure instead.
 */
export type RoundTripMode = 'byte-exact' | 'normalized' | 'structural';

// ---------------------------------------------------------------------------
// Documented normalizations (subsystem-12 §2)
//
// BibDesk's writer (`bibTeXDataDroppingInternal:` + `BibItem.bibTeXDataWithOptions:`)
// is NOT a byte-identity transform on arbitrary input. It rewrites a `.bib` into a
// canonical form. The functions below model the *text-level* canonicalizations so a
// non-canonical fixture can be compared to its re-serialized form.
//
// N1  Line endings collapsed to "\n" (the writer emits "\n"/"\n\n" literals).
// N2  Lexical "%"-comments that are not part of the BibDesk header are dropped
//     (loose inter-entry text is not preserved). [subsystem-12 §2 "Lossy"]
// N3  Field NAMES lower-cased.                       [BibItem.m:1823]
// N4  Field NAMES sorted case-insensitively within an entry; linked-file/URL
//     fields (bdsk-file-N / bdsk-url-N) forced LAST.  [BibItem.m:1757, 1836-1842]
// N5  Entry @type and the "@string"/"@preamble"/"@comment"/"@bibdesk_info" tokens
//     lower-cased; entry citekey preserved verbatim.  [subsystem-12 §2]
// N6  Field VALUES always wrapped in {…}; original "…"/bare-number/paren delimiters
//     lost; "(...)" entry delimiters become "{...}".   [subsystem-12 §2]
// N7  Assignment normalized to " = "; field separator to ",\n\t"; one entry begins
//     with no leading separator and ends with "}".     [BibItem.m:1789-1790, 1822]
// N8  Inter-comment / inter-entry whitespace normalized to a single blank line
//     ("\n\n") between top-level blocks.                [BibDocument.m:1764, 1817]
// N9  Empty fields dropped.                              [BibItem.m:1814-1820]
//
// The two cosmetic "%%" header lines ("Created for …", "Saved with string encoding …")
// are INFORMATIONAL ONLY and never parsed back — `stripVolatileHeader` removes them so
// they don't defeat comparison when the date/user/encoding differ.
//
// NOTE: N3/N4/N5/N6/N7/N9 are *structural* (they need a real parse to apply safely).
// The text normalizers here implement the safely-text-only subset (N1, N2, N8, header)
// plus value-delimiter + whitespace canonicalizers usable on already-canonical text.
// `normalizeCanonical` is the comparison used for the `normalized` fixtures; it is
// idempotent on BibDesk-canonical output.
// ---------------------------------------------------------------------------

/** N1: normalize CRLF / lone-CR line endings to LF. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Remove BibDesk's two volatile header comment lines so fixtures written by a
 * different user / at a different time / with a different encoding still compare.
 * Matches:  `%% Created for <x> at <date> `  and  `%% Saved with string encoding <name> `.
 * The first two template lines ("created using BibDesk" / URL) are stable and kept.
 */
export function stripVolatileHeader(text: string): string {
  return text
    .replace(/^%%\s*Created for .*$/gm, '%% Created for <USER> at <DATE>')
    .replace(/^%%\s*Saved with string encoding .*$/gm, '%% Saved with string encoding <ENCODING>');
}

/**
 * N2: drop loose lexical "%"-comment lines that are NOT BibDesk "%%" directives.
 * btparse treats a single leading "%" comment as lexical (never seen by the grammar),
 * and BibDesk does not round-trip them. We keep "%%" (BibDesk header/template) lines.
 */
export function dropLexicalComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*%(?!%)/.test(line))
    .join('\n');
}

/** N8: collapse runs of 3+ newlines down to the canonical blank-line separator. */
export function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}

/** Trim trailing whitespace on every line and a trailing run of blank lines. */
export function trimTrailingWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '\n');
}

/**
 * The canonical comparison normalizer used for `normalized`-mode fixtures.
 * Applies the text-safe documented normalizations (N1, header, N2, N8) plus
 * trailing-whitespace cleanup. Idempotent.
 */
export function normalizeCanonical(text: string): string {
  let t = normalizeLineEndings(text);
  t = stripVolatileHeader(t);
  t = dropLexicalComments(t);
  t = collapseBlankLines(t);
  t = trimTrailingWhitespace(t);
  return t;
}

/**
 * The minimal comparison used for `byte-exact` fixtures: only line-ending
 * normalization (so a fixture authored with CRLF on Windows still passes). This
 * is deliberately NOT lossy — everything else must already match byte-for-byte.
 */
export function normalizeByteExact(text: string): string {
  return normalizeLineEndings(text);
}

// ---------------------------------------------------------------------------
// Round-trip runner
// ---------------------------------------------------------------------------

export interface RoundTripResult {
  /** True when the (mode-appropriate) comparison passed. */
  ok: boolean;
  /** The exact bytes produced by serialize(parse(input)). */
  output: string;
  /** Input after the comparison transform was applied. */
  expected: string;
  /** Output after the comparison transform was applied. */
  actual: string;
  mode: RoundTripMode;
}

/** Pick the comparison transform for a mode. */
export function comparatorFor(mode: RoundTripMode): (s: string) => string {
  switch (mode) {
    case 'byte-exact':
      return normalizeByteExact;
    case 'normalized':
      return normalizeCanonical;
    case 'structural':
      // Structural comparison is not text-based; callers should compare parsed
      // libraries instead. We still expose identity so the runner stays total.
      return (s) => s;
  }
}

/**
 * Run the round-trip on `input` text and return a structured result.
 * Does NOT throw on mismatch — callers (tests) assert on `.ok` so they can show
 * a useful diff. WILL throw if parse/serialize themselves throw (e.g. the C4
 * stub's NotImplementedError) — that is intentional: the contract is inactive
 * until C4 lands.
 */
export function runRoundTrip(input: string, mode: RoundTripMode): RoundTripResult {
  const lib: BibLibrary = parse(input);
  const output: string = serialize(lib);
  const cmp = comparatorFor(mode);
  const expected = cmp(input);
  const actual = cmp(output);
  return { ok: actual === expected, output, expected, actual, mode };
}

/** Convenience: round-trip a library through serialize→parse→serialize and assert idempotence of serialize. */
export function reserialize(lib: BibLibrary): string {
  return serialize(parse(serialize(lib)));
}
