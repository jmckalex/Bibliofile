/**
 * The renderer-facing bridge interface: what the preload script exposes on
 * `window.bibdesk` via `contextBridge.exposeInMainWorld`. The renderer programs
 * exclusively against this interface and never touches `ipcRenderer` or raw
 * channel names; the preload implements it by forwarding to `ipcRenderer.invoke`
 * (for the async methods) and `ipcRenderer.on` (for the event subscriptions),
 * all type-checked against {@link IpcContract} / {@link IpcEventMap}.
 */

import type {
  AddAttachmentRequest,
  ApplyEditRequest,
  CloseDocumentRequest,
  ClosedDocument,
  EditResult,
  FormatCitationRequest,
  FormatCitationResult,
  FtsSearchRequest,
  FtsSearchResponse,
  GetItemDetailRequest,
  ImportOnlineRequest,
  ItemDetail,
  RemoveAttachmentRequest,
  SearchOnlineRequest,
  SearchOnlineResponse,
  GetSettingsRequest,
  UpdateSettingsRequest,
  Settings,
  ReadAttachmentRequest,
  ReadAttachmentResponse,
  ExportTextRequest,
  ExportTextResponse,
  PasteEntriesRequest,
  ImportFilesRequest,
  ImportResult,
  FindReplaceRequest,
  FindReplaceResult,
  FindDuplicatesRequest,
  FindDuplicatesResult,
  MenuCommand,
  ListGroupsRequest,
  ListGroupsResponse,
  ListMacrosRequest,
  ListMacrosResponse,
  ListPublicationsRequest,
  ListPublicationsResponse,
  OpenedDocument,
  OpenExternalRequest,
  OpenExternalResult,
  SaveDocumentRequest,
  SaveDocumentResult,
} from './dto.js';

/** Unsubscribe handle returned by the event-subscription methods. */
export type Unsubscribe = () => void;

/**
 * The async + event API surface exposed to the renderer. All methods return
 * promises that resolve with structured-clone-safe DTOs (or reject if main
 * throws — e.g. unknown document id, file read error).
 */
export interface BibDeskApi {
  /** Open a `.bib` file by absolute path. Resolves once parsed. */
  openDocument(path: string): Promise<OpenedDocument>;

  /** Close a previously opened document and release its resources. */
  closeDocument(request: CloseDocumentRequest): Promise<ClosedDocument>;

  /** Fetch a page/range of publication rows for the virtualized table. */
  listPublications(
    request: ListPublicationsRequest,
  ): Promise<ListPublicationsResponse>;

  /** Fetch the groups sidebar tree (flat list joined via `parentId`). */
  listGroups(request: ListGroupsRequest): Promise<ListGroupsResponse>;

  /** Fetch one item's full detail for the detail/preview pane. */
  getItemDetail(request: GetItemDetailRequest): Promise<ItemDetail>;

  /** Open a URL in the browser, or a local file in its default app. */
  openExternal(request: OpenExternalRequest): Promise<OpenExternalResult>;

  /** Apply one edit command to a document; resolves with the new dirty state. */
  applyEdit(request: ApplyEditRequest): Promise<EditResult>;

  /** List a document's `@string` macros (for the macro editor). */
  listMacros(request: ListMacrosRequest): Promise<ListMacrosResponse>;

  /** Save the document to disk (explicit save + `.bak` backup). */
  saveDocument(request: SaveDocumentRequest): Promise<SaveDocumentResult>;

  /** Format one item as a CSL-styled citation (HTML). */
  formatCitation(request: FormatCitationRequest): Promise<FormatCitationResult>;

  /** Add attachment(s) to an item (opens a file picker in main). */
  addAttachment(request: AddAttachmentRequest): Promise<EditResult>;

  /** Remove one managed attachment (`Bdsk-File-N`) from an item. */
  removeAttachment(request: RemoveAttachmentRequest): Promise<EditResult>;

  /** Search an online source (CrossRef / arXiv). */
  searchOnline(request: SearchOnlineRequest): Promise<SearchOnlineResponse>;

  /** Import an online result into the document as a new entry. */
  importOnline(request: ImportOnlineRequest): Promise<EditResult>;

  /** Full-text search the document (SQLite FTS5; falls back when unavailable). */
  ftsSearch(request: FtsSearchRequest): Promise<FtsSearchResponse>;

  /** Read the current application preferences. */
  getSettings(request: GetSettingsRequest): Promise<Settings>;

  /** Update preferences with a partial patch; resolves with the merged settings. */
  updateSettings(request: UpdateSettingsRequest): Promise<Settings>;

  /** Subscribe to "open Preferences" requests from the menu. Returns unsubscribe. */
  onShowPreferences(listener: () => void): Unsubscribe;

  /** Read an attachment's bytes (for the in-app PDF viewer). */
  readAttachment(request: ReadAttachmentRequest): Promise<ReadAttachmentResponse>;

  /** Serialize a document (or a subset of items) to text — e.g. BibTeX export/copy. */
  exportText(request: ExportTextRequest): Promise<ExportTextResponse>;

  /** Paste BibTeX text into the document as new entries (parse + merge). */
  pasteEntries(request: PasteEntriesRequest): Promise<ImportResult>;

  /** Import dropped files: `.bib` merge; other files become an entry + attachment. */
  importFiles(request: ImportFilesRequest): Promise<ImportResult>;

  /** Find/replace over field values; preview (apply=false) or perform (apply=true). */
  findReplace(request: FindReplaceRequest): Promise<FindReplaceResult>;

  /** Scan the document for duplicate entries (identical cite keys + equivalent content). */
  findDuplicates(request: FindDuplicatesRequest): Promise<FindDuplicatesResult>;

  /**
   * Resolve a dropped {@link File} to its absolute filesystem path (Electron's
   * `webUtils.getPathForFile`). Synchronous; renderer-only (the File can't cross IPC).
   */
  pathForFile(file: File): string;

  /** Subscribe to native-menu commands that act on renderer state. Returns unsubscribe. */
  onMenuCommand(listener: (command: MenuCommand) => void): Unsubscribe;

  /**
   * Subscribe to "document opened" notifications (e.g. file→open from the menu,
   * CLI arg, or macOS `open-file`). Returns an unsubscribe function.
   */
  onDocumentOpened(listener: (doc: OpenedDocument) => void): Unsubscribe;

  /** Subscribe to "document closed" notifications. Returns an unsubscribe fn. */
  onDocumentClosed(listener: (doc: ClosedDocument) => void): Unsubscribe;
}

/**
 * Global augmentation so the renderer can use `window.bibdesk` with full types
 * once the preload has exposed it. Import this module anywhere in the renderer
 * (e.g. a single `import '@bibdesk/shared'`) to pull in the declaration.
 */
declare global {
  interface Window {
    /** The BibDesk bridge, present only after preload runs. */
    bibdesk: BibDeskApi;
  }
}
