/**
 * Markdown rendering for abstracts and notes. Runs in MAIN (where the preview
 * HTML is composed). Math-aware: `$…$` / `$$…$$` spans are protected before
 * Markdown parsing (so `_`/`*` inside math aren't treated as emphasis) and
 * restored afterwards as literal text for the renderer's MathJax pass. Output is
 * sanitised; links become `data-open-url` spans the preview opens externally.
 */

import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const MATH_RE = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g;

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'em', 'strong', 'b', 'i', 'code', 'pre', 'ul', 'ol', 'li',
    'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'sup', 'sub', 'hr',
    'del', 'span',
  ],
  allowedAttributes: { a: ['class', 'data-open-url', 'data-cite', 'title'], span: ['class'] },
  // Markdown links: drop href (no in-window navigation) and carry the target on
  // data-open-url so the preview's click delegation opens it externally.
  transformTags: {
    a: (_tagName, attribs) => ({
      tagName: 'a',
      attribs: { class: 'bd-mdlink', 'data-open-url': attribs.href ?? '', title: attribs.href ?? '' },
    }),
  },
};

/**
 * Render Markdown (with protected math) to sanitised HTML. Returns '' for empty
 * input. `linkResolver`, when given, rewrites a raw `<a>` href before sanitising
 * (used by notes to turn `[[citeKey]]` wiki-links into internal entry links).
 */
export function renderMarkdown(md: string): string {
  if (!md.trim()) return '';
  const math: string[] = [];
  const protectedMd = md.replace(MATH_RE, (m) => {
    math.push(m);
    return `@@MATH${math.length - 1}@@`;
  });
  const rawHtml = marked.parse(protectedMd, { async: false }) as string;
  let clean = sanitizeHtml(rawHtml, SANITIZE_OPTS);
  clean = clean.replace(/@@MATH(\d+)@@/g, (_m, i) => math[Number(i)] ?? '');
  return clean;
}
