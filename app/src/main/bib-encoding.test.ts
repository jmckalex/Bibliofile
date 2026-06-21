import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import {
  detectEncoding,
  decodeBibAs,
  encodeBib,
  lostChars,
  encodingLabel,
  isSupportedEncoding,
} from './bib-encoding';

describe('detectEncoding', () => {
  it('plain ASCII and valid UTF-8 → utf8, no BOM', () => {
    expect(detectEncoding(Buffer.from('@article{a, title = {x}}', 'utf8'))).toEqual({
      encoding: 'utf8',
      hadBom: false,
    });
    expect(detectEncoding(Buffer.from('Erdős café résumé', 'utf8'))).toEqual({
      encoding: 'utf8',
      hadBom: false,
    });
  });

  it('recognises BOMs', () => {
    expect(detectEncoding(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x')]))).toEqual({
      encoding: 'utf8',
      hadBom: true,
    });
    expect(detectEncoding(Buffer.from([0xff, 0xfe, 0x78, 0x00]))).toEqual({
      encoding: 'utf16le',
      hadBom: true,
    });
    expect(detectEncoding(Buffer.from([0xfe, 0xff, 0x00, 0x78]))).toEqual({
      encoding: 'utf16be',
      hadBom: true,
    });
  });

  it('non-UTF-8 8-bit bytes → windows-1252 fallback', () => {
    const latin1 = iconv.encode('café', 'iso-8859-1'); // 0xE9 is invalid UTF-8
    expect(detectEncoding(latin1)).toEqual({ encoding: 'windows-1252', hadBom: false });
  });
});

describe('decode / encode round-trip', () => {
  // Characters present in every Western 8-bit encoding we support (incl. Mac Roman) + Unicode.
  const text = 'Café Müller Niño Köln à è ç';
  for (const enc of ['utf8', 'utf16le', 'utf16be', 'windows-1252', 'iso-8859-1', 'iso-8859-15', 'macintosh']) {
    it(`round-trips representable text in ${enc}`, () => {
      const { bytes, lossy } = encodeBib(text, enc, false);
      expect(lossy).toBe(false);
      expect(decodeBibAs(bytes, enc).text).toBe(text);
    });
  }

  it('re-adds and strips a BOM', () => {
    expect(encodeBib('x', 'utf8', true).bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(encodeBib('x', 'utf16le', true).bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
    expect(decodeBibAs(encodeBib('x', 'utf16le', true).bytes, 'utf16le')).toEqual({
      text: 'x',
      encoding: 'utf16le',
      hadBom: true,
    });
  });

  it('decodeBibAs reads bytes with the given encoding', () => {
    expect(decodeBibAs(iconv.encode('café', 'iso-8859-1'), 'iso-8859-1').text).toBe('café');
  });
});

describe('lossy encode + lostChars', () => {
  it('flags a save that would drop characters', () => {
    expect(encodeBib('Erdős', 'iso-8859-1', false).lossy).toBe(true); // ő not in Latin-1
    expect(encodeBib('café', 'iso-8859-1', false).lossy).toBe(false); // é is in Latin-1
    expect(encodeBib('Erdős', 'utf8', false).lossy).toBe(false); // Unicode holds everything
  });

  it('lostChars lists exactly the un-encodable characters', () => {
    expect(lostChars('Erdős café', 'iso-8859-1')).toEqual(['ő']); // é representable, ő not
    expect(lostChars('price €5 北', 'iso-8859-1')).toEqual(['€', '北']);
    expect(lostChars('plain café', 'iso-8859-1')).toEqual([]); // all representable
    expect(lostChars('€ is fine here', 'windows-1252')).toEqual([]); // € is in Windows-1252
    expect(lostChars('Erdős € 北', 'utf8')).toEqual([]); // Unicode target loses nothing
  });
});

describe('metadata helpers', () => {
  it('labels and validates encoding ids', () => {
    expect(encodingLabel('windows-1252')).toBe('Windows-1252');
    expect(encodingLabel('utf8')).toBe('UTF-8');
    expect(isSupportedEncoding('macintosh')).toBe(true);
    expect(isSupportedEncoding('nonsense')).toBe(false);
  });
});
