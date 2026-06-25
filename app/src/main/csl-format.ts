/**
 * citeproc (citation-js) formatting — the **electron-free** half of the CSL
 * support, so it can be unit-tested headless and imported by `document-service`
 * (which renders annotations). The electron-coupled user-style management
 * (loading `.csl` files from userData) stays in `csl.ts`; both share the one
 * citation-js template registry, so user styles registered there are visible
 * here too.
 *
 * Provides: full bibliography entries (`formatCitation`) and inline LaTeX/natbib
 * `\cite{…}` commands in annotations (`renderCite`).
 */

import { Cite } from '@citation-js/core';
import '@citation-js/plugin-csl';
import Autolinker from 'autolinker';
import { parseCite, type ParsedCite } from './cite-command.js';

// --- optional URL/DOI autolinking -------------------------------------------
// When enabled (Preferences → Citations), citeproc's HTML output is run through
// Autolinker so bare URLs (and DOIs rendered as https://doi.org/… URLs) become
// clickable links. We emit the app's link form — `<a class="bd-mdlink"
// data-open-url=…>` (no href) — so the existing delegated click handler opens
// them externally, matching how Markdown links in notes behave. Autolinker skips
// text inside existing tags/anchors, so running it over citeproc HTML is safe.
const autolinker = new Autolinker({
  urls: { schemeMatches: true, tldMatches: false, ipV4Matches: false },
  email: false,
  phone: false,
  hashtag: false,
  mention: false,
  stripPrefix: false,
  stripTrailingSlash: false,
  replaceFn: (match) => {
    const href = match.getAnchorHref();
    return `<a class="bd-mdlink" data-open-url="${escapeHtml(href)}" title="${escapeHtml(href)}">${escapeHtml(
      match.getAnchorText(),
    )}</a>`;
  },
});

/** Turn URLs/DOIs in trusted citeproc HTML into clickable `data-open-url` links. */
export function autolinkCitationHtml(html: string): string {
  return autolinker.link(html);
}

/** Format one CSL-JSON item as an HTML bibliography entry in the given style.
 *  With `autolink`, URLs/DOIs in the output become clickable links. */
export function formatCitation(
  cslItem: Record<string, unknown>,
  styleId: string,
  autolink = false,
): string {
  const html = new Cite([cslItem]).format('bibliography', {
    format: 'html',
    template: styleId || 'apa',
    lang: 'en-US',
  }) as string;
  return autolink ? autolinkCitationHtml(html) : html;
}

// --- inline \cite{…} commands (annotations) ---------------------------------

/** Resolve a cite key to its CSL-JSON item, or null when it isn't in the library. */
export type CiteResolver = (key: string) => Record<string, unknown> | null;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Surname list for `\citeauthor`: "Jones et al." (>2), "Jones and Baker" (2),
 *  "Jones" (1); `*` forces the full list "Jones, Baker, and Williams". */
function authorNames(item: Record<string, unknown>, all: boolean): string {
  const people = ((item.author ?? item.editor) as Array<Record<string, string>> | undefined) ?? [];
  const names = people.map((p) => p.family || p.literal || p.given || '').filter(Boolean);
  if (names.length === 0) return '';
  if (!all && names.length > 2) return `${names[0]} et al.`;
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** Insert pre/post notes into a parenthetical citation `(Author, Year)`. */
function withParenNotes(paren: string, pre: string, post: string): string {
  if (!pre && !post) return paren;
  const open = paren.slice(0, 1);
  const close = paren.slice(-1);
  const inner = paren.slice(1, -1);
  return open + (pre ? `${pre} ` : '') + inner + (post ? `, ${post}` : '') + close;
}

/** Turn a parenthetical `(Author, Year)` into a textual `Author (Year)` (per key
 *  when several), applying pre/post notes natbib-style. Falls back to the
 *  parenthetical form for styles with no year to hoist (e.g. numeric). */
function toTextual(paren: string, pre: string, post: string): string {
  const inner = paren.replace(/^\(|\)$/g, '');
  if (!/\d{4}/.test(inner)) return withParenNotes(paren, pre, post); // numeric/other → leave as-is
  const parts = inner.split(';').map((part) => {
    const m = part.trim().match(/^(.*?)[,]?\s*((?:\d{4}[a-z]?)(?:[,;]\s*\d{4}[a-z]?)*)\s*$/);
    if (!m) return part.trim();
    return `${m[1]!.trim()} (${m[2]!.trim()})`;
  });
  let s = parts.join('; ');
  if (post) s = s.replace(/\)\s*$/, `, ${post})`); // postnote inside the last parens
  if (pre) s = `${pre} ${s}`; // prenote leads
  return s;
}

