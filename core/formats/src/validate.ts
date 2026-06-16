/**
 * Format-string validation + required-field extraction. Ports
 * `BDSKFormatParser`'s `validateFormat:...` (the non-attributed path) and
 * `requiredFieldsForFormat:`.
 */

import type { TypeManager } from '@bibdesk/model';
import { Scanner } from './scanner.js';
import { isInvalidCiteKeyChar } from './charsets.js';
import {
  CITE_KEY_FIELD,
  LOCAL_FILE_FIELD,
  sanitize,
  fieldKind,
} from './sanitize.js';

// Character classes from BDSKFormatParser.m +initialize.
const VALID_SPECIFIER = new Set('aApPtTmyYlLeEbkfwcsirRduUn0123456789%[]-');
const VALID_ESCAPE_SPECIFIER = new Set('0123456789%[]-');
const VALID_UNIQUE_SPECIFIER = new Set('uUn');
const VALID_LOCAL_FILE_SPECIFIER = new Set('lLeE');
const VALID_ARG_SPECIFIER = new Set('fwcsi'); // require {field}
const VALID_OPT_ARG_SPECIFIER = new Set('aApPTEkfwsuUn');
const VALID_OPT_ARG3_SPECIFIER = new Set('APws');
const VALID_OPT_ARG2_SPECIFIER = new Set('apkuUn');
const VALID_PARAM_SPECIFIER = new Set('aApPtTkfwciuUn');
const VALID_AUTHOR_SPECIFIER = new Set('aApP');

/** Result of {@link validateFormat}. */
export interface FormatValidationResult {
  valid: boolean;
  /** Human-readable error description (when invalid). */
  error?: string;
  /** The sanitized format string (when valid). */
  sanitized?: string;
}

/** optArgStopChars = `%]`. */
function isOptArgStop(c: number): boolean {
  return c === 0x25 || c === 0x5d;
}

/**
 * Validate a format string for a given field. Returns `{valid, error?,
 * sanitized?}`. Mirrors the single-scan validator: checks each specifier is
 * known, that escape specifiers aren't themselves invalid chars for the field,
 * that the unique specifier appears at most once, that local-file specifiers
 * are only used in local-file formats, that `%f/%w/%c/%s/%i` are followed by a
 * `{field}`, and that local-file formats include a unique specifier.
 */
export function validateFormat(
  format: string,
  fieldName: string = CITE_KEY_FIELD,
  typeManager?: TypeManager,
): FormatValidationResult {
  const tm = typeManager;
  const isLocalFileFmt =
    fieldName === LOCAL_FILE_FIELD ||
    (tm ? tm.isLocalFileField(fieldName) : false);
  // invalid-char predicate for the field (used for escape-specifier check)
  const kind = tm ? fieldKind(fieldName, tm) : 'citeKey';
  const invalidCharPred =
    kind === 'citeKey' ? isInvalidCiteKeyChar : () => false;

  const scanner = new Scanner(format);
  let foundUnique = false;
  let error: string | undefined;

  while (!scanner.isAtEnd()) {
    scanner.scanUpToString('%'); // literal text (validated/sanitized on success)
    if (!scanner.scanString('%')) break; // end

    const specCode = scanner.scanCharacter();
    if (specCode === undefined) {
      error = 'Empty specifier % at end of format.';
      break;
    }
    const spec = String.fromCharCode(specCode);

    if (!VALID_SPECIFIER.has(spec)) {
      error = `Invalid specifier %${spec} in format.`;
      break;
    }
    if (VALID_ESCAPE_SPECIFIER.has(spec) && invalidCharPred(specCode)) {
      error = `Invalid escape specifier %${spec} in format.`;
      break;
    }
    if (VALID_UNIQUE_SPECIFIER.has(spec)) {
      if (foundUnique) {
        error = `Unique specifier %${spec} can appear only once in format.`;
        break;
      }
      foundUnique = true;
    } else if (VALID_LOCAL_FILE_SPECIFIER.has(spec) && !isLocalFileFmt) {
      error = `Specifier %${spec} is only valid in format for local file.`;
      break;
    }

    // compulsory {field} argument
    if (VALID_ARG_SPECIFIER.has(spec)) {
      if (
        scanner.isAtEnd() ||
        !scanner.scanString('{') ||
        scanner.scanUpToString('}') === undefined ||
        !scanner.scanString('}')
      ) {
        error = `Specifier %${spec} must be followed by a {'field'} name.`;
        break;
      }
    }

    // optional [...] arguments
    if (VALID_OPT_ARG_SPECIFIER.has(spec)) {
      if (!scanner.isAtEnd()) {
        const numOpts = VALID_OPT_ARG3_SPECIFIER.has(spec)
          ? 3
          : VALID_OPT_ARG2_SPECIFIER.has(spec)
            ? 2
            : 1;
        for (let i = 0; i < numOpts && scanner.scanString('['); i++) {
          for (;;) {
            scanner.scanUpToCharacters(isOptArgStop);
            if (!scanner.scanString('%')) break;
            const escCode = scanner.scanCharacter();
            if (escCode === undefined) {
              error = 'Empty specifier % at end of format.';
              break;
            }
            const escCh = String.fromCharCode(escCode);
            if (!VALID_ESCAPE_SPECIFIER.has(escCh)) {
              error = `Invalid specifier %${escCh} in format.`;
              break;
            }
            if (invalidCharPred(escCode)) {
              error = `Invalid escape specifier %${escCh} in format.`;
              break;
            }
          }
          if (error) break;
          if (!scanner.scanString(']')) {
            error = `Missing "]" after specifier %${spec}.`;
            break;
          }
        }
        if (error) break;
      }
    }

    // numeric optional parameters
    if (VALID_PARAM_SPECIFIER.has(spec)) {
      if (VALID_AUTHOR_SPECIFIER.has(spec) && scanner.scanString('-')) {
        const digits = scanner.scanCharactersFromSet(
          (c) => c >= 0x30 && c <= 0x39,
        );
        if (digits === undefined) {
          // back up over the '-'
          scanner.location = scanner.location - 1;
        }
      } else {
        scanner.scanCharactersFromSet((c) => c >= 0x30 && c <= 0x39);
      }
    }
  }

  if (!foundUnique && isLocalFileFmt && !error) {
    error =
      'Format for local file requires a unique specifier to ensure unique file names (%u, %U or %n).';
  }

  if (error) {
    return { valid: false, error };
  }
  // Reconstruct {field} arguments faithfully (the loop above consumed but did
  // not re-emit them); do a simpler full reconstruction pass.
  return { valid: true, sanitized: reconstructSanitized(format, fieldName, tm) };
}

