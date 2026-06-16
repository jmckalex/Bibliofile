/**
 * @bibdesk/plugins-sdk — the pure JavaScript plugin API for the BibDesk Electron
 * port.
 *
 * This package is the single, STABLE surface through which third-party JS
 * plugins/scripts AND a future Claude scripting assistant operate on a
 * bibliography. It wraps an in-memory `@bibdesk/bibtex` `BibLibrary` and exposes:
 *
 *   - {@link PluginApi} / {@link createPluginApi} — query, mutate, macros,
 *     library-level operations (import/serialize/duplicate-detection) and a
 *     change-event channel. Every write keeps cite keys unique and emits.
 *   - {@link Entry} — a display-aware, read-only wrapper over a model `BibItem`
 *     (de-TeXified field/author accessors, attachments, per-entry BibTeX).
 *   - {@link definePlugin} / {@link PluginManager} — the manifest + lifecycle
 *     model used to register, activate, and deactivate plugins against a
 *     `PluginApi`.
 *
 * Pure: no Electron, DOM, or Node (`node:fs`) APIs. Built ON the `@bibdesk/*`
 * core libraries rather than reimplementing them.
 */

// --- Core API ---------------------------------------------------------------
export { PluginApi, createPluginApi } from './plugin-api.js';

// --- Entry wrapper ----------------------------------------------------------
export { Entry } from './entry.js';

// --- Plugin model -----------------------------------------------------------
export { definePlugin, PluginManager } from './plugin-manager.js';

// --- Types ------------------------------------------------------------------
export type {
  Plugin,
  PluginApiOptions,
  NewEntryData,
  AuthorInfo,
  AttachmentInfo,
  AttachmentKind,
  LibraryChangeEvent,
  LibraryChangeKind,
  ChangeListener,
  Unsubscribe,
  FieldValue,
} from './types.js';
