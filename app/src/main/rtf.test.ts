import { describe, it, expect } from 'vitest';
import { htmlToRtf, wrapRtf } from './rtf.js';

describe('htmlToRtf', () => {
  it('maps italic/bold to RTF runs and escapes braces/backslashes', () => {
    const rtf = htmlToRtf('Smith, J. (1999). <i>The Title</i>. <b>Journal</b>, 1(2).');
    expect(rtf).toContain('\\i The Title\\i0');
    expect(rtf).toContain('\\b Journal\\b0');
    expect(rtf).toContain('Smith, J. (1999)');
    const esc = htmlToRtf('a {b} c\\d');
    expect(esc).toContain('a \\{b\\} c\\\\d');
  });

  it('decodes entities and escapes non-ASCII as \\uN', () => {
    const rtf = htmlToRtf('Gödel &amp; Escher'); // ö = U+00F6 (246)
    expect(rtf).toContain('&'); // &amp; decoded
    expect(rtf).toContain('\\u246?'); // ö escaped
    expect(rtf).not.toContain('ö');
  });

  it('drops unknown tags but keeps their text', () => {
    expect(htmlToRtf('<span class="x">Hello</span> <a href="u">link</a>')).toBe('Hello link');
  });
});

describe('wrapRtf', () => {
  it('produces a complete RTF document joining paragraphs with \\par', () => {
    const doc = wrapRtf(['one', 'two']);
    expect(doc.startsWith('{\\rtf1')).toBe(true);
    expect(doc.endsWith('}')).toBe(true);
    expect(doc).toContain('one\\par\ntwo');
  });
});
