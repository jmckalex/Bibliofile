import { describe, it, expect } from 'vitest';
import { parseAppUrl, isOpenableBibPath } from './app-url.js';

describe('parseAppUrl', () => {
  it('parses command (authority) + query params', () => {
    expect(parseAppUrl('x-bibdesk://open?file=/abs/lib.bib')).toEqual({
      command: 'open',
      params: { file: '/abs/lib.bib' },
    });
  });

  it('url-decodes parameters', () => {
    const a = parseAppUrl('x-bibdesk://new?type=article&Title=On%20Bullshit&Author=Harry%20Frankfurt');
    expect(a).toEqual({
      command: 'new',
      params: { type: 'article', Title: 'On Bullshit', Author: 'Harry Frankfurt' },
    });
  });

  it('carries a url-encoded BibTeX payload intact', () => {
    const bib = '@article{x, Title = {Hi}}';
    const a = parseAppUrl(`x-bibdesk://import?bibtex=${encodeURIComponent(bib)}`);
    expect(a!.command).toBe('import');
    expect(a!.params.bibtex).toBe(bib);
  });

  it('lower-cases the command and accepts a path-style command', () => {
    expect(parseAppUrl('x-bibdesk://IMPORT?doi=10.1/x')!.command).toBe('import');
    expect(parseAppUrl('x-bibdesk:///search?q=kant')!.command).toBe('search');
  });

  it('rejects other schemes and malformed input', () => {
    expect(parseAppUrl('https://example.com')).toBeNull();
    expect(parseAppUrl('not a url')).toBeNull();
    expect(parseAppUrl('x-bibdesk://')).toBeNull();
  });
});

describe('isOpenableBibPath (x-bibdesk://open guard)', () => {
  it('accepts .bib paths, case-insensitively, including ones with spaces', () => {
    expect(isOpenableBibPath('/Users/me/lib.bib')).toBe(true);
    expect(isOpenableBibPath('/Users/me/LIB.BIB')).toBe(true);
    expect(isOpenableBibPath('/Users/me/My Library.bib')).toBe(true);
  });

  it('refuses the paths a web page would probe for', () => {
    for (const p of ['/etc/passwd', '/Users/me/.ssh/id_rsa', '/Users/me/notes.txt', '/Users/me/lib.bib.txt', '']) {
      expect(isOpenableBibPath(p), p).toBe(false);
    }
  });

  it('refuses a NUL-truncation attempt', () => {
    // The OS stops at the NUL, so the ".bib" we checked is not what would open.
    expect(isOpenableBibPath('/etc/passwd\u0000.bib')).toBe(false);
  });
});
