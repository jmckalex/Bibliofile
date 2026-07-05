import { describe, it, expect } from 'vitest';
import { isAppNavigation } from './navigation.js';

describe('isAppNavigation', () => {
  const prod = 'file:///Applications/Bibliofile.app/Contents/Resources/app/out/renderer/index.html';
  const dev = 'http://localhost:5173/';

  it('allows a reload of the same document', () => {
    expect(isAppNavigation(prod, prod)).toBe(true);
    expect(isAppNavigation(dev, dev)).toBe(true);
  });

  it('allows same-document hash / query re-entry (SPA routing)', () => {
    expect(isAppNavigation(`${prod}#editor=doc::item`, prod)).toBe(true);
    expect(isAppNavigation(`${dev}?x=1#annotation=a::b`, dev)).toBe(true);
  });

  it('blocks navigation to a remote origin', () => {
    expect(isAppNavigation('https://evil.example/', dev)).toBe(false);
    expect(isAppNavigation('http://evil.example/', prod)).toBe(false);
  });

  it('blocks navigation to a DIFFERENT local file (opaque file: origins share "null")', () => {
    // the whole point of comparing pathname, not origin: two file:// URLs both
    // have origin "null", so an origin check would wrongly allow this.
    expect(isAppNavigation('file:///etc/passwd', prod)).toBe(false);
    expect(
      isAppNavigation('file:///Applications/Bibliofile.app/Contents/Resources/app/out/renderer/evil.html', prod),
    ).toBe(false);
  });

  it('blocks a cross-origin dev navigation even to another localhost port', () => {
    expect(isAppNavigation('http://localhost:9999/', dev)).toBe(false);
  });

  it('treats a missing/garbage current URL as not-same (deny by default)', () => {
    expect(isAppNavigation(prod, '')).toBe(false);
    expect(isAppNavigation('not a url', prod)).toBe(false);
    expect(isAppNavigation(prod, 'not a url')).toBe(false);
  });
});