/**
 * Produce the sanitized format string by re-scanning and copying the {field}
 * and bracket bodies through `sanitize`. This is a faithful but simpler pass
 * than the validation scan, used only when the format is already known valid.
 */
function reconstructSanitized(
  format: string,
  fieldName: string,
  tm?: TypeManager,
): string {
  const scanner = new Scanner(format);
  let out = '';
  const san = (s: string) => (tm ? sanitize(s, fieldName, tm) : s);
  while (!scanner.isAtEnd()) {
    const text = scanner.scanUpToString('%');
    if (text !== undefined) out += san(text);
    if (!scanner.scanString('%')) break;
    const specCode = scanner.scanCharacter();
    if (specCode === undefined) break;
    const spec = String.fromCharCode(specCode);
    out += `%${spec}`;
    if (VALID_ARG_SPECIFIER.has(spec) && scanner.scanString('{')) {
      const key = scanner.scanUpToString('}') ?? '';
      scanner.scanString('}');
      out += `{${normalizeFieldKey(key)}}`;
    }
    if (VALID_OPT_ARG_SPECIFIER.has(spec)) {
      const numOpts = VALID_OPT_ARG3_SPECIFIER.has(spec)
        ? 3
        : VALID_OPT_ARG2_SPECIFIER.has(spec)
          ? 2
          : 1;
      for (let i = 0; i < numOpts && scanner.scanString('['); i++) {
        let optArg = '';
        for (;;) {
          const piece = scanner.scanUpToCharacters(isOptArgStop);
          if (piece !== undefined) optArg += spec !== 'w' || i > 0 ? san(piece) : piece;
          if (!scanner.scanString('%')) break;
          const escCode = scanner.scanCharacter();
          if (escCode === undefined) break;
          optArg += `%${String.fromCharCode(escCode)}`;
        }
        scanner.scanString(']');
        out += `[${optArg}]`;
      }
    }
    if (VALID_PARAM_SPECIFIER.has(spec)) {
      if (VALID_AUTHOR_SPECIFIER.has(spec) && scanner.scanString('-')) {
        const digits = scanner.scanCharactersFromSet((c) => c >= 0x30 && c <= 0x39);
        if (digits !== undefined) out += `-${digits}`;
        else scanner.location = scanner.location - 1;
      } else {
        const digits = scanner.scanCharactersFromSet((c) => c >= 0x30 && c <= 0x39);
        if (digits !== undefined) out += digits;
      }
    }
  }
  return out;
}

/** Capitalize the first letter (BibDesk `[string fieldName]`). */
function normalizeFieldKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) return trimmed;
  if (trimmed.toLowerCase() === 'cite key' || trimmed.toLowerCase() === 'citekey' || trimmed.toLowerCase() === 'cite-key') {
    return CITE_KEY_FIELD;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Extract the field names referenced by a format string. Port of
 * `requiredFieldsForFormat:`. Returns canonical-ish field names; `%f/%w/%c`
 * yield the braced field, `%i` yields `Document: <key>`, `%b` yields
 * `Document Filename`.
 */
export function requiredFieldsForFormat(format: string): string[] {
  const out: string[] = [];
  const l = format.length;
  let i = 0;
  while (i < l) {
    const pct = format.indexOf('%', i);
    if (pct === -1) break;
    i = pct + 1;
    if (i >= l) break;
    const ch = format[i]!;
    switch (ch) {
      case 'a':
      case 'A':
        out.push('Author');
        break;
      case 'p':
      case 'P':
        out.push('Author', 'Editor');
        break;
      case 't':
      case 'T':
        out.push('Title');
        break;
      case 'y':
      case 'Y':
        out.push('Year');
        break;
      case 'm':
        out.push('Month');
        break;
      case 'l':
      case 'L':
      case 'e':
      case 'E':
        out.push('Local-Url');
        break;
      case 'b':
        out.push('Document Filename');
        break;
      case 'k':
        out.push('Keywords');
        break;
      case 'f':
      case 'w':
      case 'c': {
        const close = format.indexOf('}', i);
        if (close !== -1 && close > i + 2) {
          out.push(format.slice(i + 2, close));
        }
        break;
      }
      case 'i': {
        const close = format.indexOf('}', i);
        if (close !== -1 && close > i + 2) {
          out.push('Document: ' + format.slice(i + 2, close));
        }
        break;
      }
      default:
        break;
    }
    i++;
  }
  return out;
}
