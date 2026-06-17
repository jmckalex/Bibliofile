/**
 * @bibdesk/shared
 *
 * Typed IPC contract + structured-clone-safe DTOs shared by the Electron main
 * process and the React renderer for the read-only BibDesk viewer.
 *
 * Environment-neutral: no Electron, DOM, or Node runtime APIs — pure TypeScript
 * types plus a few tiny pure helpers/constants. Every DTO is a plain value
 * (objects/arrays/strings/numbers/booleans/null; dates as ISO strings) so it
 * survives `structuredClone` across the IPC boundary.
 *
 * Usage:
 *  - **main**: implement `IpcHandlers` and register each via `ipcMain.handle`
 *    keyed by `IpcChannels.*`; push events with `webContents.send` keyed by
 *    `IpcEvents.*` (payloads typed by `IpcEventMap`).
 *  - **preload**: implement `BibDeskApi`, forwarding to `ipcRenderer.invoke` /
 *    `ipcRenderer.on`; expose it on `window.bibdesk` via `contextBridge`.
 *  - **renderer**: program against `BibDeskApi` / `window.bibdesk` and the DTOs.
 */

// --- Channels + helpers -----------------------------------------------------
/** Channel-name constants, channel unions, and channel helpers/guards. */
export {
  IPC_NAMESPACE,
  IpcChannels,
  IpcEvents,
  channelName,
  isIpcChannel,
  isIpcEventChannel,
  type IpcChannel,
  type IpcEventChannel,
} from './channels.js';

// --- Contract (channel → request/response/event) ----------------------------
/** The typed request/response + event maps and handler helper types. */
export {
  type IpcEntry,
  type IpcContract,
  type IpcEventMap,
  type RequestOf,
  type ResponseOf,
  type EventPayloadOf,
  type IpcHandler,
  type IpcHandlers,
} from './contract.js';

// --- DTOs --------------------------------------------------------------------
/** All structured-clone-safe payload/view-model types. */
export {
  type DocumentId,
  type ItemId,
  type ParseWarning,
  type OpenDocumentRequest,
  type OpenedDocument,
  type CloseDocumentRequest,
  type ClosedDocument,
  type OpenExternalRequest,
  type OpenExternalResult,
  type SortDirection,
  type SortSpec,
  type ListPublicationsRequest,
  type PublicationRow,
  type ListPublicationsResponse,
  type GroupKind,
  type ListGroupsRequest,
  type GroupNode,
  type ListGroupsResponse,
  type GetItemDetailRequest,
  type ItemField,
  type ItemFile,
  type ItemDetail,
  type EditCommand,
  type ApplyEditRequest,
  type EditResult,
  type MacroDef,
  type ListMacrosRequest,
  type ListMacrosResponse,
  type SaveDocumentRequest,
  type SaveDocumentResult,
  type CitationStyle,
  CITATION_STYLES,
  type FormatCitationRequest,
  type FormatCitationResult,
  type AddAttachmentRequest,
  type RemoveAttachmentRequest,
  type OnlineSource,
  ONLINE_SOURCES,
  type OnlineResult,
  type SearchOnlineRequest,
  type SearchOnlineResponse,
  type ImportOnlineRequest,
  type FtsSearchRequest,
  type FtsSearchResponse,
  type FieldTypeSettings,
  type CustomEntryType,
  type CustomEntryTypes,
  type Settings,
  DEFAULT_SETTINGS,
  BUILTIN_COLUMNS,
  type GetSettingsRequest,
  type UpdateSettingsRequest,
  type EntryTypeInfo,
  type ListEntryTypesResponse,
  type ReadAttachmentRequest,
  type ReadAttachmentResponse,
  type ExportFormat,
  type ExportTextRequest,
  type ExportTextResponse,
  type PrintRequest,
  type PrintResponse,
  type ExportSelectionRequest,
  type ExportSelectionResponse,
  type PasteEntriesRequest,
  type ImportFilesRequest,
  type ImportDialogRequest,
  type ImportResult,
  type FieldKind,
  type CopyRtfRequest,
  type CopyRtfResponse,
  type JournalCoverRequest,
  type JournalCoverResponse,
  type BatchOp,
  type BatchEditRequest,
  type BatchEditResult,
  type FindReplaceRequest,
  type FindReplaceMatch,
  type FindReplaceResult,
  type FindDuplicatesRequest,
  type FindDuplicatesResult,
  type DuplicateGroup,
  type DuplicateEntry,
  type BrokenLink,
  type FindBrokenLinksRequest,
  type FindBrokenLinksResponse,
  type RelocateAttachmentRequest,
  type SmartCondition,
  type GroupCommand,
  type GroupEditRequest,
  type GroupEditResult,
  type GroupConditionsRequest,
  type GroupConditionsResponse,
  type RenameAuthorRequest,
  type RenameAuthorResult,
  type OpenEditorRequest,
  type DocumentChangedEvent,
  type FieldSuggestionsRequest,
  type FieldSuggestionsResponse,
  type AutoFileRequest,
  type AutoFileResult,
  type ConsolidateRequest,
  type ConsolidateResult,
  type ChooseFolderResponse,
  type AgentKeyStatus,
  type AgentSetKeyRequest,
  type AgentRunRequest,
  type AgentRunResponse,
  type MenuCommand,
} from './dto.js';

// --- Renderer-facing bridge -------------------------------------------------
/** The `window.bibdesk` API the preload exposes and the renderer consumes. */
export { type BibDeskApi, type Unsubscribe } from './api.js';

// --- DTO guards -------------------------------------------------------------
/** Shallow runtime guards for validating DTOs at the IPC boundary. */
export { isPublicationRow, isGroupNode } from './guards.js';

// --- Cite-command formatting ------------------------------------------------
export { formatCiteCommand } from './cite.js';
