/**
 * Shared, stable type vocabulary for the BibDesk plugin SDK.
 *
 * These are the data shapes a plugin author (or the Claude scripting assistant,
 * whose tool-calls flow through this same surface) deals with: plugin manifests,
 * the change-event payload broadcast after every mutation, and the lightweight
 * plain-object shapes used to *create* entries and read author/attachment lists.
 *
 * Everything here is platform-agnostic (no Electron, DOM, or Node APIs). Field
 * values are accepted as plain strings at the API boundary and as the model's
 * richer {@link FieldValue} (string | macro/complex value) internally; authors
 * pass strings, the SDK normalizes.
 */

import type { FieldValue } from '@bibdesk/model';
import type { PluginApi } from './plugin-api.js';

/** Re-exported so plugin authors can type complex/macro values without reaching into `@bibdesk/model`. */
export type { FieldValue };

/**
 * What changed in the library, broadcast on {@link PluginApi.onChange} after any
 * mutation completes. Mutations that touch a single entry carry its `entryId`;
 * library-wide mutations (import, macro changes) may omit it.
 */
export type LibraryChangeKind =
  | 'field' // a field was set or removed on an entry
  | 'citeKey' // an entry's cite key changed
  | 'type' // an entry's type changed
  | 'addEntry' // a new entry was added (manually or via duplicate)
  | 'deleteEntry' // an entry was removed
  | 'import' // one or more entries were merged in from BibTeX text
  | 'macro'; // a macro was defined, changed, or removed

/**
 * Payload delivered to {@link ChangeListener}s. Intentionally small and
 * structured-clone-safe so it can cross an IPC boundary or be logged for an
 * assistant transcript.
 */
export interface LibraryChangeEvent {
  /** The kind of mutation that just occurred. */
  readonly kind: LibraryChangeKind;
  /** Stable id of the affected entry, when the change is entry-scoped. */
  readonly entryId?: string;
  /** Canonical field name, for `field` changes. */
  readonly field?: string;
  /** Macro name, for `macro` changes. */
  readonly macro?: string;
  /** Entry ids added, for `import` (and convenience on `addEntry`). */
  readonly addedIds?: readonly string[];
}

/** A listener for {@link LibraryChangeEvent}s. */
export type ChangeListener = (event: LibraryChangeEvent) => void;

/** Unsubscribe handle returned by {@link PluginApi.onChange}. */
export type Unsubscribe = () => void;

/**
 * The fields needed to create a new entry via {@link PluginApi.addEntry}. Field
 * names may be given in any casing (normalized to canonical); values are plain
 * strings (or the model's complex {@link FieldValue}). A `citeKey` is optional —
 * when omitted (or when it collides) the SDK generates a unique one.
 */
export interface NewEntryData {
  /** BibTeX entry type (e.g. `article`); lowercased on store. Defaults to `misc`. */
  type?: string;
  /** Optional desired cite key; made unique within the library if it collides. */
  citeKey?: string;
  /** Initial fields, by name (any casing) -> value (string or complex). */
  fields?: Record<string, FieldValue>;
}

/** A parsed author/editor, projected to a plain object for plugin consumers. */
export interface AuthorInfo {
  /** Display form: "First von Last, Jr" with TeX removed. */
  readonly displayName: string;
  /** Given/first names (already de-TeXified). */
  readonly first: string;
  /** The "von" particle, if any. */
  readonly von: string;
  /** Family/last name. */
  readonly last: string;
  /** Junior/suffix, if any. */
  readonly jr: string;
}

/** Which family of file/URL a {@link AttachmentInfo} field belongs to. */
export type AttachmentKind = 'localFile' | 'remoteURL';

/**
 * A cite-key'd file/URL field detected on an entry — i.e. BibDesk's
 * `Local-Url` / `Url` / `Bdsk-Url-N` / `Bdsk-File-N` style attachment fields,
 * surfaced uniformly. The `value` is the raw stored string (a path or URL).
 */
export interface AttachmentInfo {
  /** Canonical field name the attachment lives in. */
  readonly field: string;
  /** Local file vs. remote URL classification (from the type manager). */
  readonly kind: AttachmentKind;
  /** Raw stored value: a file path (local) or URL (remote). */
  readonly value: string;
}

/**
 * A plugin's manifest + lifecycle. The minimal real shape: identity (`name` +
 * `version`), a required `activate(api)` called when the plugin is turned on,
 * and an optional `deactivate()` for teardown.
 */
export interface Plugin {
  /** Unique plugin name (used as the registry key). */
  readonly name: string;
  /** Semver-ish version string (informational). */
  readonly version: string;
  /** Optional human-readable description. */
  readonly description?: string;
  /** Called when the plugin is activated against a {@link PluginApi}. */
  activate(api: PluginApi): void | Promise<void>;
  /** Called when the plugin is deactivated (optional teardown). */
  deactivate?(): void | Promise<void>;
}

/** Options accepted by {@link createPluginApi}. */
export interface PluginApiOptions {
  /**
   * Cite-key format string used by `generateCiteKey` / `addEntry` /
   * `duplicateEntry`. Defaults to {@link DEFAULT_CITE_KEY_FORMAT} from
   * `@bibdesk/formats`.
   */
  citeKeyFormat?: string;
}
