/**
 * De-TeXification entry point for the names package.
 *
 * `@bibdesk/tex` is a sibling workspace package that is already built and tested;
 * it owns the authoritative TeX <-> Unicode codec (a port of BibDesk's
 * `BDSKConverter` / `CharacterConversion.plist`). We import its `detexify`
 * directly and re-export it under a stable local name so the rest of the package
 * (sortable / fuzzy / display variants and accented initials) has a single
 * choke-point for de-TeXification.
 *
 * Behavioural notes confirmed against the real `@bibdesk/tex` at integration:
 *   - `detexify("{\\'E}variste Galois")` -> "Évariste Galois"  (accent spans `{\...}` decoded)
 *   - `detexify("{Getty}")`             -> "{Getty}"           (plain brace groups are NOT stripped)
 *   - `detexify("Vall\\'ee")`           -> "Vall\\'ee"         (un-braced accents are left as-is)
 * Because plain `{...}` groups survive de-TeXification, callers that need braces
 * removed (e.g. `sortableName`) strip them separately, exactly as BibDesk does.
 */
import { detexify as texDetexify } from '@bibdesk/tex';

/**
 * De-TeXify a string (TeX/LaTeX source -> Unicode) via `@bibdesk/tex`.
 *
 * Used for the de-TeXified / sortable / fuzzy display variants and for deriving
 * initials from accented first names (so `{\'E}variste` abbreviates to `É.`).
 */
export function detexify(s: string): string {
  return texDetexify(s);
}

/**
 * True iff the authoritative `@bibdesk/tex` `detexify` is wired up. It always is
 * in this build (tex is a hard dependency); the flag is retained as a public
 * integration signal and to make the dependency explicit to consumers/tests.
 */
export const usingRealDetexify: boolean = typeof texDetexify === 'function';
