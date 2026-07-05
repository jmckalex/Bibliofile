import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { contentSecurityPolicy } from './csp.js';

// The prod CSP is injected into the renderer HTML by a build-time Vite plugin
// (electron.vite.config.ts `cspMetaPlugin`), NOT by any runtime code — so the
// unit tests on the policy string can't catch the plugin silently ceasing to
// run (e.g. after an electron-vite upgrade changes the transformIndexHtml hook).
// This asserts the built artifact actually carries the meta. It runs only when a
// build is present (mirrors the repo's `it.runIf` gating for env-dependent tests);
// the `pnpm build:app && pnpm test` verify recipe always produces it first.
const builtHtml = fileURLToPath(new URL('../../out/renderer/index.html', import.meta.url));
const BUILT = existsSync(builtHtml);

describe('production CSP meta injection (built renderer)', () => {
  it.runIf(BUILT)('the built index.html carries the exact prod CSP <meta>, before the entry script', () => {
    const html = readFileSync(builtHtml, 'utf8');
    expect(html).toMatch(/<meta http-equiv="Content-Security-Policy"/);
    // the WHOLE current prod policy is present verbatim (single quotes survive
    // inside the double-quoted attribute, so a substring match is exact)
    expect(html).toContain(contentSecurityPolicy('prod'));
    // a <meta> CSP only governs what follows it — it must precede the script tag
    const metaIdx = html.indexOf('Content-Security-Policy');
    const scriptIdx = html.indexOf('<script');
    expect(metaIdx).toBeGreaterThanOrEqual(0);
    expect(scriptIdx).toBeGreaterThanOrEqual(0);
    expect(metaIdx).toBeLessThan(scriptIdx);
  });
});
