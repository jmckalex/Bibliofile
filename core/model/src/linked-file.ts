/**
 * `LinkedFile` — the model-level representation of BibDesk's `BDSKLinkedFile`
 * (linked local file or remote URL attached to an item).
 *
 * The model is pure and does no I/O, so a linked file is just data: whether it
 * is a local file or a remote URL, plus the URL/path strings. Resolution of
 * relative paths, base64 round-tripping through the `Bdsk-File-N` pseudo-fields,
 * Skim notes, etc. are the responsibility of the bibtex/app layers.
 */
export interface LinkedFile {
  /** `file` — a local file reference; `url` — a remote URL. */
  readonly kind: 'file' | 'url';
  /**
   * The URL string. For a remote URL this is the absolute URL; for a local file
   * this is a `file://` URL (or an app-resolved absolute path). The model
   * stores it verbatim.
   */
  readonly url: string;
  /**
   * Optional relative path (for local files stored relative to the document).
   * Round-tripping/redirection is handled by the app layer.
   */
  readonly relativePath?: string;
}

/** Build a local-file {@link LinkedFile}. */
export function localFile(url: string, relativePath?: string): LinkedFile {
  return relativePath !== undefined
    ? { kind: 'file', url, relativePath }
    : { kind: 'file', url };
}

/** Build a remote-URL {@link LinkedFile}. */
export function remoteURL(url: string): LinkedFile {
  return { kind: 'url', url };
}
