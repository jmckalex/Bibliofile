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
  BatchEditRequest,
  BatchEditResult,
  CloseDocumentRequest,
  ClosedDocument,
  EditResult,
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
  ListEntryTypesResponse,
  SelectFromAuxRequest,
  AuxSelectionResult,
  ExportFolderTreeRequest,
  ExportFolderTreeResponse,
  SelectIncompleteRequest,
  SelectIncompleteResponse,
  PreviewTemplateRequest,
  PreviewTemplateResponse,
  PreviewPanelRequest,
  PreviewPanelResponse,
  ExportTemplateRequest,
  ExportTemplateResponse,
  ExportTemplateMenuRequest,
  SetColorRequest,
  SetColorResponse,
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
  MenuCommand,
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
  [IpcChannels.batchEdit]: IpcEntry<BatchEditRequest, BatchEditResult>;
  [IpcChannels.listMacros]: IpcEntry<ListMacrosRequest, ListMacrosResponse>;
  [IpcChannels.saveDocument]: IpcEntry<SaveDocumentRequest, SaveDocumentResult>;
  [IpcChannels.formatCitation]: IpcEntry<FormatCitationRequest, FormatCitationResult>;
  [IpcChannels.copyRtf]: IpcEntry<CopyRtfRequest, CopyRtfResponse>;
  [IpcChannels.listCitationStyles]: IpcEntry<ListCitationStylesRequest, ListCitationStylesResponse>;
  [IpcChannels.installCitationStyle]: IpcEntry<InstallCitationStyleRequest, InstallCitationStyleResponse>;
  [IpcChannels.removeCitationStyle]: IpcEntry<RemoveCitationStyleRequest, RemoveCitationStyleResponse>;
  [IpcChannels.texPreview]: IpcEntry<TexPreviewRequest, TexPreviewResponse>;
  [IpcChannels.journalCover]: IpcEntry<JournalCoverRequest, JournalCoverResponse>;
  [IpcChannels.setJournalCover]: IpcEntry<SetJournalCoverRequest, SetJournalCoverResponse>;
  [IpcChannels.scanJournalCovers]: IpcEntry<ScanJournalCoversRequest, ScanJournalCoversResponse>;
  [IpcChannels.saveJournalCovers]: IpcEntry<SaveJournalCoversRequest, SaveJournalCoversResponse>;
  [IpcChannels.addAttachment]: IpcEntry<AddAttachmentRequest, EditResult>;
  [IpcChannels.removeAttachment]: IpcEntry<RemoveAttachmentRequest, EditResult>;
  [IpcChannels.searchOnline]: IpcEntry<SearchOnlineRequest, SearchOnlineResponse>;
  [IpcChannels.importOnline]: IpcEntry<ImportOnlineRequest, EditResult>;
  [IpcChannels.ftsSearch]: IpcEntry<FtsSearchRequest, FtsSearchResponse>;
  [IpcChannels.getSettings]: IpcEntry<GetSettingsRequest, Settings>;
  [IpcChannels.updateSettings]: IpcEntry<UpdateSettingsRequest, Settings>;
  [IpcChannels.listEntryTypes]: IpcEntry<Record<string, never>, ListEntryTypesResponse>;
  [IpcChannels.selectFromAux]: IpcEntry<SelectFromAuxRequest, AuxSelectionResult>;
  [IpcChannels.exportFolderTree]: IpcEntry<ExportFolderTreeRequest, ExportFolderTreeResponse>;
  [IpcChannels.setColor]: IpcEntry<SetColorRequest, SetColorResponse>;
  [IpcChannels.selectIncomplete]: IpcEntry<SelectIncompleteRequest, SelectIncompleteResponse>;
  [IpcChannels.previewTemplate]: IpcEntry<PreviewTemplateRequest, PreviewTemplateResponse>;
  [IpcChannels.previewPanel]: IpcEntry<PreviewPanelRequest, PreviewPanelResponse>;
  [IpcChannels.exportTemplate]: IpcEntry<ExportTemplateRequest, ExportTemplateResponse>;
  [IpcChannels.readAttachment]: IpcEntry<ReadAttachmentRequest, ReadAttachmentResponse>;
  [IpcChannels.exportText]: IpcEntry<ExportTextRequest, ExportTextResponse>;
  [IpcChannels.print]: IpcEntry<PrintRequest, PrintResponse>;
  [IpcChannels.exportSelection]: IpcEntry<ExportSelectionRequest, ExportSelectionResponse>;
  [IpcChannels.pasteEntries]: IpcEntry<PasteEntriesRequest, ImportResult>;
  [IpcChannels.importFiles]: IpcEntry<ImportFilesRequest, ImportResult>;
  [IpcChannels.importDialog]: IpcEntry<ImportDialogRequest, ImportResult>;
  [IpcChannels.findReplace]: IpcEntry<FindReplaceRequest, FindReplaceResult>;
  [IpcChannels.findDuplicates]: IpcEntry<FindDuplicatesRequest, FindDuplicatesResult>;
  [IpcChannels.findBrokenLinks]: IpcEntry<FindBrokenLinksRequest, FindBrokenLinksResponse>;
  [IpcChannels.relocateAttachment]: IpcEntry<RelocateAttachmentRequest, EditResult>;
  [IpcChannels.groupEdit]: IpcEntry<GroupEditRequest, GroupEditResult>;
  [IpcChannels.groupConditions]: IpcEntry<GroupConditionsRequest, GroupConditionsResponse>;
  [IpcChannels.renameAuthor]: IpcEntry<RenameAuthorRequest, RenameAuthorResult>;
  [IpcChannels.openEditor]: IpcEntry<OpenEditorRequest, { ok: true }>;
  [IpcChannels.openDialog]: IpcEntry<Record<string, never>, { ok: true }>;
  [IpcChannels.newDocument]: IpcEntry<Record<string, never>, { ok: true }>;
  [IpcChannels.fieldSuggestions]: IpcEntry<FieldSuggestionsRequest, FieldSuggestionsResponse>;
  [IpcChannels.autoFile]: IpcEntry<AutoFileRequest, AutoFileResult>;
  [IpcChannels.consolidateLinkedFiles]: IpcEntry<ConsolidateRequest, ConsolidateResult>;
  [IpcChannels.chooseFolder]: IpcEntry<Record<string, never>, ChooseFolderResponse>;
  [IpcChannels.agentKeyStatus]: IpcEntry<Record<string, never>, AgentKeyStatus>;
  [IpcChannels.agentSetKey]: IpcEntry<AgentSetKeyRequest, AgentKeyStatus>;
  [IpcChannels.agentRun]: IpcEntry<AgentRunRequest, AgentRunResponse>;
  [IpcChannels.agentReset]: IpcEntry<{ documentId: string }, { ok: true }>;
}

/**
 * Event (push) contract. Keyed by the channel-name values from
 * {@link IpcEvents}; the value is the single payload `webContents.send` carries.
 */
export interface IpcEventMap {
  [IpcEvents.documentOpened]: OpenedDocument;
  [IpcEvents.documentClosed]: ClosedDocument;
  [IpcEvents.showPreferences]: null;
  [IpcEvents.menuCommand]: MenuCommand;
  [IpcEvents.menuToggleColumn]: string;
  [IpcEvents.menuExportTemplate]: ExportTemplateMenuRequest;
  [IpcEvents.menuSetColor]: number;
  [IpcEvents.documentChanged]: DocumentChangedEvent;
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
