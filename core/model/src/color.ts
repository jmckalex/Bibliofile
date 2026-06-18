/**
 * Color labels — BibDesk stores a per-publication color in the `Bdsk-Color`
 * field (`BDSKColorString`) as a base-10 `uint32` string (see
 * `NSColor_BDSKExtensions.m colorWithFourByteString:` / `fourByteStringValue`):
 *
 *   - a value in `1..N` is a **1-based index** into the fixed label palette
 *     (`[NSColor labelColors]` = system Red/Orange/Yellow/Green/Blue/Purple/Gray);
 *   - any larger value is a packed **big-endian RGBA** (`r<<24 | g<<16 | b<<8 | a`).
 *
 * We write the compact label index for our palette colors (so files round-trip
 * with BibDesk), and decode either form to a CSS hex for display. This module is
 * pure (no Electron / DOM) and lives next to the BibItem field semantics.
 */

/** One entry of the fixed label palette. */
export interface LabelColor {
  /** Display name (e.g. "Red"). */
  readonly name: string;
  /** CSS hex (sRGB) — our cross-platform rendering of BibDesk's system color. */
  readonly hex: string;
}

/**
 * The label palette, in BibDesk's `[NSColor labelColors]` order so the stored
 * 1-based index matches. Hexes are sRGB approximations of the macOS system
 * colors (light appearance).
 */
export const LABEL_COLORS: readonly LabelColor[] = [
  { name: 'Red', hex: '#FF3B30' },
  { name: 'Orange', hex: '#FF9500' },
  { name: 'Yellow', hex: '#FFCC00' },
  { name: 'Green', hex: '#34C759' },
  { name: 'Blue', hex: '#007AFF' },
  { name: 'Purple', hex: '#AF52DE' },
  { name: 'Gray', hex: '#8E8E93' },
] as const;

/** The BibTeX field BibDesk stores the color in (`BDSKColorString`). */
export const COLOR_FIELD = 'Bdsk-Color';

/** Encode a 1-based palette index (1..{@link LABEL_COLORS}.length) as the field value. */
export function labelIndexToColorField(index: number): string {
  return String(index);
}

/** The 1-based palette index a stored value names, or undefined if it isn't a label. */
export function colorFieldLabelIndex(value: string | undefined | null): number | undefined {
  if (value == null) return undefined;
  const s = value.trim();
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n >= 1 && n <= LABEL_COLORS.length ? n : undefined;
}

/**
 * Decode a `Bdsk-Color` field value to a CSS `#rrggbb` string, or undefined when
 * empty / unparseable. Label indices map through {@link LABEL_COLORS}; larger
 * values decode as packed big-endian RGBA (alpha is ignored for the swatch).
 */
export function colorFieldToHex(value: string | undefined | null): string | undefined {
  const labelIndex = colorFieldLabelIndex(value);
  if (labelIndex !== undefined) return LABEL_COLORS[labelIndex - 1]!.hex;
  if (value == null) return undefined;
  const s = value.trim();
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= LABEL_COLORS.length) return undefined; // 0 / empty / already handled
  const u = n >>> 0;
  const r = (u >>> 24) & 0xff;
  const g = (u >>> 16) & 0xff;
  const b = (u >>> 8) & 0xff;
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}
