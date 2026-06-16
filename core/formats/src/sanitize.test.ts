import { describe, it, expect } from 'vitest';
import { TypeManager } from '@bibdesk/model';
import {
  isValidCiteKey,
  citeKeyHasFragileChars,
  filterCiteKeyInput,
  cleanForCiteKey,
  cleanForFilename,
  sanitize,
  strictlySanitize,
  fieldKind,
  CITE_KEY_FIELD,
  LOCAL_FILE_FIELD,
} from './sanitize.js';
import {
  isStrictInvalidCiteKeyChar,
  isInvalidCiteKeyChar,
} from './charsets.js';

const tm = new TypeManager();

describe('isValidCiteKey (manual-entry set)', () => {
  it('accepts printable ASCII keys', () => {
    expect(isValidCiteKey('Smith2020')).toBe(true);
    expect(isValidCiteKey('smith:2020')).toBe(true);
    expect(isValidCiteKey('a-b_c.d')).toBe(true);
  });
  it('rejects empty and forbidden-punctuation keys', () => {
    expect(isValidCiteKey('')).toBe(false);
    expect(isValidCiteKey('has space')).toBe(false);
    expect(isValidCiteKey('a@b')).toBe(false);
    expect(isValidCiteKey('a,b')).toBe(false);
    expect(isValidCiteKey('a{b}')).toBe(false);
    expect(isValidCiteKey('100%')).toBe(false);
  });
  it('rejects non-ASCII', () => {
    expect(isValidCiteKey('Müller2020')).toBe(false);
  });
  it('treats fragile chars (& $ ^) as valid but flags them', () => {
    expect(isValidCiteKey('a&b')).toBe(true);
    expect(citeKeyHasFragileChars('a&b')).toBe(true);
    expect(citeKeyHasFragileChars('ab')).toBe(false);
  });
});

describe('filterCiteKeyInput (live strip)', () => {
  it('strips invalid manual-entry characters', () => {
    expect(filterCiteKeyInput('Sm@ith, 2020')).toBe('Smith2020');
  });
});

describe('strict invalid char set', () => {
  it('allows only a-zA-Z and -./0-9:; (generated keys)', () => {
    // letters
    expect(isStrictInvalidCiteKeyChar('a'.charCodeAt(0))).toBe(false);
    expect(isStrictInvalidCiteKeyChar('Z'.charCodeAt(0))).toBe(false);
    // dash range chars
    for (const c of '-./0123456789:;') {
      expect(isStrictInvalidCiteKeyChar(c.charCodeAt(0))).toBe(false);
    }
    // forbidden in strict: underscore, comma, space, etc.
    expect(isStrictInvalidCiteKeyChar('_'.charCodeAt(0))).toBe(true);
    expect(isStrictInvalidCiteKeyChar(','.charCodeAt(0))).toBe(true);
    expect(isStrictInvalidCiteKeyChar(' '.charCodeAt(0))).toBe(true);
  });

  it('manual invalid set is laxer than strict (underscore allowed manually)', () => {
    expect(isInvalidCiteKeyChar('_'.charCodeAt(0))).toBe(false);
    expect(isStrictInvalidCiteKeyChar('_'.charCodeAt(0))).toBe(true);
  });
});

describe('cleanForCiteKey (strict sanitize)', () => {
  it('folds accents, replaces whitespace with dash, strips invalid', () => {
    expect(cleanForCiteKey('Müller Schmidt', tm)).toBe('Muller-Schmidt');
  });
  it('strips underscores (strict set)', () => {
    expect(cleanForCiteKey('a_b', tm)).toBe('ab');
  });
  it('de-TeXifies accents', () => {
    expect(cleanForCiteKey("Cr{\\'e}peau", tm)).toBe('Crepeau');
  });
});

describe('cleanForFilename', () => {
  it('keeps non-ASCII by default (only strips colon)', () => {
    expect(cleanForFilename('Müller: notes', tm)).toBe('Müller notes');
  });
  it('very-strict option strips Windows-illegal chars', () => {
    expect(
      cleanForFilename('a<b>c:d|e', tm, { localFileCleanOption: 3 }),
    ).toBe('abcde');
  });
});

describe('fieldKind classification', () => {
  it('classifies cite key / local file / remote / general', () => {
    expect(fieldKind(CITE_KEY_FIELD, tm)).toBe('citeKey');
    expect(fieldKind(LOCAL_FILE_FIELD, tm)).toBe('localFile');
    expect(fieldKind('Url', tm)).toBe('remoteURL');
    expect(fieldKind('Title', tm)).toBe('general');
  });
});

describe('sanitize (mild) vs strictlySanitize', () => {
  it('mild cite-key sanitize keeps accents-as-composed-folded but not lossy ASCII fallback', () => {
    // mild path: deTeXify + replaceComposed + ws->'-' + strip manual-invalid
    expect(sanitize('Müller Smith', CITE_KEY_FIELD, tm)).toBe('Muller-Smith');
  });
  it('general field strict sanitize is a no-op (empty strict general set)', () => {
    expect(strictlySanitize('anything!@#', 'Note', tm)).toBe('anything!@#');
  });
});
