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
import { parseCite, type ParsedCite } from './cite-command.js';

/** Format one CSL-JSON item as an HTML bibliography entry in the given style. */
export function formatCitation(cslItem: Record<string, unknown>, styleId: string): string {
  return new Cite([cslItem]).format('bibliography', {
    format: 'html',
    template: styleId || 'apa',
    lang: 'en-US',
  }) as string;
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
  return `<span class="bd-cite bd-cite--missing" title="No entry for this cite key">?${escapeHtml(key)}</span>`;
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
  const firstKey = escapeHtml(cmd.keys.find((k) => resolve(k)) ?? cmd.keys[0] ?? '');
  const wrap = (inner: string, cls = 'bd-cite'): string =>
    `<span class="${cls}" data-cite="${firstKey}">${inner}</span>${tail ? ` ${tail}` : ''}`;

  if (cmd.kind === 'full') {
    const html = new Cite(items).format('bibliography', { format: 'html', template, lang: 'en-US' }) as string;
    return wrap(html, 'bd-cite bd-cite--full');
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
export function renderCite(raw: string, resolve: CiteResolver, styleId: string): string {
  const cmd = parseCite(raw);
  return cmd ? formatInlineCitation(cmd, resolve, styleId) : escapeHtml(raw);
}