/** A muted marker for a cite key that isn't in the library. */
function missingMarker(key: string): string {
  return `<span class="bd-icite bd-icite--missing" title="No entry for this cite key">?${escapeHtml(key)}</span>`;
}

/**
 * Render a parsed inline citation command to trusted HTML, dispatching by kind:
 * textual / parenthetical / author-only / full reference / nocite (nothing).
 * Unknown keys render as a muted `?key` marker; the rest is wrapped in a
 * `data-cite` span so it stays clickable (jump to the first resolved entry).
 */
export function formatInlineCitation(cmd: ParsedCite, resolve: CiteResolver, styleId: string): string {
  if (cmd.kind === 'nocite') return '';

  const items: Record<string, unknown>[] = [];
  const missing: string[] = [];
  for (const key of cmd.keys) {
    const item = resolve(key);
    if (item) items.push(item);
    else missing.push(key);
  }

  const tail = missing.map(missingMarker).join(' ');
  if (items.length === 0) return tail || missingMarker(cmd.keyString);

  const template = styleId || 'apa';
  // Carry ALL resolved keys on data-cite so a multi-entry citation selects them
  // all on click (the renderer's handler splits on commas).
  const dataCite = escapeHtml(cmd.keys.filter((k) => resolve(k)).join(',') || cmd.keys[0] || '');
  const wrap = (inner: string): string =>
    `<span class="bd-icite" data-cite="${dataCite}">${inner}</span>${tail ? ` ${tail}` : ''}`;

  if (cmd.kind === 'full') {
    // citeproc wraps each reference in a block `<div class="csl-entry">`; pull the
    // inner HTML so the full reference flows INLINE (a block <div> inside our
    // inline <span> would otherwise be split out onto its own line by the browser).
    const html = new Cite(items).format('bibliography', { format: 'html', template, lang: 'en-US' }) as string;
    const entries = [...html.matchAll(/<div[^>]*class="csl-entry"[^>]*>([\s\S]*?)<\/div>/gi)].map(
      (m) => m[1]!.trim(),
    );
    return wrap(entries.length ? entries.join('; ') : html.replace(/<\/?div[^>]*>/gi, '').trim());
  }

  if (cmd.kind === 'author') {
    const names = items.map((it) => authorNames(it, cmd.allAuthors)).filter(Boolean).join('; ');
    const body = (cmd.prenote ? `${cmd.prenote} ` : '') + names + (cmd.postnote ? `, ${cmd.postnote}` : '');
    return wrap(escapeHtml(body));
  }

  const paren = new Cite(items).format('citation', { template, lang: 'en-US' }) as string;
  const body =
    cmd.kind === 'parenthetical'
      ? withParenNotes(paren, cmd.prenote, cmd.postnote)
      : toTextual(paren, cmd.prenote, cmd.postnote);
  return wrap(escapeHtml(body));
}

/**
 * Parse + render one `\cite…{…}` command string to HTML. Returns the escaped raw
 * text if it doesn't parse as a citation (shouldn't happen — the marked
 * tokenizer only hands us matches). This is the entry point the renderer injects.
 */
export function renderCite(
  raw: string,
  resolve: CiteResolver,
  styleId: string,
  autolink = false,
): string {
  const cmd = parseCite(raw);
  const html = cmd ? formatInlineCitation(cmd, resolve, styleId) : escapeHtml(raw);
  return autolink ? autolinkCitationHtml(html) : html;
}

/**
 * Render a formatted bibliography (HTML, citeproc's `csl-bib-body`) for the given
 * cite keys in the chosen style — the `@references` block in an annotation. Keys
 * are de-duplicated (preserving first appearance; citeproc orders per the style);
 * unknown keys are skipped. Returns '' when nothing resolves.
 */
export function renderBibliography(
  keys: readonly string[],
  resolve: CiteResolver,
  styleId: string,
  autolink = false,
): string {
  const seen = new Set<string>();
  const items: Record<string, unknown>[] = [];
  for (const key of keys) {
    const lc = key.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    const item = resolve(key);
    if (item) items.push(item);
  }
  if (items.length === 0) return '';
  const html = new Cite(items).format('bibliography', {
    format: 'html',
    template: styleId || 'apa',
    lang: 'en-US',
  }) as string;
  return `<div class="bd-references">${autolink ? autolinkCitationHtml(html) : html}</div>`;
}
