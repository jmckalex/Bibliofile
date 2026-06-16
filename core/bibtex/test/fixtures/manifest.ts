/**
 * Fixture manifest for the `@bibdesk/bibtex` golden round-trip harness (T1).
 *
 * Each entry records the fixture's on-disk path (relative to this directory),
 * a human description, the expected round-trip `mode`, and notes for the C4 author.
 *
 *   mode = 'byte-exact'  → serialize(parse(text)) === text   (already canonical)
 *   mode = 'normalized'  → equal only after the documented normalizers
 *                          (see ../roundtrip.ts, transcribed from subsystem-12 §2)
 *   mode = 'structural'  → not text-comparable (lossy re-sort/merge); compare
 *                          parsed structure instead.
 *
 * `reference/*` are copied READ-ONLY from the OLD source tree:
 *   bibdesk/vendorsrc/gward/btparse/t/data/*.bib  and  bibdesk/Scripting/BD test.bib.
 * `synthesized/*` are BibDesk-authored fixtures written in canonical form for T1.
 */

import type { RoundTripMode } from '../roundtrip';

export interface FixtureEntry {
  /** Path relative to this fixtures directory. */
  file: string;
  description: string;
  mode: RoundTripMode;
  /** Whether this is copied reference data or T1-synthesized. */
  origin: 'reference' | 'synthesized';
  notes: string;
}

