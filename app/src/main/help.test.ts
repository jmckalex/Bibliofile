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
    // the scripting chapter is present and its JS code blocks are highlighted
    expect(html).toMatch(/id="\d\d-scripting"/);
    expect(html).toContain('class="hljs language-javascript"');
    expect(html).toContain('hljs-keyword'); // token spans survived sanitize
  });
});
