/**
 * Bibliofile scripting API — the `bibliofile` global available to scripts run in
 * the Script Console (Tools ▸ Script Console…) or from the Scripts folder.
 *
 * Scripts are synchronous JavaScript. A whole run is a single Undo. Reads and
 * writes go straight through the open library. Copy this file next to your
 * scripts (and reference it with a JSDoc `/** @type {…} *​/` or your editor's
 * tsconfig) for autocomplete.
 */

/** A parsed person (author/editor). */
export interface AuthorInfo {
  readonly displayName: string;
  readonly first: string;
  readonly von: string;
  readonly last: string;
  readonly jr: string;
}

/** A file/URL attachment on an entry. */
export interface AttachmentInfo {
  /** The backing field (e.g. `Bdsk-File-1`, `Url`), when known. */
  readonly field?: string;
  /** `'file'` for a local file, `'url'` for a remote link. */
  readonly kind: string;
  /** Display name (basename / link text). */
  readonly name: string;
  /** Resolved file path or URL. */
  readonly url: string;
}

/** One bibliography entry. Reads are live; mutators return `this` for chaining. */
export interface Entry {
  readonly id: string;
  readonly citeKey: string;
  readonly type: string;
  /** Raw stored value of a field (macro-expanded), '' if absent. `inherit` pulls a crossref parent's value. */
  field(name: string, inherit?: boolean): string;
  /** Like {@link field} but de-TeXified to Unicode (e.g. `G{\"o}del` → `Gödel`). */
  displayField(name: string, inherit?: boolean): string;
  fieldNames(): string[];
  /** All fields as a `{ name: value }` map. */
  fields(): Record<string, string>;
  authors(field?: string, inherit?: boolean): AuthorInfo[];
  attachments(): AttachmentInfo[];
  toBibTeX(): string;
  toJSON(): { id: string; citeKey: string; type: string; fields: Record<string, string> };
  /** This entry's CSL-JSON object (what the citation engine consumes). */
  cslItem(): Record<string, unknown>;
  /** A formatted bibliography reference (CSL / citation.js), in `style`/`format`. */
  citation(opts?: CiteOptions): string;
  setField(name: string, value: string): Entry;
  removeField(name: string): Entry;
  setType(type: string): Entry;
  setCiteKey(citeKey: string): Entry;
  /** Regenerate the cite key from the configured format; returns the new key. */
  generateCiteKey(): string;
  /** Attach a file by absolute path (AutoFiled if a Papers folder is set). */
  attach(absPath: string): Entry;
  autoFile(): Entry;
  delete(): void;
}

export type ExportFormat = 'bibtex' | 'bibtex-minimal' | 'ris' | 'csv' | 'html' | 'rtf';

/** Options for CSL-formatted citation output. */
export interface CiteOptions {
  /** A CSL style id ('apa', 'vancouver', an installed style); default = the document's. */
  style?: string;
  /** `'text'` (default) or `'html'`. */
  format?: 'text' | 'html';
}

/** One open library document. */
export interface Document {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly modified: boolean;
  count(): number;
  entries(): Entry[];
  get(citeKeyOrId: string): Entry | undefined;
  getByCiteKey(citeKey: string): Entry | undefined;
  getById(id: string): Entry | undefined;
  find(pred: (e: Entry) => boolean): Entry | undefined;
  filter(pred: (e: Entry) => boolean): Entry[];
  /** Case-insensitive substring search over cite key, type, and common fields. */
  search(text: string): Entry[];
  findDuplicates(): Entry[][];
  groups(): Array<{ id: string; kind: string; name: string; count: number }>;
  groupEntries(groupId: string): Entry[];
  macros(): Record<string, string>;
  setMacro(name: string, value: string): void;
  removeMacro(name: string): void;
  addEntry(data: { type?: string; fields?: Record<string, string>; citeKey?: string }): Entry;
  /** Parse + merge BibTeX text; returns the added entries. */
  import(bibtexText: string): Entry[];
  export(format: ExportFormat, citeKeys?: readonly string[]): string;
  toBibTeX(): string;
  save(targetPath?: string): void;
  /** Run `fn` as one named undo step. */
  transaction<T>(label: string, fn: (doc: Document) => T): T;
  /** A formatted CSL bibliography (reference list) for the given cite keys, or all. */
  bibliography(citeKeys?: readonly string[], opts?: CiteOptions): string;
  /**
   * An inline citation — the formatted equivalent of `\citep` / `\citet` /
   * `\citeauthor`: parenthetical `(Author, Year)` by default; `Author (Year)` with
   * `textual: true` (or `mode: 'textual'`); author names only with `mode: 'author'`
   * (`allAuthors: true` lists every author). Optional `prenote` / `postnote`
   * insert text, e.g. `(see Smith, 2020, p. 4)`.
   */
  cite(
    citeKeys: readonly string[],
    opts?: CiteOptions & {
      textual?: boolean;
      mode?: 'parenthetical' | 'textual' | 'author';
      allAuthors?: boolean;
      prenote?: string;
      postnote?: string;
    },
  ): string;
}

/** Host-mediated file I/O (synchronous, raw paths). */
export interface ScriptIO {
  readText(path: string): string;
  writeText(path: string, text: string): void;
  exists(path: string): boolean;
}

export interface Bibliofile {
  readonly name: string;
  readonly version: string;
  /** The library the script was invoked against. */
  readonly activeDocument: Document;
  documents(): Document[];
  document(documentId: string): Document;
  /** Available CSL style ids (bundled + installed) for citation calls. */
  citationStyles(): string[];
  /** Read/write files (synchronous). Scripts run with the app's file access. */
  readonly io: ScriptIO;
  /**
   * A synchronous HTTP request. Prompts once per run for network access. Use
   * sparingly — a script can read your whole library.
   */
  fetch(
    url: string,
    opts?: { method?: string; headers?: Record<string, string>; body?: string },
  ): { status: number; headers: Record<string, string>; text: string };
  /**
   * Register a handler that runs after later changes to the active document.
   * It stays active until you run another script (which replaces it) or close
   * the document. Returns an unsubscribe function. Keep handlers quick — they run
   * on the main thread with no timeout.
   */
  onChange(fn: (change: { documentId: string }) => void): () => void;
}

declare global {
  // eslint-disable-next-line no-var
  var bibliofile: Bibliofile;
}
