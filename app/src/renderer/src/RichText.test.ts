/**
 * The hint strings in `en.ts` carry `**bold**` / `*italic*` / `` `code` `` markup
 * that `Rich` turns into elements. If a catalog string's markers don't balance,
 * the marker characters leak into the UI as literal asterisks/backticks — silent,
 * and invisible until someone reads that pane. So assert the catalog and the
 * parser agree, rather than testing the parser against invented strings.
 *
 * There is no DOM test infrastructure in the renderer (see `panes-layout.test.ts`),
 * so this exercises the same tokenizer `Rich` uses.
 */
import { describe, it, expect } from 'vitest';

import { en, getCatalog, REGISTERED_LOCALES } from '@bibdesk/shared';

/** Mirrors the RUN regex in RichText.tsx. */
const RUN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

/** Split a string the way `Rich` does, returning only the marked-up runs. */
function runs(text: string): string[] {
  // A non-global copy: `RUN` is /g, and `.test()` on it would advance lastIndex
  // between calls and skip matches.
  const one = new RegExp(RUN.source);
  return text.split(RUN).filter((p) => one.test(p));
}

/** Strip every well-formed run, leaving the plain text around them. */
function plainRemainder(text: string): string {
  return text.replace(RUN, '');
}

const MARKUP_KEYS = Object.keys(en).filter(
  (k) => k.endsWith('Hint') || k.startsWith('fr.result'),
);

describe('Rich markup in the catalog', () => {
  it('covers the hint paragraphs and the find/replace summaries', () => {
    // Guards against this file quietly testing nothing if keys get renamed.
    expect(MARKUP_KEYS.length).toBeGreaterThan(15);
    expect(MARKUP_KEYS).toContain('prefs.citeKeyRecipeHint');
    expect(MARKUP_KEYS).toContain('fr.resultSummary');
  });

  it('leaves no stray markers once every well-formed run is removed', () => {
    const leaky: string[] = [];
    for (const key of MARKUP_KEYS) {
      const rest = plainRemainder(en[key]!);
      // A leftover backtick, or an asterisk that never paired, would render as
      // a literal character in the pane.
      if (rest.includes('`') || rest.includes('*')) leaky.push(key);
    }
    expect(leaky).toEqual([]);
  });

  it('keeps the format mini-languages in code runs', () => {
    // These hints exist to document BibDesk format codes and Handlebars tokens.
    // Flattening their markup away (the state MED-7 found them in) is the
    // regression worth catching: the codes become indistinguishable from prose.
    const mustHaveCode = [
      'prefs.citeKeyFormatHint',
      'prefs.citeKeyRecipeHint',
      'prefs.autoFileHint',
      'prefs.exportTemplatesHint',
      'prefs.panelForksHint',
      'prefs.citeCommandHint',
    ];
    for (const key of mustHaveCode) {
      const codeRuns = runs(en[key]!).filter((r) => r.startsWith('`'));
      expect(codeRuns.length, key).toBeGreaterThan(0);
    }
  });

  it('keeps every interpolation placeholder inside the find/replace sentences', () => {
    // A whole-sentence key is only safe if each translation still carries both
    // placeholders — dropping one silently loses a count (audit rpt-03 LOW-8).
    for (const key of ['fr.resultSummary', 'fr.resultPreview']) {
      expect(en[key], key).toContain('{total}');
      expect(en[key], key).toContain('{fields}');
    }
  });
});

/**
 * The same three invariants, over every non-English catalog. This is where they
 * actually bite: the 29 other locales are machine-seeded, so a bad translation is
 * the likely source of a stray marker or a mangled format code — and neither tsc
 * nor a rendering test would notice, because `t()` returns a plain string either
 * way and the damage only shows up as literal `**` in a pane nobody opens.
 */
describe('Rich markup across the seeded locales', () => {
  const OTHERS = REGISTERED_LOCALES.filter((c) => c !== 'en');

  /** The contents of a string's `code` runs, in order. */
  const codeRuns = (s: string): string[] =>
    (s.match(RUN) ?? []).filter((r) => r.startsWith('`')).map((r) => r.slice(1, -1));

  it('has catalogs to check', () => {
    // Guards the whole block against passing vacuously if the barrel export or
    // the locale registry changes shape.
    expect(OTHERS.length).toBe(29);
    expect(getCatalog('de')?.['prefs.autoFileHint']).toBeTypeOf('string');
  });

  it('leaves no stray markers in any locale', () => {
    const leaky: string[] = [];
    for (const loc of OTHERS) {
      const cat = getCatalog(loc);
      for (const key of MARKUP_KEYS) {
        const v = cat?.[key];
        if (v === undefined) continue; // absent ⇒ falls back to en, which is fine
        const rest = v.replace(RUN, '');
        if (rest.includes('`') || rest.includes('*')) leaky.push(`${loc}/${key}`);
      }
    }
    expect(leaky).toEqual([]);
  });

  it('preserves every code run verbatim — format codes must not be translated', () => {
    // `%p1/%T5`, `{{#each entries}}`, `Bdsk-Annotation` and friends are literal
    // tokens the user types or the parser reads. A translator "helpfully"
    // localizing one inside its backticks is the failure this catches.
    const mangled: string[] = [];
    for (const loc of OTHERS) {
      const cat = getCatalog(loc);
      for (const key of MARKUP_KEYS) {
        const v = cat?.[key];
        if (v === undefined) continue;
        const want = codeRuns(en[key]!).join(' ');
        const got = codeRuns(v).join(' ');
        if (want !== got) mangled.push(`${loc}/${key}: expected [${want}] got [${got}]`);
      }
    }
    expect(mangled).toEqual([]);
  });

  it('keeps {count} in the attachment-chip forms', () => {
    // Two-form plurals are a known simplification for languages with richer
    // rules (Slavic, Arabic); losing the number entirely is the real bug.
    const broken: string[] = [];
    for (const loc of OTHERS) {
      const cat = getCatalog(loc);
      for (const key of ['detail.fileChip', 'detail.fileChipPlural']) {
        const v = cat?.[key];
        if (v !== undefined && !v.includes('{count}')) broken.push(`${loc}/${key}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
