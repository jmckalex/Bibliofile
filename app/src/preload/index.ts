/**
 * Preload bridge — exposes a typed {@link BibDeskApi} on `window.bibdesk`.
 *
 * The renderer talks ONLY to this surface (contextIsolation on, node integration
 * off). Each method forwards to main via `ipcRenderer.invoke` on the matching
 * `@bibdesk/shared` channel; the two document-lifecycle events are delivered via
 * `ipcRenderer.on` and return an unsubscribe.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  IpcChannels,
  IpcEvents,
  type BibDeskApi,
  type Unsubscribe,
  type OpenedDocument,
  type ClosedDocument,
  type CloseDocumentRequest,
  type ListPublicationsRequest,
  type ListPublicationsResponse,
  type ListGroupsRequest,
  type ListGroupsResponse,
  type GetItemDetailRequest,
  type ItemDetail,
  type OpenExternalRequest,
  type OpenExternalResult,
  type ApplyEditRequest,
  type EditResult,
  type ListMacrosRequest,
  type ListMacrosResponse,
  type SaveDocumentRequest,
  type SaveDocumentResult,
} from '@bibdesk/shared';

const api: BibDeskApi = {
  openDocument(path: string): Promise<OpenedDocument> {
    return ipcRenderer.invoke(IpcChannels.openDocument, { path });
  },
  closeDocument(request: CloseDocumentRequest): Promise<ClosedDocument> {
    return ipcRenderer.invoke(IpcChannels.closeDocument, request);
  },
  listPublications(request: ListPublicationsRequest): Promise<ListPublicationsResponse> {
    return ipcRenderer.invoke(IpcChannels.listPublications, request);
  },
  listGroups(request: ListGroupsRequest): Promise<ListGroupsResponse> {
    return ipcRenderer.invoke(IpcChannels.listGroups, request);
  },
  getItemDetail(request: GetItemDetailRequest): Promise<ItemDetail> {
    return ipcRenderer.invoke(IpcChannels.getItemDetail, request);
  },
  openExternal(request: OpenExternalRequest): Promise<OpenExternalResult> {
    return ipcRenderer.invoke(IpcChannels.openExternal, request);
  },
  applyEdit(request: ApplyEditRequest): Promise<EditResult> {
    return ipcRenderer.invoke(IpcChannels.applyEdit, request);
  },
  listMacros(request: ListMacrosRequest): Promise<ListMacrosResponse> {
    return ipcRenderer.invoke(IpcChannels.listMacros, request);
  },
  saveDocument(request: SaveDocumentRequest): Promise<SaveDocumentResult> {
    return ipcRenderer.invoke(IpcChannels.saveDocument, request);
  },
  onDocumentOpened(listener: (doc: OpenedDocument) => void): Unsubscribe {
    const handler = (_e: IpcRendererEvent, doc: OpenedDocument): void => listener(doc);
    ipcRenderer.on(IpcEvents.documentOpened, handler);
    return () => ipcRenderer.removeListener(IpcEvents.documentOpened, handler);
  },
  onDocumentClosed(listener: (doc: ClosedDocument) => void): Unsubscribe {
    const handler = (_e: IpcRendererEvent, doc: ClosedDocument): void => listener(doc);
    ipcRenderer.on(IpcEvents.documentClosed, handler);
    return () => ipcRenderer.removeListener(IpcEvents.documentClosed, handler);
  },
};

contextBridge.exposeInMainWorld('bibdesk', api);