export const FIXTURES: readonly FixtureEntry[] = [
  // ----- Reference corpus (btparse test data) -----------------------------
  {
    file: 'reference/empty.bib',
    description: 'Empty file (0 bytes).',
    mode: 'byte-exact',
    origin: 'reference',
    notes: 'serialize(parse("")) must yield "" — no header emitted when hasData==NO (BibDocument.m:1866).',
  },
  {
    file: 'reference/regular.bib',
    description: 'A single @book with "#" concatenation, a bare macro ref, a number value, and an in-entry % comment.',
    // C4: reclassified normalized → structural. The serializer applies the
    // *structural* normalizations N3 (field names lower-cased), N4 (sorted),
    // N6 (`"Book"`→`{Book}`, bare `1922`→`{1922}`) and injects the BibDesk
    // header template — none of which `normalizeCanonical` (text-only: N1, N2,
    // N8, header-mask) can model, so text equality is unreachable for this
    // non-canonical input. The serializer's canonical output IS correct and is a
    // stable fixed point (serialize∘parse∘serialize == serialize), which the
    // structural test asserts.
    mode: 'structural',
    origin: 'reference',
    notes:
      'Lossy on write: field names lower-cased+sorted, values re-wrapped as {…} (the `"Book"`, `# junk`, `year = 1922` forms are lost), the trailing `% an in-entry comment` is dropped, and the BibDesk header template is added. These are structural (N3/N4/N6) + header changes the text comparator cannot model; the canonical output is a serialize fixed point. Originally tagged `normalized`; reclassified to `structural` by C4.',
  },
  {
    file: 'reference/macro.bib',
    description: '@string( ) macro block with two macros, one using "#" concatenation, paren-delimited.',
    // C4: reclassified normalized → structural. The paren-form `@string( a, b )`
    // becomes two `\n@string{…}\n` lines (sorted), `"…"` literals become `{…}`,
    // and the BibDesk header template is injected — structural rewrites the
    // text-only `normalizeCanonical` cannot apply. Output is a serialize fixed point.
    mode: 'structural',
    origin: 'reference',
    notes:
      'Paren delimiters → BibDesk writes `@string{name = value}` one per line; macros sorted; "…" literals re-wrapped as {…}; header template added. Structural rewrites the text comparator cannot model; canonical output is a serialize fixed point. Originally tagged `normalized`; reclassified to `structural` by C4.',
  },
  {
    file: 'reference/comment.bib',
    description: '@comment( ) entry plus a leading lexical % comment.',
    mode: 'structural',
    origin: 'reference',
    notes:
      'BibDesk merges @comment/@preamble into frontMatter relocated to top; a free-text @comment that is NOT a "BibDesk … Groups" block is preserved but its position/parenthesis style is not byte-stable. Compare parsed structure.',
  },
  {
    file: 'reference/preamble.bib',
    description: '@preamble with "#" string concatenation across two lines.',
    // C4: reclassified normalized → structural. This bare fixture has NO BibDesk
    // header; the serializer (correctly) injects the template header, so
    // `normalizeCanonical(input)` (no header) can never equal the output (which
    // keeps the non-volatile template lines). The preamble itself round-trips
    // faithfully; output is a serialize fixed point.
    mode: 'structural',
    origin: 'reference',
    notes:
      '@preamble becomes part of frontMatter, written near the top; the BibDesk header template is injected (the input has none), which `normalizeCanonical` keeps (template lines are non-volatile) so text equality is unreachable. Concatenation preserved as a complex value; canonical output is a serialize fixed point. Originally tagged `normalized`; reclassified to `structural` by C4.',
  },
  {
    file: 'reference/simple.bib',
    description: 'All of the above concatenated: @book + @string + lexical comment + @comment + @preamble.',
    mode: 'structural',
    origin: 'reference',
    notes:
      'Exercises the full write-order re-ordering (header → @string → entries → frontMatter/@comment). Interleaving is lost; compare structure.',
  },
  {
    file: 'reference/bd-test.bib',
    description: "Real BibDesk file (Scripting/'BD test.bib'): 3 @article/@misc entries with Local-Url, Eprint, brace-protected title casing.",
    // C4: reclassified normalized → structural. Two structural changes the
    // text-only comparator cannot model: (1) N3 field-name lower-casing
    // (`Author`→`author` etc.; the fixture is capitalized BibDesk-style); (2)
    // the legacy `%% http://www.cs.ucsd.edu/...` template URL is rewritten to the
    // modern `%% https://bibdesk.sourceforge.io/` (BibDesk always re-emits its own
    // template.txt on save) — and that URL line is NOT volatile, so
    // `stripVolatileHeader` does not mask it. The `%% Created for …` line IS
    // captured and re-emitted verbatim. Output is a serialize fixed point.
    mode: 'structural',
    origin: 'reference',
    notes:
      'Authored by an OLD BibDesk (header URL is the legacy cs.ucsd.edu one, and the "Saved with string encoding" line is absent). Serializer lower-cases field names (N3) and rewrites the legacy template URL to the modern one (non-volatile → not masked), so text equality is unreachable; canonical output is a serialize fixed point. Originally tagged `normalized`; reclassified to `structural` by C4.',
  },

  // ----- Synthesized BibDesk fixtures (canonical form) --------------------
  {
    file: 'synthesized/bd-string-macros.bib',
    description: '@string macros (AMS, jcp) sorted; one @article referencing a macro value.',
    mode: 'byte-exact',
    origin: 'synthesized',
    notes:
      'Written in canonical form: header template, "\\n@string{name = value}\\n" per macro (BDSKMacroResolver.m:137), entry fields sorted+braced. Volatile header lines present; byte-exact assumes the C4 serializer reproduces the SAME header. If C4 regenerates the header (different user/date), downgrade comparison to normalizeCanonical.',
  },
  {
    file: 'synthesized/bd-preamble.bib',
    description: 'Header + @preamble{\\newcommand…} + a single @book entry.',
    mode: 'byte-exact',
    origin: 'synthesized',
    notes: 'frontMatter (@preamble) appended directly after header per BibDocument.m:1767-1773, then entry.',
  },
  {
    file: 'synthesized/bd-static-groups.bib',
    description: 'Header + two entries (with Date-Added/Date-Modified) + a "BibDesk Static Groups" @comment block.',
    mode: 'byte-exact',
    origin: 'synthesized',
    notes:
      'Static group block format: "\\n\\n@comment{BibDesk Static Groups{\\n" + XML-plist(array of {"group name","keys"}) + "}}" (BibDocument.m:1830-1832, BDSKStaticGroup.m:91). keys = cite keys comma-joined.',
  },
  {
    file: 'synthesized/bd-bdsk-file-url.bib',
    description: 'Header + one @article with Bdsk-File-1 (base64 binary plist, YnBsaXN0 prefix), Bdsk-Url-1, Local-Url, Date-Added/Modified.',
    mode: 'byte-exact',
    origin: 'synthesized',
    notes:
      'Linked-file/URL fields written LAST (BibItem.m:1836-1842 via filesAsBibTeXFragmentRelativeToPath:, "\\t bdsk-file-N = {…}"). bdsk-file-1 value is base64 of a binary plist {relativePath=…}; bdsk-url-1 is a plain absolute URL.',
  },
  {
    file: 'synthesized/bd-all-groups.bib',
    description: 'Kitchen sink: header + @bibdesk_info + 2 @string + 2 entries (one with bdsk-file/url) + all four group blocks (Static, Smart, URL, Script) in canonical order.',
    mode: 'byte-exact',
    origin: 'synthesized',
    notes:
      'Full write order (BibDocument.m:1722-1869): header → @bibdesk_info{document_info,…} → @string macros → entries (\\n\\n-separated) → Static → Smart → URL → Script group blocks → trailing "\\n". Smart-group plist carries conjunction(0/1)+conditions[{key,value,comparison,version}]; condition/dict keys are emitted ALPHABETICALLY by NSPropertyListSerialization.',
  },
] as const;

/** All distinct modes present, for sanity checks. */
export const FIXTURE_MODES: readonly RoundTripMode[] = ['byte-exact', 'normalized', 'structural'];
