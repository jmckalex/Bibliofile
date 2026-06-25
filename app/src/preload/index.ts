/**
 * Preload bridge — exposes a typed {@link BibDeskApi} on `window.bibdesk`.
 *
 * The renderer talks ONLY to this surface (contextIsolation on, node integration
 * off). Each method forwards to main via `ipcRenderer.invoke` on the matching
 * `@bibdesk/shared` channel; the two document-lifecycle events are delivered via
 * `ipcRenderer.on` and return an unsubscribe.
 */

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';

// Values from the barrel-free `channels` entry so the preload bundle doesn't drag
// in the i18n catalogs (the only runtime values preload needs are these two).
import { IpcChannels, IpcEvents } from '@bibdesk/shared/channels';
import type {
  BibDeskApi,
  Unsubscribe,
  OpenedDocument,
  ClosedDocument,
  CloseDocumentRequest,
  ListPublicationsRequest,
  ListPublicationsResponse,
  ListGroupsRequest,
  ListGroupsResponse,
  GetItemDetailRequest,
  ItemDetail,
  RenderMultiPanelRequest,
  RenderMultiPanelResponse,
  OpenExternalRequest,
  OpenExternalResult,
  ApplyEditRequest,
  BatchEditRequest,
  BatchEditResult,
  EditResult,
  ListMacrosRequest,
  ListMacrosResponse,
  SaveDocumentRequest,
  SaveDocumentResult,
  FormatCitationRequest,
  FormatCitationResult,
  CopyRtfRequest,
  CopyRtfResponse,
  ListCitationStylesRequest,
  ListCitationStylesResponse,
  InstallCitationStyleRequest,
  InstallCitationStyleResponse,
  RemoveCitationStyleRequest,
  RemoveCitationStyleResponse,
  TexPreviewRequest,
  TexPreviewResponse,
  JournalCoverRequest,
  JournalCoverResponse,
  SetJournalCoverRequest,
  SetJournalCoverResponse,
  ScanJournalCoversRequest,
  ScanJournalCoversResponse,
  SaveJournalCoversRequest,
  SaveJournalCoversResponse,
  AddAttachmentRequest,
  RemoveAttachmentRequest,
  SearchOnlineRequest,
  SearchOnlineResponse,
  ImportOnlineRequest,
  FtsSearchRequest,
  FtsSearchResponse,
  GetSettingsRequest,
  UpdateSettingsRequest,
  Settings,
  ListEntryTypesResponse,
  SelectFromAuxRequest,
  AuxSelectionResult,
  ExportFolderTreeRequest,
  ExportFolderTreeResponse,
  SetColorRequest,
  SetColorResponse,
  SelectIncompleteRequest,
  SelectIncompleteResponse,
  PreviewTemplateRequest,
  PreviewTemplateResponse,
  PreviewPanelRequest,
  PreviewPanelResponse,
  ExportTemplateRequest,
  ExportTemplateResponse,
  ExportTemplateMenuRequest,
  ReadAttachmentRequest,
  ReadAttachmentResponse,
  ExportTextRequest,
  ExportTextResponse,
  PrintRequest,
  PrintResponse,
  ExportSelectionRequest,
  ExportSelectionResponse,
  PasteEntriesRequest,
  ImportFilesRequest,
  ImportDialogRequest,
  ImportResult,
  CommitStagedEntryRequest,
  CommitStagedEntryResult,
  DiscardStagingDocRequest,
  DiscardStagingDocResult,
  FindReplaceRequest,
  FindReplaceResult,
  FindDuplicatesRequest,
  FindDuplicatesResult,
  FindBrokenLinksRequest,
  FindBrokenLinksResponse,
  RelocateAttachmentRequest,
  GroupEditRequest,
  GroupEditResult,
  GroupConditionsRequest,
  GroupConditionsResponse,
  RenameAuthorRequest,
  RenameAuthorResult,
  OpenEditorRequest,
  DocumentChangedEvent,
  FieldSuggestionsRequest,
  FieldSuggestionsResponse,
  AutoFileRequest,
  AutoFileResult,
  ConsolidateRequest,
  ConsolidateResult,
  ChooseFolderResponse,
  AgentKeyStatus,
  AgentSetKeyRequest,
  AgentRunRequest,
  AgentRunResponse,
  RunScriptRequest,
  RunScriptResponse,
  MenuCommand,
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
  renderMultiPanel(request: RenderMultiPanelRequest): Promise<RenderMultiPanelResponse> {
    return ipcRenderer.invoke(IpcChannels.renderMultiPanel, request);
  },
  openExternal(request: OpenExternalRequest): Promise<OpenExternalResult> {
    return ipcRenderer.invoke(IpcChannels.openExternal, request);
  },
  applyEdit(request: ApplyEditRequest): Promise<EditResult> {
    return ipcRenderer.invoke(IpcChannels.applyEdit, request);
  },
  batchEdit(request: BatchEditRequest): Promise<BatchEditResult> {
    return ipcRenderer.invoke(IpcChannels.batchEdit, request);
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
  copyRtf(request: CopyRtfRequest): Promise<CopyRtfResponse> {
    return ipcRenderer.invoke(IpcChannels.copyRtf, request);
  },
  listCitationStyles(request: ListCitationStylesRequest): Promise<ListCitationStylesResponse> {
    return ipcRenderer.invoke(IpcChannels.listCitationStyles, request);
  },
  installCitationStyle(request: InstallCitationStyleRequest): Promise<InstallCitationStyleResponse> {
    return ipcRenderer.invoke(IpcChannels.installCitationStyle, request);
  },
  removeCitationStyle(request: RemoveCitationStyleRequest): Promise<RemoveCitationStyleResponse> {
    return ipcRenderer.invoke(IpcChannels.removeCitationStyle, request);
  },
  texPreview(request: TexPreviewRequest): Promise<TexPreviewResponse> {
    return ipcRenderer.invoke(IpcChannels.texPreview, request);
  },
  journalCover(request: JournalCoverRequest): Promise<JournalCoverResponse> {
    return ipcRenderer.invoke(IpcChannels.journalCover, request);
  },
  setJournalCover(request: SetJournalCoverRequest): Promise<SetJournalCoverResponse> {
    return ipcRenderer.invoke(IpcChannels.setJournalCover, request);
  },
  scanJournalCovers(request: ScanJournalCoversRequest): Promise<ScanJournalCoversResponse> {
    return ipcRenderer.invoke(IpcChannels.scanJournalCovers, request);
  },
  saveJournalCovers(request: SaveJournalCoversRequest): Promise<SaveJournalCoversResponse> {
    return ipcRenderer.invoke(IpcChannels.saveJournalCovers, request);
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
  listEntryTypes(): Promise<ListEntryTypesResponse> {
    return ipcRenderer.invoke(IpcChannels.listEntryTypes, {});
  },
  selectFromAux(request: SelectFromAuxRequest): Promise<AuxSelectionResult> {
    return ipcRenderer.invoke(IpcChannels.selectFromAux, request);
  },
  exportFolderTree(request: ExportFolderTreeRequest): Promise<ExportFolderTreeResponse> {
    return ipcRenderer.invoke(IpcChannels.exportFolderTree, request);
  },
  setColor(request: SetColorRequest): Promise<SetColorResponse> {
    return ipcRenderer.invoke(IpcChannels.setColor, request);
  },
  selectIncomplete(request: SelectIncompleteRequest): Promise<SelectIncompleteResponse> {
    return ipcRenderer.invoke(IpcChannels.selectIncomplete, request);
  },
  previewTemplate(request: PreviewTemplateRequest): Promise<PreviewTemplateResponse> {
    return ipcRenderer.invoke(IpcChannels.previewTemplate, request);
  },
  previewPanel(request: PreviewPanelRequest): Promise<PreviewPanelResponse> {
    return ipcRenderer.invoke(IpcChannels.previewPanel, request);
  },
  exportTemplate(request: ExportTemplateRequest): Promise<ExportTemplateResponse> {
    return ipcRenderer.invoke(IpcChannels.exportTemplate, request);
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
  print(request: PrintRequest): Promise<PrintResponse> {
    return ipcRenderer.invoke(IpcChannels.print, request);
  },
  exportSelection(request: ExportSelectionRequest): Promise<ExportSelectionResponse> {
    return ipcRenderer.invoke(IpcChannels.exportSelection, request);
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
  commitStagedEntry(request: CommitStagedEntryRequest): Promise<CommitStagedEntryResult> {
    return ipcRenderer.invoke(IpcChannels.commitStagedEntry, request);
  },
  discardStagingDoc(request: DiscardStagingDocRequest): Promise<DiscardStagingDocResult> {
    return ipcRenderer.invoke(IpcChannels.discardStagingDoc, request);
  },
  findReplace(request: FindReplaceRequest): Promise<FindReplaceResult> {
    return ipcRenderer.invoke(IpcChannels.findReplace, request);
  },
  findDuplicates(request: FindDuplicatesRequest): Promise<FindDuplicatesResult> {
    return ipcRenderer.invoke(IpcChannels.findDuplicates, request);
  },
  findBrokenLinks(request: FindBrokenLinksRequest): Promise<FindBrokenLinksResponse> {
    return ipcRenderer.invoke(IpcChannels.findBrokenLinks, request);
  },
  relocateAttachment(request: RelocateAttachmentRequest): Promise<EditResult> {
    return ipcRenderer.invoke(IpcChannels.relocateAttachment, request);
  },
  groupEdit(request: GroupEditRequest): Promise<GroupEditResult> {
    return ipcRenderer.invoke(IpcChannels.groupEdit, request);
  },
  groupConditions(request: GroupConditionsRequest): Promise<GroupConditionsResponse> {
    return ipcRenderer.invoke(IpcChannels.groupConditions, request);
  },
  renameAuthor(request: RenameAuthorRequest): Promise<RenameAuthorResult> {
    return ipcRenderer.invoke(IpcChannels.renameAuthor, request);
  },
  openEditor(request: OpenEditorRequest): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IpcChannels.openEditor, request);
  },
  openAnnotation(request: OpenEditorRequest): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IpcChannels.openAnnotation, request);
  },
  openDialog(): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IpcChannels.openDialog, {});
  },
  newDocument(): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IpcChannels.newDocument, {});
  },
  fieldSuggestions(request: FieldSuggestionsRequest): Promise<FieldSuggestionsResponse> {
    return ipcRenderer.invoke(IpcChannels.fieldSuggestions, request);
  },
  autoFile(request: AutoFileRequest): Promise<AutoFileResult> {
    return ipcRenderer.invoke(IpcChannels.autoFile, request);
  },
  consolidateLinkedFiles(request: ConsolidateRequest): Promise<ConsolidateResult> {
    return ipcRenderer.invoke(IpcChannels.consolidateLinkedFiles, request);
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
  runScript(request: RunScriptRequest): Promise<RunScriptResponse> {
    return ipcRenderer.invoke(IpcChannels.runScript, request);
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
  onMenuExportTemplate(listener: (req: ExportTemplateMenuRequest) => void): Unsubscribe {
    const handler = (_e: IpcRendererEvent, req: ExportTemplateMenuRequest): void => listener(req);
    ipcRenderer.on(IpcEvents.menuExportTemplate, handler);
    return () => ipcRenderer.removeListener(IpcEvents.menuExportTemplate, handler);
  },
  onMenuSetColor(listener: (colorIndex: number) => void): Unsubscribe {
    const handler = (_e: IpcRendererEvent, colorIndex: number): void => listener(colorIndex);
    ipcRenderer.on(IpcEvents.menuSetColor, handler);
    return () => ipcRenderer.removeListener(IpcEvents.menuSetColor, handler);
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
  onDocumentChanged(listener: (e: DocumentChangedEvent) => void): Unsubscribe {
    const handler = (_e: IpcRendererEvent, payload: DocumentChangedEvent): void => listener(payload);
    ipcRenderer.on(IpcEvents.documentChanged, handler);
    return () => ipcRenderer.removeListener(IpcEvents.documentChanged, handler);
  },
};

contextBridge.exposeInMainWorld('bibdesk', api);
