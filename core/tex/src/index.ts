/**
 * @bibdesk/tex
 *
 * TeXify / deTeXify codec: a platform-agnostic TypeScript port of BibDesk's
 * `BDSKConverter` (`CharacterConversion.plist` dictionary + NFC/NFD accent algorithm),
 * plus a conservative LaTeX reserved-character escaping layer.
 *
 * Public entry points are {@link detexify} (TeX/LaTeX -> Unicode) and {@link texify}
 * (Unicode -> TeX/LaTeX). `core/names` imports `detexify`.
 *
 * Round-trip contract:
 *   - `texify(detexify(x))` is stable for canonical TeX produced by `texify`.
 *   - `detexify(texify(u))` returns the original Unicode for representable characters.
 *   - The "One-Way Conversions" table (ligatures, smart quotes, en/em dashes, °, ±, …)
 *     is intentionally lossy: it only applies on `texify`, and is NOT reversed on
 *     `detexify` (e.g. `–` -> `--`, but `--` stays `--`). See ONE_WAY_CONVERSIONS.
 */

import {
  texify as texifyCore,
  detexify as detexifyCore,
} from './converter.js';
import { escapeTexReserved, unescapeTexReserved } from './specialChars.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert TeX/LaTeX source to Unicode.
 *
 * Runs BibDesk's core deTeXification (dictionary + accent algorithm over `{\...}` spans)
 * and then de-escapes LaTeX reserved characters (`\&`->&, `\%`->%, `\$`->$, `\#`->#, `\_`->_).
 *
 * Examples: `{\'e}` -> `é`, `{\v S}` -> `Š`, `{\i}` -> `ı`, `\&` -> `&`.
 */
export function detexify(input: string): string {
  return unescapeTexReserved(detexifyCore(input));
}

/**
 * Convert Unicode to TeX/LaTeX source (inverse of {@link detexify} for representable chars).
 *
 * Escapes LaTeX reserved characters outside math (`&`->\&, `%`->\%, `#`->\#, `_`->\_; `$`
 * is left as-is to preserve `$...$` math), then runs BibDesk's core TeXification
 * (one-way + Roman-to-TeX dictionary + accent algorithm).
 *
 * Examples: `é` -> `{\'e}`, `Š` -> `{\v S}`, `ı` -> `{\i}`, `&` -> `\&`.
 */
export function texify(input: string): string {
  return texifyCore(escapeTexReserved(input));
}

// ---------------------------------------------------------------------------
// Lower-level building blocks (for consumers that need exact BibDesk fidelity
// without the reserved-character layer, or want to compose differently).
// ---------------------------------------------------------------------------

export {
  // Plist-faithful core (no reserved-char escaping): exact BDSKConverter behavior.
  texify as texifyCore,
  detexify as detexifyCore,
  // Single-character / single-span accent helpers.
  texifyChar,
  detexifyAccentSpan,
  // Derived dictionaries / accent maps (read-only).
  TEXIFY_DICTIONARY,
  DETEXIFY_DICTIONARY,
  TEXIFY_ACCENTS,
  DETEXIFY_ACCENTS,
} from './converter.js';

export {
  escapeTexReserved,
  unescapeTexReserved,
  TEX_RESERVED_ESCAPES,
} from './specialChars.js';

// Raw plist-section tables, verbatim from CharacterConversion.plist.
export {
  ONE_WAY_CONVERSIONS,
  ROMAN_TO_TEX,
  TEX_TO_ROMAN,
  ROMAN_TO_TEX_ACCENTS,
  TEX_TO_ROMAN_ACCENTS,
} from './data/conversionTable.js';
