import { describe, it, expect } from 'vitest';
import { contentSecurityPolicy, secondaryWindowCsp } from './csp.js';

/** Parse a CSP string into a directive → sources map. */
function parse(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(';')) {
    const [name, ...src] = part.trim().split(/\s+/);
    if (name) out[name] = src;
  }
  return out;
}

describe('contentSecurityPolicy (prod)', () => {
  const prod = parse(contentSecurityPolicy('prod'));

  it('forbids inline script (neutralises injected onerror= handlers)', () => {
    expect(prod['script-src']).toBeDefined();
    expect(prod['script-src']).not.toContain("'unsafe-inline'");
    expect(prod['script-src']).not.toContain("'unsafe-eval'");
  });

  it('allows only local script sources — no remote origins', () => {
    for (const src of prod['script-src']!) {
      expect(src).not.toMatch(/^https?:/);
      // only 'self', file:, and the wasm keyword are permitted
      expect(["'self'", 'file:', "'wasm-unsafe-eval'"]).toContain(src);
    }
  });

  it('permits the app\'s real asset needs', () => {
    expect(prod['style-src']).toContain("'unsafe-inline'"); // React/MathJax/CodeMirror styles
    expect(prod['img-src']).toEqual(expect.arrayContaining(['data:', 'blob:'])); // covers/thumbnails
    expect(prod['worker-src']).toContain('blob:'); // pdf.js worker
    expect(prod['frame-src']).toEqual(expect.arrayContaining(['http:', 'https:'])); // note embeds
  });

  it('includes the file: scheme for own assets and locks down objects/base/form', () => {
    expect(prod['default-src']).toContain('file:');
    expect(prod['script-src']).toContain('file:');
    expect(prod['object-src']).toEqual(["'none'"]);
    expect(prod['base-uri']).toEqual(["'none'"]);
    expect(prod['form-action']).toEqual(["'none'"]);
  });

  it('omits meta-invalid directives (frame-ancestors/sandbox)', () => {
    expect(prod['frame-ancestors']).toBeUndefined();
    expect(prod['sandbox']).toBeUndefined();
  });

  it('never contains a doubled space (empty devOrigin handling is prod-safe too)', () => {
    expect(contentSecurityPolicy('prod')).not.toMatch(/ {2}/);
  });
});

describe('contentSecurityPolicy (dev)', () => {
  const origin = 'http://localhost:5173';
  const dev = parse(contentSecurityPolicy('dev', origin));

  it('permits HMR: inline + eval + the dev origin', () => {
    expect(dev['script-src']).toEqual(
      expect.arrayContaining(["'self'", origin, "'unsafe-inline'", "'unsafe-eval'"]),
    );
  });

  it('permits the HMR websocket', () => {
    expect(dev['connect-src']).toEqual(expect.arrayContaining(['ws:', 'wss:']));
  });

  it('still hardens object-src/base-uri', () => {
    expect(dev['object-src']).toEqual(["'none'"]);
    expect(dev['base-uri']).toEqual(["'none'"]);
  });

  it('collapses cleanly when devOrigin is empty (no doubled spaces)', () => {
    const csp = contentSecurityPolicy('dev', '');
    expect(csp).not.toMatch(/ {2}/);
    expect(csp).not.toMatch(/;\s*;/);
  });
});

describe('secondaryWindowCsp (Help / Print documents)', () => {
  const csp = parse(secondaryWindowCsp());

  it('forbids scripts outright (no script-src source; default-src none)', () => {
    expect(csp['default-src']).toEqual(["'none'"]);
    // no script-src at all → falls back to default-src 'none' → scripts blocked
    expect(csp['script-src']).toBeUndefined();
  });

  it('permits the inline stylesheet and passive local/https images', () => {
    expect(csp['style-src']).toEqual(["'unsafe-inline'"]);
    expect(csp['img-src']).toEqual(expect.arrayContaining(['data:', 'file:', 'https:']));
  });

  it('allows no remote script/connect origin (only images are remote-capable)', () => {
    const flat = secondaryWindowCsp();
    expect(flat).not.toContain("'unsafe-eval'");
    expect(flat).not.toMatch(/script-src/);
  });
});
