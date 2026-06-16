/**
 * `Entry` — a thin, read-oriented wrapper around a `@bibdesk/model` {@link BibItem}.
 *
 * The wrapper exists so plugin authors (and the Claude scripting assistant) get a
 * small, stable, *display-aware* surface without depending on the full model
 * class or having to remember to de-TeXify field text themselves. It owns no
 * state beyond the underlying `BibItem` and a back-reference to the bibtex
 * library (needed only for `toBibTeX`, which must thread the managed-attachment
 * plists).
 *
 * Reads only: every mutating operation lives on {@link PluginApi} so that all
 * writes funnel through one place that maintains cite-key uniqueness and fires
 * change events. (`PluginApi.setField(entry.id, …)` is the mutation path.)
 */

import type { BibItem } from '@bibdesk/model';
import type { BibLibrary } from '@bibdesk/bibtex';
import { serializeEntry } from '@bibdesk/bibtex';
import { detexify } from '@bibdesk/tex';
import type { AttachmentInfo, AuthorInfo } from './types.js';

export class Entry {
  /**
   * @param item    the wrapped model object (source of truth)
   * @param library the bibtex library, used only to resolve `bdsk-file-N` plists
   *                when serializing a single entry
   */
  constructor(
    private readonly item: BibItem,
    private readonly library: BibLibrary,
  ) {}

  /** The wrapped model object, for callers that need the full model surface. */
  get bibItem(): BibItem {
    return this.item;
  }

  /** Stable, cite-key-independent id (the model UUID). */
  get id(): string {
    return this.item.id;
  }

  /** The BibTeX cite key. */
  get citeKey(): string {
    return this.item.citeKey;
  }

  /** The (lowercased) entry type, e.g. `article`. */
  get type(): string {
    return this.item.type;
  }

  /** Canonical names of the fields currently set on this entry. */
  fieldNames(): string[] {
    return this.item.fieldNames();
  }

  /**
   * Raw stored string value of a field (case-insensitive name). Complex/macro
   * values are expanded against the library's macro resolver, matching how the
   * model's `stringValueOfField` behaves. Returns `''` when unset. Pass
   * `inherit` to fall back to a crossref parent.
   */
  field(name: string, inherit = false): string {
    return this.item.stringValueOfField(name, inherit);
  }

  /**
   * Display value of a field: {@link field} run through `detexify`, so TeX
   * accents/escapes (`{\'e}`, `\&`, …) become Unicode. Use this for anything
   * shown to a human or returned to an assistant as prose.
   */
  displayField(name: string, inherit = false): string {
    return detexify(this.item.stringValueOfField(name, inherit));
  }

  /** Parsed authors of the `Author` field (or another person field), de-TeXified. */
  authors(field = 'Author', inherit = false): AuthorInfo[] {
    return this.item.peopleForField(field, inherit).map((a) => ({
      displayName: a.displayName,
      first: a.first,
      von: a.von,
      last: a.last,
      jr: a.jr,
    }));
  }

  /**
   * Cite-key'd file/URL attachment fields on this entry. Scans the entry's
   * fields and classifies each via the model's type manager into local-file or
   * remote-URL attachments. Empty fields are skipped.
   */
  attachments(): AttachmentInfo[] {
    const tm = this.item.typeManager;
    const out: AttachmentInfo[] = [];
    for (const name of this.item.fieldNames()) {
      const isLocal = tm.isLocalFileField(name);
      const isRemote = tm.isRemoteURLField(name);
      if (!isLocal && !isRemote) continue;
      const value = this.item.stringValueOfField(name, false);
      if (value.trim() === '') continue;
      out.push({
        field: name,
        kind: isLocal ? 'localFile' : 'remoteURL',
        value,
      });
    }
    return out;
  }

  /**
   * Serialize just this entry to canonical BibDesk BibTeX (threading any
   * `bdsk-file-N` managed-attachment plists held by the library).
   */
  toBibTeX(): string {
    return serializeEntry(this.item, this.library.bdskFiles);
  }

  /** Plain-object snapshot (id, citeKey, type, fields, files, dates). */
  toJSON(): ReturnType<BibItem['toJSON']> {
    return this.item.toJSON();
  }
}
