/**
 * CSL user-style management (the **electron-coupled** half): loads, validates,
 * registers, and persists user-installed `.csl` files under `userData`, sharing
 * citation-js's one global template registry with the formatter in
 * `csl-format.ts`. The actual citeproc formatting (bibliography entries + inline
 * `\cite{…}` commands) lives in `csl-format.ts` so it stays electron-free and
 * testable; `formatCitation` is re-exported here for existing importers.
 *
 * NOTE: citation-js bundles citeproc-js, which is AGPL/CPAL — accepted by the
 * user as the single non-permissive dependency (see BUILD-LOG "Stage 7").
 */

import { Cite, plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';
import { app } from 'electron';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { CITATION_STYLES, type CitationStyle } from '@bibdesk/shared';

export { formatCitation } from './csl-format.js';

// --- user-installed CSL styles ---------------------------------------------

/** citation-js's CSL template registry (`.add(id, xml)` / `.has(id)`). */
interface TemplateRegister {
  add(id: string, xml: string): void;
  has(id: string): boolean;
}

function templates(): TemplateRegister {
  return (plugins.config.get('@csl') as { templates: TemplateRegister }).templates;
}

/** Directory where installed `.csl` files live (one file per style, `<id>.csl`). */
function userStylesDir(): string {
  return join(app.getPath('userData'), 'csl-styles');
}

/** In-memory id → human label for the installed styles (rebuilt from disk on load). */
const userStyles = new Map<string, string>();

/** Pull a display label from a CSL style's `<info><title>`, else fall back. */
function cslTitle(xml: string): string | undefined {
  const m = xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = m?.[1]?.trim().replace(/\s+/g, ' ');
  return title && title.length > 0 ? title : undefined;
}

/** A quick structural check that text is a CSL style document (not just any XML). */
function looksLikeCsl(xml: string): boolean {
  return /<style[\s>]/i.test(xml) && /purl\.org\/net\/xbiblio\/csl/i.test(xml);
}

/** Slugify into a safe, unique style id, prefixed so it can't clash with bundled ids. */
function styleIdFor(base: string): string {
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'style';
  let id = `user-${slug}`;
  let n = 2;
  while (userStyles.has(id) || CITATION_STYLES.some((s) => s.id === id)) id = `user-${slug}-${n++}`;
  return id;
}

/** Load + register every installed user CSL style. Call once at startup. */
export function loadUserStyles(): void {
  userStyles.clear();
  const dir = userStylesDir();
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (!file.toLowerCase().endsWith('.csl')) continue;
    try {
      const xml = readFileSync(join(dir, file), 'utf8');
      const id = file.slice(0, -4); // the filename stem is the style id
      templates().add(id, xml);
      userStyles.set(id, cslTitle(xml) ?? id);
    } catch {
      /* skip an unreadable / malformed file */
    }
  }
}

/** Bundled styles followed by the installed user styles (for the picker). */
export function listStyles(): CitationStyle[] {
  return [
    ...CITATION_STYLES.map((s) => ({ ...s })),
    ...[...userStyles].map(([id, label]) => ({ id, label, custom: true })),
  ];
}

/**
 * Validate, register, and persist a user-chosen `.csl` file. Returns the new
 * style. Throws (with a readable message) if the file isn't a usable CSL style.
 */
export function installCslFile(path: string): CitationStyle {
  const xml = readFileSync(path, 'utf8');
  if (!looksLikeCsl(xml)) throw new Error('Not a CSL style file');
  const label = cslTitle(xml) ?? basename(path).replace(/\.csl$/i, '');
  const id = styleIdFor(label);
  // Register, then trial-format a throwaway item to confirm citeproc accepts it.
  templates().add(id, xml);
  try {
    new Cite([{ type: 'article-journal', id: 'x', title: 'x' }]).format('bibliography', {
      format: 'text',
      template: id,
      lang: 'en-US',
    });
  } catch (e) {
    throw new Error(`Invalid CSL style: ${(e as Error).message}`);
  }
  mkdirSync(userStylesDir(), { recursive: true });
  writeFileSync(join(userStylesDir(), `${id}.csl`), xml);
  userStyles.set(id, label);
  return { id, label, custom: true };
}

/** Remove an installed user style (no-op for bundled ids). */
export function removeCslStyle(id: string): boolean {
  if (!userStyles.has(id)) return false;
  userStyles.delete(id);
  try {
    rmSync(join(userStylesDir(), `${id}.csl`));
  } catch {
    /* file already gone — fine */
  }
  return true; // the template stays registered in-memory until next launch (harmless)
}
