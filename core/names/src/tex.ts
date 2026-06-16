/**
 * Adapter around `@bibdesk/tex`'s `detexify`.
 *
 * The orchestrator guarantees `@bibdesk/tex` will export
 * `detexify(s: string): string`. While `core/tex` is being built in parallel it
 * may still be a stub, so we resolve the export defensively via a namespace
 * import and fall back to a conservative local de-TeXifier. When the real
 * `detexify` lands it is picked up automatically (no code change needed here).
 *
 * The local fallback only needs to be good enough for the de-TeXified / sortable
 * / fuzzy display variants and for computing initials from accented names: it
 * unwraps brace groups, turns the common accent control sequences into their
 * base letter, and strips remaining TeX markup. It is intentionally simple; the
 * real codec in `@bibdesk/tex` is the source of truth at integration time.
 */
import * as tex from '@bibdesk/tex';

const real = (tex as { detexify?: (s: string) => string }).detexify;

/** True when the real `@bibdesk/tex` `detexify` is wired up (vs. local fallback). */
export const usingRealDetexify: boolean = typeof real === 'function';

// Accent / special control sequences -> base character. Covers the cases the
// name logic exercises (accents over a following letter). Deliberately small.
const ACCENT_CMDS = new Set([
  '`',
  "'",
  '^',
  '"',
  '~',
  '=',
  '.',
  'u',
  'v',
  'H',
  't',
  'c',
  'd',
  'b',
  'r',
  'k',
]);

// Standalone special-letter control sequences -> replacement.
const SPECIAL_LETTERS: Record<string, string> = {
  ss: 'ss',
  ae: 'ae',
  AE: 'AE',
  oe: 'oe',
  OE: 'OE',
  aa: 'a',
  AA: 'A',
  o: 'o',
  O: 'O',
  l: 'l',
  L: 'L',
  i: 'i',
  j: 'j',
};

function localDetexify(input: string): string {
  let s = input;
  let prev: string;
  // Iterate to a fixed point so nested groups collapse.
  do {
    prev = s;
    // \`{o}, \'{e}, \"{o}, \^{a}, \~{n}, \c{c} ... -> base letter
    s = s.replace(/\\([`'^"~=.]|[a-zA-Z])\{\s*([a-zA-Z]?)\s*\}/g, (m, cmd, letter) => {
      if (ACCENT_CMDS.has(cmd)) return letter;
      const special = SPECIAL_LETTERS[cmd as string];
      if (special !== undefined) return letter || special;
      return letter;
    });
    // \'e, \`o, \"o (no braces, accent immediately followed by a letter)
    s = s.replace(/\\([`'^"~=.])\s*([a-zA-Z])/g, (_m, _cmd, letter) => letter);
    // \v s, \u o, \c c (multi-letter accent command + space + letter)
    s = s.replace(/\\([a-zA-Z])\s+([a-zA-Z])/g, (m, cmd, letter) => {
      if (ACCENT_CMDS.has(cmd)) return letter;
      const special = SPECIAL_LETTERS[cmd as string];
      if (special !== undefined) return `${special} ${letter}`;
      return m;
    });
    // standalone special letters: \ss, \ae, \o, \l ... (word boundary)
    s = s.replace(/\\([a-zA-Z]+)/g, (m, cmd) => {
      const special = SPECIAL_LETTERS[cmd as string];
      return special !== undefined ? special : m;
    });
  } while (s !== prev);
  // strip braces and leftover backslashes
  s = s.replace(/[{}]/g, '').replace(/\\/g, '');
  return s;
}

/**
 * De-TeXify a string. Delegates to `@bibdesk/tex`'s `detexify` when available,
 * otherwise uses the local fallback.
 */
export function detexify(s: string): string {
  return real ? real(s) : localDetexify(s);
}
