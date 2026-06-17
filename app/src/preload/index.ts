/**
 * Preload bridge — exposes a typed {@link BibDeskApi} on `window.bibdesk`.
 *
 * The renderer talks ONLY to this surface (contextIsolation on, node integration
 * off). Each method forwards to main via `ipcRenderer.invoke` on the matching
 * `@bibdesk/shared` channel; the two document-lifecycle events are delivered via
 * `ipcRenderer.on` and return an unsubscribe.
 */

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';

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
  type FormatCitationRequest,
  type FormatCitationResult,
  type AddAttachmentRequest,
  type RemoveAttachmentRequest,
  type SearchOnlineRequest,
  type SearchOnlineResponse,
  type ImportOnlineRequest,
  type FtsSearchRequest,
  type FtsSearchResponse,
  type GetSettingsRequest,
  type UpdateSettingsRequest,
  type Settings,
  type ReadAttachmentRequest,
  type ReadAttachmentResponse,
  type ExportTextRequest,
  type ExportTextResponse,
  type PasteEntriesRequest,
  type ImportFilesRequest,
  type ImportDialogRequest,
  type ImportResult,
  type FindReplaceRequest,
  type FindReplaceResult,
  type FindDuplicatesRequest,
  type FindDuplicatesResult,
  type GroupEditRequest,
  type GroupEditResult,
  type FieldSuggestionsRequest,
  type FieldSuggestionsResponse,
  type AutoFileRequest,
  type AutoFileResult,
  type ChooseFolderResponse,
  type AgentKeyStatus,
  type AgentSetKeyRequest,
  type AgentRunRequest,
  type AgentRunResponse,
  type MenuCommand,
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
  formatCitation(request: FormatCitationRequest): Promise<FormatCitationResult> {
    return ipcRenderer.invoke(IpcChannels.formatCitation, request);
  },
  addAttachment(request: AddAttachmentRequest): Promise<EditResult> {
    return ipcRenderer.invoke(IpcChannels.addAttachment, request);
  },
  removeAttachment(request: RemoveAttachmentRequest): Promise<EditResult> {
    return ipcRenderer.invoke(IpcChannels.removeAttachment, request);
  },
  searchOnline(request: SearchOnlineRequest): Promise<SearchOnlineResponse> {
    return ipcRenderer.invoke(IpcChannels.searchOnline, request);
  },
  importOnline(request: ImportOnlineRequest): Promise<EditResult> {
    return ipcRenderer.invoke(IpcChannels.importOnline, request);
  },
  ftsSearch(request: FtsSearchRequest): Promise<FtsSearchResponse> {
    return ipcRenderer.invoke(IpcChannels.ftsSearch, request);
  },
  getSettings(request: GetSettingsRequest): Promise<Settings> {
    return ipcRenderer.invoke(IpcChannels.getSettings, request);
  },
  updateSettings(request: UpdateSettingsRequest): Promise<Settings> {
    return ipcRenderer.invoke(IpcChannels.updateSettings, request);
  },
  onShowPreferences(listener: () => void): Unsubscribe {
    const handler = (): void => listener();
    ipcRenderer.on(IpcEvents.showPreferences, handler);
    return () => ipcRenderer.removeListener(IpcEvents.showPreferences, handler);
  },
  readAttachment(request: ReadAttachmentRequest): Promise<ReadAttachmentResponse> {
    return ipcRenderer.invoke(IpcChannels.readAttachment, request);
  },
  exportText(request: ExportTextRequest): Promise<ExportTextResponse> {
    return ipcRenderer.invoke(IpcChannels.exportText, request);
  },
  pasteEntries(request: PasteEntriesRequest): Promise<ImportResult> {
    return ipcRenderer.invoke(IpcChannels.pasteEntries, request);
  },
  importFiles(request: ImportFilesRequest): Promise<ImportResult> {
    return ipcRenderer.invoke(IpcChannels.importFiles, request);
  },
  importDialog(request: ImportDialogRequest): Promise<ImportResult> {
    return ipcRenderer.invoke(IpcChannels.importDialog, request);
  },
  findReplace(request: FindReplaceRequest): Promise<FindReplaceResult> {
    return ipcRenderer.invoke(IpcChannels.findReplace, request);
  },
  findDuplicates(request: FindDuplicatesRequest): Promise<FindDuplicatesResult> {
    return ipcRenderer.invoke(IpcChannels.findDuplicates, request);
  },
  groupEdit(request: GroupEditRequest): Promise<GroupEditResult> {
    return ipcRenderer.invoke(IpcChannels.groupEdit, request);
  },
  fieldSuggestions(request: FieldSuggestionsRequest): Promise<FieldSuggestionsResponse> {
    return ipcRenderer.invoke(IpcChannels.fieldSuggestions, request);
  },
  autoFile(request: AutoFileRequest): Promise<AutoFileResult> {
    return ipcRenderer.invoke(IpcChannels.autoFile, request);
  },
  chooseFolder(): Promise<ChooseFolderResponse> {
    return ipcRenderer.invoke(IpcChannels.chooseFolder, {});
  },
  agentKeyStatus(): Promise<AgentKeyStatus> {
    return ipcRenderer.invoke(IpcChannels.agentKeyStatus, {});
  },
  agentSetKey(request: AgentSetKeyRequest): Promise<AgentKeyStatus> {
    return ipcRenderer.invoke(IpcChannels.agentSetKey, request);
  },
  agentRun(request: AgentRunRequest): Promise<AgentRunResponse> {
    return ipcRenderer.invoke(IpcChannels.agentRun, request);
  },
  agentReset(request: { documentId: string }): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IpcChannels.agentReset, request);
  },
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
  onMenuCommand(listener: (command: MenuCommand) => void): Unsubscribe {
    const handler = (_e: IpcRendererEvent, command: MenuCommand): void => listener(command);
    ipcRenderer.on(IpcEvents.menuCommand, handler);
    return () => ipcRenderer.removeListener(IpcEvents.menuCommand, handler);
  },
  onMenuToggleColumn(listener: (key: string) => void): Unsubscribe {
    const handler = (_e: IpcRendererEvent, key: string): void => listener(key);
    ipcRenderer.on(IpcEvents.menuToggleColumn, handler);
    return () => ipcRenderer.removeListener(IpcEvents.menuToggleColumn, handler);
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
