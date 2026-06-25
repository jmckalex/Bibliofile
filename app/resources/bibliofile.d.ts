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
}

export interface Bibliofile {
  readonly name: string;
  readonly version: string;
  /** The library the script was invoked against. */
  readonly activeDocument: Document;
  documents(): Document[];
  document(documentId: string): Document;
}

declare global {
  // eslint-disable-next-line no-var
  var bibliofile: Bibliofile;
}
