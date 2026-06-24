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
import { CITE_PATTERN_ANCHORED, CITE_START_RE } from './cite-command.js';

// Math spans protected from Markdown before parsing: `$$…$$` / `$…$`, plus the
// LaTeX `\[…\]` (display) and `\(…\)` (inline) delimiters — otherwise `marked`
// treats `\[` as an escaped bracket and the math never reaches MathJax.
//
// Inline `$…$` may span **soft** line breaks (so a long expression can wrap
// across source lines) but not a blank line: `\n(?![ \t]*\n)` lets a single
// newline through while stopping at a paragraph break, which caps a stray/
// currency `$` from running away across paragraphs (the reason the inline form
// was originally one-line-only). Display `$$…$$` / `\[…\]` / `\(…\)` already span.
const MATH_RE =
  /\$\$[\s\S]+?\$\$|\$(?:[^$\n]|\n(?![ \t]*\n))+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/g;

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

// --- inline \cite{…} commands (a marked extension) --------------------------
//
// A marked INLINE extension that fires on the natbib `\cite…{…}` family and
// renders each command to a formatted citation via the per-render `citeRenderer`
// (set by renderNotes from the document's CSL resolver). The trusted citeproc
// HTML is deferred behind an `@@XCITE@@` placeholder and restored AFTER sanitise
// (citeproc output is library-derived, not user markup). The extension is inert
// for abstracts / when no resolver is set, so `\cite{…}` then stays literal text.
let citeRenderer: ((rawCommand: string) => string) | null = null;
const citeStore: string[] = [];

marked.use({
  extensions: [
    {
      name: 'cite',
      level: 'inline',
      start(src: string): number | undefined {
        if (!citeRenderer) return undefined;
        const m = CITE_START_RE.exec(src);
        return m ? m.index : undefined;
      },
      tokenizer(src: string) {
        if (!citeRenderer) return undefined;
        const m = CITE_PATTERN_ANCHORED.exec(src);
        if (!m) return undefined;
        return { type: 'cite', raw: m[0] };
      },
      renderer(token): string {
        const raw = (token as { raw: string }).raw;
        citeStore.push(citeRenderer ? citeRenderer(raw) : raw);
        return `@@XCITE${citeStore.length - 1}@@`;
      },
    },
  ],
});

/** Protect math, run Markdown, sanitise with `opts`, then restore math + cite text. */
function renderWith(md: string, opts: sanitizeHtml.IOptions): string {
  citeStore.length = 0;
  const math: string[] = [];
  const protectedMd = md.replace(MATH_RE, (m) => {
    math.push(m);
    return `@@MATH${math.length - 1}@@`;
  });
  const rawHtml = marked.parse(protectedMd, { async: false }) as string;
  const clean = sanitizeHtml(rawHtml, opts);
  return clean
    .replace(/@@MATH(\d+)@@/g, (_m, i) => math[Number(i)] ?? '')
    .replace(/@@XCITE(\d+)@@/g, (_m, i) => citeStore[Number(i)] ?? '');
}

/** Render abstract-style Markdown (strict tag set) to sanitised HTML. */
export function renderMarkdown(md: string): string {
  return md.trim() ? renderWith(md, STRICT_OPTS) : '';
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * Render NOTES markdown: supports inlined `<iframe>` embeds, `[[citeKey]]`
 * cross-references → internal links (`<a class="bd-citelink" data-cite="…">`,
 * styled `--missing` when the key isn't in the document), and — when a
 * `renderCite` formatter is supplied — natbib `\cite{…}` commands rendered to
 * formatted citations (see the marked extension above). Wiki-links are protected
 * before Markdown parsing and restored afterwards.
 */
export function renderNotes(
  md: string,
  citeKeyExists: (key: string) => boolean,
  renderCite?: (rawCommand: string) => string,
): string {
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
  citeRenderer = renderCite ?? null;
  try {
    return renderWith(pre, NOTES_OPTS).replace(/@@CITE(\d+)@@/g, (_m, i) => links[Number(i)] ?? '');
  } finally {
    citeRenderer = null;
  }
}
