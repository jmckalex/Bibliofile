import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { findHelpDir, buildHelpHtml } from './help.js';

// app/src/main/help.test.ts -> ../../ = the app package dir (what app.getAppPath() returns)
const appDir = fileURLToPath(new URL('../../', import.meta.url));

describe('help manual', () => {
  it('locates the shipped docs/help directory', () => {
    expect(findHelpDir(appDir)).toBeDefined();
  });

  it('renders every chapter into one sanitized, navigable HTML page', () => {
    const dir = findHelpDir(appDir)!;
    const html = buildHelpHtml(dir);
    expect(html).toContain('<nav>');
    expect(html).toContain('Bibliofile Help');
    // chapters present as sections with anchor ids (numbering may grow as the
    // manual gains chapters, so match the reference chapter by name, not number)
    expect(html).toContain('id="00-index"');
    expect(html).toContain('id="01-getting-started"');
    expect(html).toMatch(/id="\d\d-shortcuts-and-reference"/);
    // markdown features rendered
    expect(html).toContain('<table>');
    expect(html).toContain('<h1');
    // relative image refs rewritten to file:// absolute urls
    expect(html).toMatch(/file:\/\/[^"']*viewer-[^"']+\.png/);
    // internal NN-chapter.md links became in-page anchors
    expect(html).toMatch(/href="#0\d-[a-z-]+"/);
    // sanitized: no scripts
    expect(html).not.toContain('<script');
    // carries a script-free CSP <meta> (the help window has no build-injected CSP)
    expect(html).toMatch(/http-equiv="Content-Security-Policy"/);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('img-src data: file: https:'); // the file:// screenshots load
    // the scripting chapter is present and its JS code blocks are highlighted
    expect(html).toMatch(/id="\d\d-scripting"/);
    expect(html).toContain('class="hljs language-javascript"');
    expect(html).toContain('hljs-keyword'); // token spans survived sanitize
  });

  // The manual is authored as 13 files that cross-link by `NN-chapter.md#anchor`
  // and `#anchor`, but ships as ONE page. marked emits no heading ids of its own
  // and the sanitizer drops attributes it isn't told to keep, so every one of
  // these links silently went nowhere until headings gained chapter-scoped ids.
  it('gives every heading an id that its cross-links actually resolve to', () => {
    const html = buildHelpHtml(findHelpDir(appDir)!);

    // Headings carry chapter-prefixed ids (and survived sanitization).
    expect(html).toMatch(/<h2 id="09-shortcuts-and-reference-[a-z0-9-]+"/);

    const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    const links = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);

    // Guards against a vacuous pass if the manual ever stops cross-linking.
    expect(links.length).toBeGreaterThan(300);
    expect(ids.size).toBeGreaterThan(300);

    const dead = [...new Set(links.filter((h) => !ids.has(h)))];
    expect(dead).toEqual([]);
  });
});
