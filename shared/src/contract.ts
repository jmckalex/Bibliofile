/**
 * The typed IPC contract: a single source of truth mapping each channel name to
 * its request and response payload types. Both the main process (`ipcMain.handle`)
 * and the preload bridge (`ipcRenderer.invoke`) constrain themselves against this
 * map so handler signatures and call sites are checked end-to-end.
 */

import type { IpcChannels, IpcEvents } from './channels.js';
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
  ListGroupsRequest,
  ListGroupsResponse,
  ListMacrosRequest,
  ListMacrosResponse,
  ListPublicationsRequest,
  ListPublicationsResponse,
  OpenDocumentRequest,
  OpenedDocument,
  OpenExternalRequest,
  OpenExternalResult,
  SaveDocumentRequest,
  SaveDocumentResult,
} from './dto.js';

/** One entry in the contract: the request payload and the response payload. */
export interface IpcEntry<Req, Res> {
  readonly request: Req;
  readonly response: Res;
}

/**
 * Request/response contract. Keyed by the channel-name string-literal *values*
 * from {@link IpcChannels} so a handler/invoker can be typed as
 * `IpcContract[typeof IpcChannels.openDocument]`.
 */
export interface IpcContract {
  [IpcChannels.openDocument]: IpcEntry<OpenDocumentRequest, OpenedDocument>;
  [IpcChannels.closeDocument]: IpcEntry<CloseDocumentRequest, ClosedDocument>;
  [IpcChannels.listPublications]: IpcEntry<
    ListPublicationsRequest,
    ListPublicationsResponse
  >;
  [IpcChannels.listGroups]: IpcEntry<ListGroupsRequest, ListGroupsResponse>;
  [IpcChannels.getItemDetail]: IpcEntry<GetItemDetailRequest, ItemDetail>;
  [IpcChannels.openExternal]: IpcEntry<OpenExternalRequest, OpenExternalResult>;
  [IpcChannels.applyEdit]: IpcEntry<ApplyEditRequest, EditResult>;
  [IpcChannels.listMacros]: IpcEntry<ListMacrosRequest, ListMacrosResponse>;
  [IpcChannels.saveDocument]: IpcEntry<SaveDocumentRequest, SaveDocumentResult>;
  [IpcChannels.formatCitation]: IpcEntry<FormatCitationRequest, FormatCitationResult>;
  [IpcChannels.addAttachment]: IpcEntry<AddAttachmentRequest, EditResult>;
  [IpcChannels.removeAttachment]: IpcEntry<RemoveAttachmentRequest, EditResult>;
  [IpcChannels.searchOnline]: IpcEntry<SearchOnlineRequest, SearchOnlineResponse>;
  [IpcChannels.importOnline]: IpcEntry<ImportOnlineRequest, EditResult>;
  [IpcChannels.ftsSearch]: IpcEntry<FtsSearchRequest, FtsSearchResponse>;
  [IpcChannels.getSettings]: IpcEntry<GetSettingsRequest, Settings>;
  [IpcChannels.updateSettings]: IpcEntry<UpdateSettingsRequest, Settings>;
  [IpcChannels.readAttachment]: IpcEntry<ReadAttachmentRequest, ReadAttachmentResponse>;
}

/**
 * Event (push) contract. Keyed by the channel-name values from
 * {@link IpcEvents}; the value is the single payload `webContents.send` carries.
 */
export interface IpcEventMap {
  [IpcEvents.documentOpened]: OpenedDocument;
  [IpcEvents.documentClosed]: ClosedDocument;
  [IpcEvents.showPreferences]: null;
}

/** Request payload type for a given request/response channel. */
export type RequestOf<C extends keyof IpcContract> = IpcContract[C]['request'];

/** Response payload type for a given request/response channel. */
export type ResponseOf<C extends keyof IpcContract> =
  IpcContract[C]['response'];

/** Payload type for a given event channel. */
export type EventPayloadOf<C extends keyof IpcEventMap> = IpcEventMap[C];

/**
 * Shape of a main-process handler for a channel, mirroring the function passed to
 * `ipcMain.handle`. Returns the response (or a promise of it); the leading
 * `IpcInvokeEvent` from Electron is intentionally elided here (this package is
 * Electron-free) — main wraps these with the real event arg.
 */
export type IpcHandler<C extends keyof IpcContract> = (
  request: RequestOf<C>,
) => ResponseOf<C> | Promise<ResponseOf<C>>;

/** A complete, type-checked set of handlers, one per request/response channel. */
export type IpcHandlers = {
  [C in keyof IpcContract]: IpcHandler<C>;
};
