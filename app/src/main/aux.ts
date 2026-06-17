/**
 * Parse the cite keys referenced by a LaTeX `.aux` file — the basis for
 * BibDesk's "Select Publications from .aux File". Handles the three forms a
 * `.aux` (or biblatex `.aux`) carries citations in:
 *
 *   - `\citation{key}` / `\citation{key1,key2}`  (BibTeX / natbib; `\nocite{*}`
 *     writes `\citation{*}`, which we skip)
 *   - `\bibcite{key}{label}`                      (written back by BibTeX)
 *   - `\abx@aux@cite{key}` / `\abx@aux@cite{0}{key}`  (biblatex; the key is the
 *     last brace group)
 *
 * Keys are returned in first-seen order, de-duplicated. Pure + dependency-free.
 */
export function parseAuxCiteKeys(text: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string): void => {
    const k = raw.trim();
    if (!k || k === '*' || seen.has(k)) return;
    seen.add(k);
    keys.push(k);
  };

  // \citation{a,b,c}
  for (const m of text.matchAll(/\\citation\s*\{([^}]*)\}/g)) {
    for (const part of m[1]!.split(',')) add(part);
  }
  // \bibcite{key}{label} — first brace is the key
  for (const m of text.matchAll(/\\bibcite\s*\{([^}]*)\}/g)) add(m[1]!);
  // biblatex: \abx@aux@cite{key} or \abx@aux@cite{0}{key} — the LAST brace is the key
  for (const m of text.matchAll(/\\abx@aux@cite\s*\{([^}]*)\}(?:\s*\{([^}]*)\})?/g)) {
    add(m[2] ?? m[1]!);
  }
  return keys;
}
