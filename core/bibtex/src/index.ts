// @bibdesk-stub — parse/serialize implemented in Wave 3 (C4).
/**
 * @bibdesk/bibtex — custom byte-faithful BibTeX round-trip parser + serializer.
 *
 * PUBLIC CONTRACT (stable; T1's golden round-trip harness depends on these names):
 *   parse(text)      -> BibLibrary
 *   serialize(lib)   -> string
 * Round-trip property: serialize(parse(text)) === text  (modulo the documented
 * normalizations in subsystem-12 §2). C4 owns the full shape of BibLibrary;
 * it MUST keep these two entry points and the round-trip contract.
 */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is implemented in Wave 3 (C4 — core/bibtex)`);
    this.name = 'NotImplementedError';
  }
}

export interface ParseOptions {
  /** Source encoding hint; defaults to utf-8. */
  encoding?: string;
}
export interface SerializeOptions {
  /** Override the line ending; defaults to the document's detected ending. */
  newline?: string;
}

/** Opaque-ish parsed library; full structure defined by C4. */
export interface BibLibrary {
  entries: unknown[];
  [k: string]: unknown;
}

export function parse(_text: string, _opts?: ParseOptions): BibLibrary {
  throw new NotImplementedError('parse');
}

export function serialize(_lib: BibLibrary, _opts?: SerializeOptions): string {
  throw new NotImplementedError('serialize');
}
