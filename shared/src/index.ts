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
} from './dto.js';

// --- Renderer-facing bridge -------------------------------------------------
/** The `window.bibdesk` API the preload exposes and the renderer consumes. */
export { type BibDeskApi, type Unsubscribe } from './api.js';

// --- DTO guards -------------------------------------------------------------
/** Shallow runtime guards for validating DTOs at the IPC boundary. */
export { isPublicationRow, isGroupNode } from './guards.js';
