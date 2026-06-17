import { describe, it, expect } from 'vitest';
import { parseAppUrl } from './app-url.js';

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
