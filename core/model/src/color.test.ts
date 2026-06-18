import { describe, it, expect } from 'vitest';
import {
  LABEL_COLORS,
  COLOR_FIELD,
  labelIndexToColorField,
  colorFieldLabelIndex,
  colorFieldToHex,
} from './color.js';

describe('color label codec', () => {
  it('field name and palette match BibDesk', () => {
    expect(COLOR_FIELD).toBe('Bdsk-Color');
    expect(LABEL_COLORS.map((c) => c.name)).toEqual([
      'Red',
      'Orange',
      'Yellow',
      'Green',
      'Blue',
      'Purple',
      'Gray',
    ]);
  });

  it('encodes a 1-based label index and round-trips to its hex', () => {
    for (let i = 1; i <= LABEL_COLORS.length; i++) {
      const field = labelIndexToColorField(i);
      expect(field).toBe(String(i));
      expect(colorFieldLabelIndex(field)).toBe(i);
      expect(colorFieldToHex(field)).toBe(LABEL_COLORS[i - 1]!.hex);
    }
  });

  it('decodes a packed big-endian RGBA uint32 (BibDesk custom color) to hex', () => {
    // r=0x12 g=0x34 b=0x56 a=0xFF -> 0x123456FF = 305419519
    const packed = ((0x12 << 24) | (0x34 << 16) | (0x56 << 8) | 0xff) >>> 0;
    expect(colorFieldToHex(String(packed))).toBe('#123456');
    expect(colorFieldLabelIndex(String(packed))).toBeUndefined(); // not a palette label
  });

  it('treats empty / zero / non-numeric as no color', () => {
    for (const v of ['', '   ', '0', 'abc', undefined, null]) {
      expect(colorFieldToHex(v)).toBeUndefined();
      expect(colorFieldLabelIndex(v)).toBeUndefined();
    }
  });
});
