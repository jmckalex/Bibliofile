/**
 * `.bib` file text-encoding support. BibTeX files predate UTF-8 and are still
 * commonly stored in legacy 8-bit encodings (Windows-1252, ISO-8859-1, Mac Roman)
 * or UTF-16. Bibliofile auto-detects the encoding on open, decodes to a Unicode
 * string for the model, and — by default — writes the file back in the SAME
 * encoding (a faithful round-trip; the user can Convert to UTF-8 when they want).
 *
 * The in-memory model is always Unicode; this module is the byte↔string boundary.
 * iconv-lite handles the encodings Node's built-in `Buffer` can't write
 * (Windows-1252 / Mac Roman). Note that the BibTeX *serializer* already writes
 * accents as TeX commands (é→`{\'e}`, ő→`{\H o}`), so by the time text reaches
 * here the only non-ASCII left are characters with no TeX form (€, CJK, emoji);
 * {@link lostChars} reports the ones a target encoding still can't hold (→ UTF-8).
 */
import iconv from 'iconv-lite';

/** The encodings Bibliofile can read and write a `.bib` in (ids are iconv-lite names). */
export const SUPPORTED_ENCODINGS = [
  { id: 'utf8', label: 'UTF-8' },
  { id: 'utf16le', label: 'UTF-16 LE' },
  { id: 'utf16be', label: 'UTF-16 BE' },
  { id: 'windows-1252', label: 'Windows-1252' },
  { id: 'iso-8859-1', label: 'ISO-8859-1 (Latin-1)' },
  { id: 'iso-8859-15', label: 'ISO-8859-15 (Latin-9)' },
  { id: 'macintosh', label: 'Mac Roman' },
] as const;

export type BibEncoding = (typeof SUPPORTED_ENCODINGS)[number]['id'];

/** Human label for an encoding id (falls back to the id). */
export function encodingLabel(id: string): string {
  return SUPPORTED_ENCODINGS.find((e) => e.id === id)?.label ?? id;
}

export function isSupportedEncoding(id: string): id is BibEncoding {
  return SUPPORTED_ENCODINGS.some((e) => e.id === id);
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16BE_BOM = Buffer.from([0xfe, 0xff]);

export interface DecodedBib {
  /** Decoded Unicode text, with any byte-order mark stripped. */
  readonly text: string;
  /** The detected (or chosen) encoding id. */
  readonly encoding: string;
  /** Whether the original bytes started with a byte-order mark (re-added on save). */
  readonly hadBom: boolean;
}

function startsWith(buf: Buffer, bom: Buffer): boolean {
  return buf.length >= bom.length && buf.subarray(0, bom.length).equals(bom);
}

/** True if `buf` is valid UTF-8 (strict — any invalid sequence ⇒ false). */
function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect a `.bib` file's encoding: BOM first, then strict UTF-8 validation, then
 * an 8-bit fallback (Windows-1252 — the commonest, and a superset of plain Latin-1
 * text). A wrong 8-bit guess is correctable via File → Text Encoding.
 */
export function detectEncoding(buf: Buffer): { encoding: string; hadBom: boolean } {
  // UTF-32 LE shares its first two bytes with UTF-16 LE, so check the 4-byte forms first.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xfe && buf[2] === 0x00 && buf[3] === 0x00)
    return { encoding: 'utf16le', hadBom: true }; // UTF-32 LE — treated/decoded best-effort
  if (startsWith(buf, UTF16LE_BOM)) return { encoding: 'utf16le', hadBom: true };
  if (startsWith(buf, UTF16BE_BOM)) return { encoding: 'utf16be', hadBom: true };
  if (startsWith(buf, UTF8_BOM)) return { encoding: 'utf8', hadBom: true };
  if (isValidUtf8(buf)) return { encoding: 'utf8', hadBom: false };
  return { encoding: 'windows-1252', hadBom: false };
}

function bomFor(encoding: string): Buffer | null {
  if (encoding === 'utf8') return UTF8_BOM;
  if (encoding === 'utf16le') return UTF16LE_BOM;
  if (encoding === 'utf16be') return UTF16BE_BOM;
  return null;
}

function stripBom(buf: Buffer, encoding: string, hadBom: boolean): Buffer {
  const bom = hadBom ? bomFor(encoding) : null;
  return bom ? buf.subarray(bom.length) : buf;
}

/** Decode bytes with a specific encoding (used by "Reopen with Encoding"). */
export function decodeBibAs(buf: Buffer, encoding: string): DecodedBib {
  const bom = bomFor(encoding);
  const hadBom = bom ? startsWith(buf, bom) : false;
  const text = iconv.decode(stripBom(buf, encoding, hadBom), encoding);
  return { text, encoding, hadBom };
}

/** Decode a `.bib` file's bytes to text, auto-detecting the encoding. */
export function decodeBib(buf: Buffer): DecodedBib {
  const { encoding } = detectEncoding(buf);
  return decodeBibAs(buf, encoding);
}

/** True if `ch` (a single code point) can be encoded in `encoding` without loss. */
function isRepresentable(ch: string, encoding: string): boolean {
  if (ch.codePointAt(0)! < 0x80) return true; // ASCII is in every encoding we support
  return iconv.decode(iconv.encode(ch, encoding), encoding) === ch;
}

/**
 * The distinct characters in `text` that `encoding` cannot represent (and would be
 * dropped on save). Empty for the Unicode encodings. Used to tell the user exactly
 * which characters force a Convert-to-UTF-8.
 */
export function lostChars(text: string, encoding: string): string[] {
  if (bomFor(encoding)) return []; // Unicode encodings hold everything
  const lost: string[] = [];
  for (const ch of text) {
    if (ch.codePointAt(0)! < 0x80) continue;
    if (!isRepresentable(ch, encoding) && !lost.includes(ch)) lost.push(ch);
  }
  return lost;
}

export interface EncodedBib {
  readonly bytes: Buffer;
  /** True if encoding dropped characters the target can't represent. */
  readonly lossy: boolean;
}

/** Encode `.bib` text to bytes in `encoding`, re-adding a BOM if the original had one. */
export function encodeBib(text: string, encoding: string, hadBom: boolean): EncodedBib {
  const body = iconv.encode(text, encoding);
  const lossy = !bomFor(encoding) && iconv.decode(body, encoding) !== text;
  const bom = hadBom ? bomFor(encoding) : null;
  return { bytes: bom ? Buffer.concat([bom, body]) : body, lossy };
}
