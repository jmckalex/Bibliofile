/**
 * IPC channel-name constants for the read-only viewer.
 *
 * All channels are namespaced under the `bibdesk:` prefix so they never collide
 * with Electron's own internal channels or any future plugin channels. These are
 * the *string keys* used by `ipcMain.handle(...)` / `ipcRenderer.invoke(...)` in
 * the main and preload processes; the renderer never sees them directly (it talks
 * to the typed {@link BibDeskApi} bridge instead).
 *
 * Two kinds of channel exist:
 *  - **request/response** channels (invoked via `ipcRenderer.invoke`) — see
 *    {@link IpcContract};
 *  - **event** channels (pushed from main via `webContents.send`) — see
 *    {@link IpcEventMap}.
 */

/** Namespace prefix applied to every BibDesk IPC channel. */
export const IPC_NAMESPACE = 'bibdesk' as const;

/**
 * Request/response (invoke) channels. Each maps to one entry in
 * {@link IpcContract}. Frozen so the object cannot be mutated at runtime.
 */
export const IpcChannels = {
  /** Open a `.bib` file by absolute path. */
  openDocument: 'bibdesk:openDocument',
  /** Close a previously opened document by id. */
  closeDocument: 'bibdesk:closeDocument',
  /** List a page/range of publications as thin row view-models. */
  listPublications: 'bibdesk:listPublications',
  /** List the groups sidebar tree for a document. */
  listGroups: 'bibdesk:listGroups',
  /** Get the full detail (fields + files + preview) of one item. */
  getItemDetail: 'bibdesk:getItemDetail',
  /** Open a URL or local file in the OS default handler. */
  openExternal: 'bibdesk:openExternal',
  /** Apply one edit command (mutate the in-memory model). */
  applyEdit: 'bibdesk:applyEdit',
  /** Apply a bulk operation to a set of selected items (one undo step). */
  batchEdit: 'bibdesk:batchEdit',
  /** List a document's `@string` macros. */
  listMacros: 'bibdesk:listMacros',
  /** Save a document to disk (explicit save + backup). */
  saveDocument: 'bibdesk:saveDocument',
  /** Format one item as a CSL-styled citation (HTML). */
  formatCitation: 'bibdesk:formatCitation',
  /** Copy one item's formatted citation to the clipboard as RTF (+ plain text). */
  copyRtf: 'bibdesk:copyRtf',
  /** Resolve an item's journal cover thumbnail (by ISSN / journal name). */
  journalCover: 'bibdesk:journalCover',
  /** Add attachment(s) to an item (main opens a file picker). */
  addAttachment: 'bibdesk:addAttachment',
  /** Remove one managed attachment from an item. */
  removeAttachment: 'bibdesk:removeAttachment',
  /** Search an online source (CrossRef / arXiv). */
  searchOnline: 'bibdesk:searchOnline',
  /** Import an online result as a new entry. */
  importOnline: 'bibdesk:importOnline',
  /** Full-text search a document (SQLite FTS5). */
  ftsSearch: 'bibdesk:ftsSearch',
  /** Read application preferences. */
  getSettings: 'bibdesk:getSettings',
  /** Update (patch) application preferences. */
  updateSettings: 'bibdesk:updateSettings',
  /** Read an attachment's bytes (for in-app PDF preview). */
  readAttachment: 'bibdesk:readAttachment',
  /** Serialize a document (or a subset of items) to text in a given format. */
  exportText: 'bibdesk:exportText',
  /** Paste BibTeX text into a document (parse + merge as new entries). */
  pasteEntries: 'bibdesk:pasteEntries',
  /** Import dropped files (`.bib` merge; other files → entry + attachment). */
  importFiles: 'bibdesk:importFiles',
  /** Open a file picker (main) and import the chosen `.bib`/`.ris`/other files. */
  importDialog: 'bibdesk:importDialog',
  /** Find/replace over field values (preview or apply). */
  findReplace: 'bibdesk:findReplace',
  /** Scan a document for duplicate entries (cite-key + equivalent content). */
  findDuplicates: 'bibdesk:findDuplicates',
  /** Create/rename/delete a group or change a static group's membership. */
  groupEdit: 'bibdesk:groupEdit',
  /** Read back a smart group's name/conjunction/conditions (for the editor). */
  groupConditions: 'bibdesk:groupConditions',
  /** Distinct existing values for a field (editor autocomplete). */
  fieldSuggestions: 'bibdesk:fieldSuggestions',
  /** AutoFile an item's attachments into the Papers folder. */
  autoFile: 'bibdesk:autoFile',
  /** Open a folder picker (e.g. choosing the Papers folder). */
  chooseFolder: 'bibdesk:chooseFolder',
  /** Whether the Anthropic API key is stored (Claude assistant). */
  agentKeyStatus: 'bibdesk:agentKeyStatus',
  /** Store/clear the Anthropic API key (via safeStorage). */
  agentSetKey: 'bibdesk:agentSetKey',
  /** Run one assistant turn for the open document. */
  agentRun: 'bibdesk:agentRun',
  /** Reset the assistant conversation for a document. */
  agentReset: 'bibdesk:agentReset',
} as const;

/**
 * Event (push) channels. Main → renderer notifications with no reply. Each maps
 * to one entry in {@link IpcEventMap}.
 */
export const IpcEvents = {
  /** A document finished opening (or was reloaded). */
  documentOpened: 'bibdesk:event:documentOpened',
  /** A document was closed and its id is no longer valid. */
  documentClosed: 'bibdesk:event:documentClosed',
  /** Request the renderer to open the Preferences pane (from the menu). */
  showPreferences: 'bibdesk:event:showPreferences',
  /** A native-menu item that acts on renderer state (see {@link MenuCommand}). */
  menuCommand: 'bibdesk:event:menuCommand',
  /** View→Columns toggle: payload is the column key to show/hide. */
  menuToggleColumn: 'bibdesk:event:menuToggleColumn',
} as const;

/** Union of all request/response channel-name string-literal values. */
export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

/** Union of all event channel-name string-literal values. */
export type IpcEventChannel = (typeof IpcEvents)[keyof typeof IpcEvents];

/**
 * Build a namespaced channel name. Tiny pure helper for any ad-hoc channel a
 * future feature might add, so the `bibdesk:` prefix stays in one place.
 *
 * @example channelName('exportSelection') // => 'bibdesk:exportSelection'
 */
export function channelName(name: string): string {
  return `${IPC_NAMESPACE}:${name}`;
}

/** Type guard: is `value` one of the known request/response channels? */
export function isIpcChannel(value: unknown): value is IpcChannel {
  return (
    typeof value === 'string' &&
    (Object.values(IpcChannels) as string[]).includes(value)
  );
}

/** Type guard: is `value` one of the known event channels? */
export function isIpcEventChannel(value: unknown): value is IpcEventChannel {
  return (
    typeof value === 'string' &&
    (Object.values(IpcEvents) as string[]).includes(value)
  );
}
