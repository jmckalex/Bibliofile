/**
 * Renders a short string that may contain TeX math (e.g. a publication title)
 * with `$…$` typeset via MathJax. Results are cached per string in a module-level
 * map, so the virtualized table can re-mount cells on scroll without re-typesetting
 * — and titles with no math take a synchronous plain-text fast path.
 */

import { useEffect, useState } from 'react';

import { hasMath, renderMathToHtml } from './mathjax.js';

/** text → rendered HTML (inline SVG). Shared across all MathText instances. */
const cache = new Map<string, string>();

export function MathText({ text }: { text: string }) {
  const [html, setHtml] = useState<string | undefined>(() => cache.get(text));

  useEffect(() => {
    if (!hasMath(text)) return;
    const cached = cache.get(text);
    if (cached !== undefined) {
      setHtml(cached);
      return;
    }
    let cancelled = false;
    void renderMathToHtml(text).then((rendered) => {
      if (rendered == null) return;
      cache.set(text, rendered);
      if (!cancelled) setHtml(rendered);
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!hasMath(text)) return <>{text}</>;
  if (html !== undefined) return <span className="bd-math" dangerouslySetInnerHTML={{ __html: html }} />;
  return <>{text}</>; // raw TeX until typeset (re-renders once the cache fills)
}
