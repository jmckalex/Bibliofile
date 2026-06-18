/**
 * Markdown rendering for abstracts and notes. Runs in MAIN (where the preview
 * HTML is composed). Math-aware: `$…$` / `$$…$$` and LaTeX `\(…\)` / `\[…\]` spans
 * are protected before Markdown parsing (so `_`/`*` inside math aren't treated as
 * emphasis, and `\[` isn't eaten as an escaped bracket) and restored afterwards as
 * literal text for the renderer's MathJax pass. Output is
 * sanitised; markdown links become `data-open-url` spans the preview opens
 * externally.
 *
 * Abstracts use the strict tag set. NOTES additionally allow inlined `<iframe>`
 * (restricted to http/https) for embeds — a capability the user opted into.
 */

import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// Math spans protected from Markdown before parsing: `$$…$$` / `$…$`, plus the
// LaTeX `\[…\]` (display) and `\(…\)` (inline) delimiters — otherwise `marked`
// treats `\[` as an escaped bracket and the math never reaches MathJax.
const MATH_RE = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/g;

const BASE_TAGS = [
  'p', 'br', 'em', 'strong', 'b', 'i', 'code', 'pre', 'ul', 'ol', 'li',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'sup', 'sub', 'hr',
  'del', 'span',
];

// Markdown links: drop href (no in-window navigation) and carry the target on
// data-open-url so the preview's click delegation opens it externally.
const LINK_TRANSFORM: sanitizeHtml.IOptions['transformTags'] = {
  a: (_tagName, attribs) => ({
    tagName: 'a',
    attribs: { class: 'bd-mdlink', 'data-open-url': attribs.href ?? '', title: attribs.href ?? '' },
  }),
};

const STRICT_OPTS: sanitizeHtml.IOptions = {
  allowedTags: BASE_TAGS,
  allowedAttributes: { a: ['class', 'data-open-url', 'data-cite', 'title'], span: ['class'] },
  transformTags: LINK_TRANSFORM,
};

/** Notes: strict set + inlined <iframe> embeds (http/https only). */
const NOTES_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [...BASE_TAGS, 'iframe'],
  allowedAttributes: {
    a: ['class', 'data-open-url', 'data-cite', 'title'],
    span: ['class'],
    iframe: ['src', 'width', 'height', 'frameborder', 'allow', 'allowfullscreen', 'loading', 'title', 'sandbox'],
  },
  allowedSchemesByTag: { iframe: ['http', 'https'] },
  allowIframeRelativeUrls: false,
  transformTags: LINK_TRANSFORM,
};

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Protect math, run Markdown, sanitise with `opts`, then restore math text. */
function renderWith(md: string, opts: sanitizeHtml.IOptions): string {
  const math: string[] = [];
  const protectedMd = md.replace(MATH_RE, (m) => {
    math.push(m);
    return `@@MATH${math.length - 1}@@`;
  });
  const rawHtml = marked.parse(protectedMd, { async: false }) as string;
  const clean = sanitizeHtml(rawHtml, opts);
  return clean.replace(/@@MATH(\d+)@@/g, (_m, i) => math[Number(i)] ?? '');
}

/** Render abstract-style Markdown (strict tag set) to sanitised HTML. */
export function renderMarkdown(md: string): string {
  return md.trim() ? renderWith(md, STRICT_OPTS) : '';
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * Render NOTES markdown: supports inlined `<iframe>` embeds plus `[[citeKey]]`
 * cross-references → internal links (`<a class="bd-citelink" data-cite="…">`),
 * styled `--missing` when the cite key isn't in the document. Wiki-links are
 * protected before Markdown parsing and restored afterwards.
 */
export function renderNotes(md: string, citeKeyExists: (key: string) => boolean): string {
  if (!md.trim()) return '';
  const links: string[] = [];
  const pre = md.replace(WIKILINK_RE, (_m, key: string) => {
    const k = key.trim();
    const missing = !citeKeyExists(k);
    links.push(
      `<a class="bd-citelink${missing ? ' bd-citelink--missing' : ''}" data-cite="${escapeAttr(k)}">${escapeAttr(k)}</a>`,
    );
    return `@@CITE${links.length - 1}@@`;
  });
  return renderWith(pre, NOTES_OPTS).replace(/@@CITE(\d+)@@/g, (_m, i) => links[Number(i)] ?? '');
}
