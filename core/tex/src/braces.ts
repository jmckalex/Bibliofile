/**
 * Brace-balancing for the BibTeX serializer.
 *
 * A BibTeX brace-delimited value `{…}` must have balanced braces: the reader
 * (`core/bibtex` value-parser + block scanner) counts raw `{`/`}` and is NOT
 * escape-aware (this matches BibTeX/btparse, where `\{` and `\}` also count
 * toward brace depth). So a stored value whose RAW brace count is unbalanced —
 * e.g. a lone `{` a user typed into a title, or content from a malformed import
 * — cannot be emitted verbatim inside `{…}`: it re-parses to a *different* value
 * (a fabricated `macro` node, a swallowed following field, or a dropped char).
 *
 * {@link balanceBraces} rewrites each UNMATCHED brace to a balanced LaTeX control
 * word (`{` → `{\textbraceleft}`, `}` → `{\textbraceright}`) so the emitted value
 * is valid, brace-balanced BibTeX that re-parses to the same string. `detexify`
 * maps those control words back to `{`/`}`, so the DISPLAYED value is unchanged.
 *
 * It counts raw braces exactly as the reader does (NOT escape-aware), so it is a
 * strict no-op for every brace-balanced value — including well-formed TeX like
 * `{\"o}` (a balanced group) — and only ever transforms values that are already
 * broken for the reader. The transform is idempotent: its output is balanced, so
 * a second pass changes nothing.
 */

/** Rewrite unmatched `{`/`}` to balanced LaTeX control words. No-op if balanced. */
export function balanceBraces(s: string): string {
  // Fast path: scan once; if every `}` has a prior `{` and no `{` is left open,
  // the value is balanced and is emitted verbatim (the overwhelmingly common case).
  let depth = 0;
  let balanced = true;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') {
      if (depth === 0) {
        balanced = false;
        break;
      }
      depth--;
    }
  }
  if (balanced && depth === 0) return s;

  // Slow path: identify the unmatched braces (a stack of open-brace indices;
  // whatever remains unpopped is an unmatched `{`, and any `}` with an empty stack
  // is an unmatched `}`), then rewrite only those.
  const openStack: number[] = [];
  const stray = new Set<number>();
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') openStack.push(i);
    else if (s[i] === '}') {
      if (openStack.length > 0) openStack.pop();
      else stray.add(i);
    }
  }
  for (const i of openStack) stray.add(i);

  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (stray.has(i)) out += s[i] === '{' ? '{\\textbraceleft}' : '{\\textbraceright}';
    else out += s[i];
  }
  return out;
}
