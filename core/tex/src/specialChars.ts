// LaTeX reserved-character escaping (`\&` `\%` `\$` `\#` `\_`).
//
// NOTE ON PROVENANCE: these escapes are NOT part of BibDesk's CharacterConversion.plist
// nor of `BDSKConverter`'s core accent algorithm. In the original app this kind of escaping
// lives in the HTML->TeX path (`NSString_BDSKExtensions.m`, e.g. `case '&': "\\&"`). It is
// included here because the codec's consumers (`core/bibtex`, display) need round-trippable
// handling of these characters, and BibTeX field values routinely contain `\&` for `&`, etc.
//
// We deliberately keep this conservative and reversible:
//   detexify: "\&" -> "&", "\%" -> "%", "\$" -> "$", "\#" -> "#", "\_" -> "_"
//   texify:   "&" -> "\&", "%" -> "\%", "#" -> "\#", "_" -> "\_"   ($ is left alone — see below)
//
// `$` is intentionally one-way (only de-escaped, never escaped on texify) because a bare `$`
// in Unicode text is overwhelmingly more likely to be a literal dollar that the user typed
// than a desire to enter math mode, and escaping it would corrupt existing `$...$` math spans
// on round-trip. We therefore only *remove* a `\$` escape on detexify.

/** The reserved chars that get a leading backslash, and their escaped TeX form. */
export const TEX_RESERVED_ESCAPES: Readonly<Record<string, string>> = {
  '&': '\\&',
  '%': '\\%',
  '#': '\\#',
  '_': '\\_',
  $: '\\$',
};

// Chars we escape on texify (everything above except `$`, see module note).
const ESCAPE_ON_TEXIFY = ['&', '%', '#', '_'] as const;

// Chars we de-escape on detexify (all of them, including `$`).
const DEESCAPE_ON_DETEXIFY = ['&', '%', '#', '$', '_'] as const;

/**
 * Replace literal reserved characters with their escaped TeX form, OUTSIDE of math spans.
 * `$...$` math is passed through untouched (its contents are TeX already). A trailing
 * unmatched `$` opens a math span that runs to end-of-string (so its tail is not escaped),
 * matching the lenient behavior callers expect for partial/auto-detected input.
 */
export function escapeTexReserved(input: string): string {
  if (input.length === 0) return input;

  let out = '';
  let inMath = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    // already-escaped sequence: copy the backslash + next char verbatim, don't double-escape.
    if (ch === '\\' && i + 1 < input.length) {
      out += ch + input[i + 1]!;
      i++;
      continue;
    }

    if (ch === '$') {
      // toggle math; `$` itself is left as-is (it is the delimiter).
      inMath = !inMath;
      out += ch;
      continue;
    }

    if (!inMath && (ESCAPE_ON_TEXIFY as readonly string[]).includes(ch)) {
      out += '\\' + ch;
      continue;
    }

    out += ch;
  }

  return out;
}

/**
 * Replace escaped reserved characters (`\&`, `\%`, `\$`, `\#`, `\_`) with their literal form.
 * Only touches a backslash immediately followed by one of the reserved chars; every other
 * backslash sequence (including TeX commands like `\alpha`) is preserved.
 */
export function unescapeTexReserved(input: string): string {
  if (input.indexOf('\\') === -1) return input;

  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === '\\' && i + 1 < input.length) {
      const next = input[i + 1]!;
      if ((DEESCAPE_ON_DETEXIFY as readonly string[]).includes(next)) {
        out += next;
        i++;
        continue;
      }
    }
    out += ch;
  }
  return out;
}
