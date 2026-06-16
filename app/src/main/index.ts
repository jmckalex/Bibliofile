/**
 * Electron MAIN process — a thin shell around the pure {@link DocumentStore}.
 *
 * It owns no document logic of its own: it creates the `BrowserWindow`, loads
 * the renderer (electron-vite dev URL in dev; built `index.html` otherwise),
 * registers one `ipcMain.handle` per channel in the `@bibdesk/shared` contract
 * (forwarding straight into the store), and handles the NSDocument-style open
 * lifecycle (CLI arg, `BIBDESK_OPEN` env, macOS `open-file`, File→Open menu).
 *
 * Security: `contextIsolation: true`, `nodeIntegration: false`, preload bundle
 * only. The renderer talks exclusively to `window.bibdesk` (see preload).
 */

import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  shell,
  type MenuItemConstructorOptions,
  type IpcMainInvokeEvent,
} from 'electron';

import {
  IpcChannels,
  IpcEvents,
  type IpcHandlers,
  type MenuCommand,
  type OpenedDocument,
  type OpenExternalRequest,
  type OpenExternalResult,
} from '@bibdesk/shared';

import { DocumentStore } from './document-service.js';
import { formatCitation } from './csl.js';
import { searchOnline } from './online.js';
import { buildHelpHtml, findHelpDir } from './help.js';
import { getSettings, loadSettings, updateSettings } from './settings.js';

// ---------------------------------------------------------------------------
// Process-wide singletons
// ---------------------------------------------------------------------------

/** The one document store for this process (pure; no Electron deps). */
const store = new DocumentStore();

/** The main window (one window in this read-only viewer session). */
let mainWindow: BrowserWindow | null = null;

/** A `.bib` path requested before the window/renderer was ready. */
let pendingOpenPath: string | null = null;

/** Most recently opened document id (used by the smoke-test FTS self-check). */
let lastDocumentId: string | null = null;

/** The Help manual window (singleton). */
let helpWindow: BrowserWindow | null = null;

/** Open (or focus) the Help manual window, rendering `docs/help/*.md`. */
function openHelp(): void {
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.focus();
    return;
  }
  const dir = findHelpDir(app.getAppPath());
  if (!dir) {
    void dialog.showMessageBox({ type: 'info', message: 'Help is not available in this build.' });
    return;
  }
  const tmp = join(tmpdir(), 'bibdesk-help.html');
  writeFileSync(tmp, buildHelpHtml(dir));
  helpWindow = new BrowserWindow({
    width: 940,
    height: 820,
    title: 'BibDesk Help',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  void helpWindow.loadFile(tmp);
  // External links open in the OS browser, not in the help window.
  helpWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  helpWindow.webContents.on('will-navigate', (e, url) => {
    if (/^https?:/i.test(url)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
  helpWindow.on('closed', () => {
    helpWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Window creation + renderer loading
// ---------------------------------------------------------------------------

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 640,
    minHeight: 400,
    show: false,
    title: 'BibDesk',
    webPreferences: {
      // electron-vite emits the preload as ESM `index.mjs` (this package is
      // type:module). Electron 33 loads an ESM preload when sandbox is off.
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // electron-vite injects the dev server URL via this env var in `dev`.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Dev-only smoke hook: when BIBDESK_SMOKE points at a PNG path, wait for the
  // renderer to load + fetch its data, capture the window, write the image, then
  // quit. Used by the orchestrator's headless GUI smoke test; no effect in normal
  // runs (env var unset).
  const smokePath = process.env.BIBDESK_SMOKE;
  if (smokePath) {
    win.webContents.on('console-message', (_e, level, message) =>
      console.log(`[smoke][renderer:${level}] ${message}`),
    );
    win.webContents.on('did-fail-load', (_e, code, desc) =>
      console.error(`[smoke] did-fail-load ${code} ${desc}`),
    );
    win.webContents.on('preload-error', (_e, p, err) =>
      console.error(`[smoke] preload-error ${p}: ${err.message}`),
    );
    win.webContents.on('render-process-gone', (_e, details) =>
      console.error(`[smoke] render-process-gone: ${details.reason}`),
    );
    const capture = (): void => {
      // FTS self-test: prove SQLite FTS5 (better-sqlite3) loaded under Electron.
      if (lastDocumentId) {
        try {
          const r = store.ftsSearch(lastDocumentId, 'basel');
          console.log(`[smoke] fts available=${r.available} hits("basel")=${r.ids.length}`);
        } catch (e) {
          console.log('[smoke] fts self-test error:', e instanceof Error ? e.message : String(e));
        }
      }
      // Capture the Help window instead, when smoke-testing Help.
      const target =
        process.env.BIBDESK_OPEN_HELP && helpWindow && !helpWindow.isDestroyed()
          ? helpWindow
          : win;
      target.webContents
        .capturePage()
        .then((img) => {
          writeFileSync(smokePath, img.toPNG());
          console.log(`[smoke] captured ${smokePath}`);
        })
        .catch((err) => console.error('[smoke] capture failed:', err))
        .finally(() => app.quit());
    };
    win.webContents.once('did-finish-load', () => {
      // Wait for data to load, select the first row (so the detail/preview card
      // is visible), wait for the detail fetch + MathJax typeset, then capture.
      setTimeout(() => {
        // plain-string payload so the main-process tsc never typechecks DOM globals
        const dark = process.env.BIBDESK_SMOKE_DARK
          ? "document.querySelector('.bd-theme-toggle')?.click();"
          : '';
        // optionally open the first PDF attachment (after the detail pane loads)
        const pdf = process.env.BIBDESK_OPEN_PDF
          ? "setTimeout(()=>document.querySelector('.bd-file__btn')?.click(),1400);"
          : '';
        // optionally inject a synthetic BibTeX paste to exercise the import path
        const paste = process.env.BIBDESK_SMOKE_PASTE
          ? `(()=>{const dt=new DataTransfer();dt.setData('text',${JSON.stringify(
              process.env.BIBDESK_SMOKE_PASTE,
            )});window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})();`
          : '';
        // optionally fire a native menu command (opens its modal) before capture
        if (process.env.BIBDESK_SMOKE_MENU) {
          setTimeout(
            () => win.webContents.send(IpcEvents.menuCommand, process.env.BIBDESK_SMOKE_MENU),
            900,
          );
        }
        void win.webContents
          .executeJavaScript(`document.querySelector('.bd-tr')?.click();${dark}${pdf}${paste} true`)
          .catch(() => undefined)
          .finally(() => setTimeout(capture, process.env.BIBDESK_OPEN_PDF ? 4200 : 1800));
      }, 1800);
    });
  }

  return win;
}

// ---------------------------------------------------------------------------
// Open lifecycle
// ---------------------------------------------------------------------------

/**
 * Open a `.bib` by absolute path: parse via the store, add it to the OS recent
 * documents, set the window title, and notify the renderer with
 * {@link IpcEvents.documentOpened}. Returns the summary (also used by the
 * `openDocument` IPC handler). Throws on read/parse failure.
 */
function openPath(path: string): OpenedDocument {
  const opened = store.openFile(path);
  app.addRecentDocument(path);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(`${opened.displayName} — BibDesk`);
    mainWindow.setRepresentedFilename?.(opened.path);
  }
  lastDocumentId = opened.documentId;
  buildMenu(); // refresh document-scoped menu items now that a doc is open
  notifyDocumentOpened(opened);
  // Index attachment PDF text in the background; field-text search works already.
  void store.indexAttachments(opened.documentId);
  return opened;
}

/** Push a `documentOpened` event to the renderer (or buffer until ready). */
function notifyDocumentOpened(opened: OpenedDocument): void {
  const wc = mainWindow?.webContents;
  if (!wc) return;
  if (wc.isLoading()) {
    wc.once('did-finish-load', () => wc.send(IpcEvents.documentOpened, opened));
  } else {
    wc.send(IpcEvents.documentOpened, opened);
  }
}

/** Ask the renderer to open the Preferences pane. */
function openPreferences(): void {
  mainWindow?.webContents.send(IpcEvents.showPreferences, null);
}

/** Open a path now if the window exists, else stash it for after launch. */
function openPathWhenReady(path: string): void {
  if (mainWindow) {
    try {
      openPath(path);
    } catch (err) {
      console.error('[open] failed:', err instanceof Error ? err.stack : String(err));
      void dialog.showMessageBox(mainWindow, {
        type: 'error',
        message: `Could not open ${path}`,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    pendingOpenPath = path;
  }
}

/**
 * Resolve the `.bib` path to auto-open at startup, in priority order:
 *   1. `BIBDESK_OPEN` env var (used by the smoke test),
 *   2. the first `.bib` path in `process.argv`.
 * Returns undefined when none is present or the file does not exist.
 */
function startupOpenPath(): string | undefined {
  const env = process.env.BIBDESK_OPEN;
  if (env && existsSync(env)) return env;

  // argv: skip the executable; accept the first existing *.bib arg.
  for (const arg of process.argv.slice(1)) {
    if (arg.toLowerCase().endsWith('.bib') && existsSync(arg)) return arg;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// File → Open menu + dialog
// ---------------------------------------------------------------------------

async function showOpenDialog(): Promise<void> {
  const win = mainWindow ?? undefined;
  const result = win
    ? await dialog.showOpenDialog(win, openDialogOptions())
    : await dialog.showOpenDialog(openDialogOptions());
  if (result.canceled || result.filePaths.length === 0) return;
  const path = result.filePaths[0]!;
  try {
    openPath(path);
  } catch (err) {
    const opts = {
      type: 'error' as const,
      message: `Could not open ${path}`,
      detail: err instanceof Error ? err.message : String(err),
    };
    if (win) void dialog.showMessageBox(win, opts);
    else void dialog.showMessageBox(opts);
  }
}

function openDialogOptions(): Electron.OpenDialogOptions {
  return {
    title: 'Open BibTeX File',
    filters: [
      { name: 'BibTeX', extensions: ['bib'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  };
}

/** Send a menu command to the renderer (which acts on its own state). */
function sendMenuCommand(command: MenuCommand): void {
  mainWindow?.webContents.send(IpcEvents.menuCommand, command);
}

/** Is there an open document to act on? Gates document-scoped menu items. */
function hasOpenDocument(): boolean {
  return lastDocumentId !== null;
}

/** Save As: pick a new path, write there, and re-sync the renderer (name + dirty). */
async function saveDocumentAs(): Promise<void> {
  if (!lastDocumentId) return;
  const current = store.summarize(lastDocumentId);
  const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
    title: 'Save As',
    defaultPath: current.path,
    filters: [{ name: 'BibTeX', extensions: ['bib'] }],
  });
  if (result.canceled || !result.filePath) return;
  try {
    const saved = store.saveDocument(lastDocumentId, result.filePath);
    app.addRecentDocument(saved.path);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(`${basename(saved.path)} — BibDesk`);
      mainWindow.setRepresentedFilename?.(saved.path);
    }
    // Re-notify so the renderer picks up the new display name + cleared dirty.
    notifyDocumentOpened(store.summarize(lastDocumentId));
  } catch (err) {
    void dialog.showMessageBox(mainWindow ?? undefined!, {
      type: 'error',
      message: 'Could not save the document',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Revert to Saved: re-read the document from disk, discarding unsaved edits. */
async function revertToSaved(): Promise<void> {
  if (!lastDocumentId) return;
  const { path } = store.summarize(lastDocumentId);
  const choice = await dialog.showMessageBox(mainWindow ?? undefined!, {
    type: 'warning',
    buttons: ['Revert', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Revert to the last saved version?',
    detail: 'Any unsaved changes will be lost.',
  });
  if (choice.response !== 0) return;
  openPathWhenReady(path);
}

/** File extension for each export format. */
const EXPORT_EXT: Record<'bibtex' | 'ris' | 'csv' | 'html', string> = {
  bibtex: 'bib',
  ris: 'ris',
  csv: 'csv',
  html: 'html',
};

/** Export the whole library to a file in the given format. */
async function exportDocumentAs(format: 'bibtex' | 'ris' | 'csv' | 'html'): Promise<void> {
  if (!lastDocumentId) return;
  const current = store.summarize(lastDocumentId);
  const ext = EXPORT_EXT[format];
  const base = current.displayName.replace(/\.bib$/i, '');
  const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
    title: 'Export',
    defaultPath: `${base}.${ext}`,
    filters: [{ name: format.toUpperCase(), extensions: [ext] }],
  });
  if (result.canceled || !result.filePath) return;
  try {
    writeFileSync(result.filePath, store.exportText(lastDocumentId, format), 'utf8');
  } catch (err) {
    void dialog.showMessageBox(mainWindow ?? undefined!, {
      type: 'error',
      message: 'Could not export the document',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Columns offered in the View→Columns menu (label per builtin/common key). */
const COLUMN_MENU: { key: string; label: string }[] = [
  { key: 'citeKey', label: 'Cite Key' },
  { key: 'type', label: 'Type' },
  { key: 'authors', label: 'Authors' },
  { key: 'title', label: 'Title' },
  { key: 'year', label: 'Year' },
  { key: 'keywords', label: 'Keywords' },
  { key: 'attachments', label: 'Attachments' },
  { key: 'read', label: 'Read' },
  { key: 'rating', label: 'Rating' },
  { key: 'Journal', label: 'Journal' },
  { key: 'Booktitle', label: 'Booktitle' },
  { key: 'Publisher', label: 'Publisher' },
  { key: 'Doi', label: 'DOI' },
  { key: 'Url', label: 'URL' },
  { key: 'Month', label: 'Month' },
];

/** Checkbox items for View→Columns, reflecting the current settings + any extras. */
function columnMenuItems(): MenuItemConstructorOptions[] {
  const shown = new Set(getSettings().columns);
  // Include configured columns not already in the curated list (e.g. custom fields).
  const known = new Set(COLUMN_MENU.map((c) => c.key));
  const extra = getSettings()
    .columns.filter((k) => !known.has(k))
    .map((k) => ({ key: k, label: k }));
  return [...COLUMN_MENU, ...extra].map((c) => ({
    label: c.label,
    type: 'checkbox' as const,
    checked: shown.has(c.key),
    enabled: hasOpenDocument(),
    click: () => mainWindow?.webContents.send(IpcEvents.menuToggleColumn, c.key),
  }));
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const docEnabled = hasOpenDocument();
  const template: MenuItemConstructorOptions[] = [];

  const prefsItem: MenuItemConstructorOptions = {
    label: 'Preferences…',
    accelerator: 'CmdOrCtrl+,',
    click: () => openPreferences(),
  };

  // --- Application menu (macOS) ---
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: 'About BibDesk' },
        { type: 'separator' },
        prefsItem,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  // --- File ---
  template.push({
    label: 'File',
    submenu: [
      {
        label: 'New Publication',
        accelerator: 'CmdOrCtrl+N',
        enabled: docEnabled,
        click: () => sendMenuCommand('newPublication'),
      },
      { type: 'separator' },
      {
        label: 'Open…',
        accelerator: 'CmdOrCtrl+O',
        click: () => void showOpenDialog(),
      },
      { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
      { type: 'separator' },
      {
        label: 'Save',
        accelerator: 'CmdOrCtrl+S',
        enabled: docEnabled,
        click: () => sendMenuCommand('save'),
      },
      {
        label: 'Save As…',
        accelerator: 'Shift+CmdOrCtrl+S',
        enabled: docEnabled,
        click: () => void saveDocumentAs(),
      },
      {
        label: 'Revert to Saved',
        enabled: docEnabled,
        click: () => void revertToSaved(),
      },
      {
        label: isMac ? 'Show in Finder' : 'Show in File Manager',
        enabled: docEnabled,
        click: () => {
          if (lastDocumentId) shell.showItemInFolder(store.summarize(lastDocumentId).path);
        },
      },
      { type: 'separator' },
      {
        label: 'Import',
        submenu: [
          {
            label: 'From File (BibTeX / RIS)…',
            accelerator: 'Shift+CmdOrCtrl+I',
            enabled: docEnabled,
            click: () => sendMenuCommand('importFile'),
          },
          {
            label: 'Search Online (CrossRef / arXiv)…',
            accelerator: 'Shift+CmdOrCtrl+O',
            enabled: docEnabled,
            click: () => sendMenuCommand('online'),
          },
        ],
      },
      {
        label: 'Export',
        submenu: [
          { label: 'BibTeX…', enabled: docEnabled, click: () => void exportDocumentAs('bibtex') },
          { label: 'RIS…', enabled: docEnabled, click: () => void exportDocumentAs('ris') },
          { label: 'CSV…', enabled: docEnabled, click: () => void exportDocumentAs('csv') },
          { label: 'HTML…', enabled: docEnabled, click: () => void exportDocumentAs('html') },
        ],
      },
      { type: 'separator' },
      ...(isMac
        ? [{ role: 'close' as const }]
        : [prefsItem, { type: 'separator' as const }, { role: 'quit' as const }]),
    ],
  });

  // --- Edit ---
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
      { type: 'separator' },
      {
        label: 'Paste Publication',
        accelerator: 'Shift+CmdOrCtrl+V',
        enabled: docEnabled,
        click: () => sendMenuCommand('pastePublication'),
      },
      { type: 'separator' },
      {
        label: 'Find…',
        accelerator: 'CmdOrCtrl+F',
        enabled: docEnabled,
        click: () => sendMenuCommand('find'),
      },
      {
        label: 'Find & Replace…',
        accelerator: 'Alt+CmdOrCtrl+F',
        enabled: docEnabled,
        click: () => sendMenuCommand('findReplace'),
      },
      { type: 'separator' },
      {
        label: 'Copy Cite Key',
        accelerator: 'Alt+CmdOrCtrl+K',
        enabled: docEnabled,
        click: () => sendMenuCommand('copyCiteKey'),
      },
      {
        label: 'Copy Citation',
        enabled: docEnabled,
        click: () => sendMenuCommand('copyCitation'),
      },
      {
        label: 'Copy as BibTeX',
        accelerator: 'Alt+CmdOrCtrl+B',
        enabled: docEnabled,
        click: () => sendMenuCommand('copyBibtex'),
      },
      {
        label: 'Copy \\cite{…}',
        accelerator: 'Alt+CmdOrCtrl+C',
        enabled: docEnabled,
        click: () => sendMenuCommand('copyCite'),
      },
    ],
  });

  // --- Publication ---
  template.push({
    label: 'Publication',
    submenu: [
      {
        label: 'New Publication',
        accelerator: 'CmdOrCtrl+N',
        enabled: docEnabled,
        click: () => sendMenuCommand('newPublication'),
      },
      {
        label: 'Duplicate',
        accelerator: 'Shift+CmdOrCtrl+D',
        enabled: docEnabled,
        click: () => sendMenuCommand('duplicate'),
      },
      {
        label: 'Delete Publication',
        enabled: docEnabled,
        click: () => sendMenuCommand('delete'),
      },
      { type: 'separator' },
      {
        label: 'Generate Cite Key',
        accelerator: 'CmdOrCtrl+K',
        enabled: docEnabled,
        click: () => sendMenuCommand('generateCiteKey'),
      },
      {
        label: 'Find Duplicates…',
        enabled: docEnabled,
        click: () => sendMenuCommand('findDuplicates'),
      },
      { type: 'separator' },
      {
        label: 'Add File Attachment…',
        enabled: docEnabled,
        click: () => sendMenuCommand('addAttachment'),
      },
      { type: 'separator' },
      {
        label: 'Macros (@string)…',
        enabled: docEnabled,
        click: () => sendMenuCommand('editMacros'),
      },
    ],
  });

  // --- View ---
  template.push({
    label: 'View',
    submenu: [
      { label: 'Columns', submenu: columnMenuItems() },
      { type: 'separator' },
      {
        label: 'Toggle Light / Dark Theme',
        accelerator: 'CmdOrCtrl+Shift+L',
        click: () => sendMenuCommand('toggleTheme'),
      },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'reload' },
      { role: 'toggleDevTools' },
    ],
  });

  template.push({ role: 'window', label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [{ role: 'close' as const }])] });

  template.push({
    role: 'help',
    submenu: [
      {
        label: 'BibDesk Help',
        accelerator: isMac ? undefined : 'F1',
        click: () => openHelp(),
      },
    ],
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// IPC handler registration (full contract coverage via IpcHandlers)
// ---------------------------------------------------------------------------

/**
 * Open a URL (browser) or local file (default app). URLs are restricted to
 * http(s)/mailto (with bare-DOI → doi.org rewriting); file:// is stripped to a
 * path. Returns a result rather than throwing so the renderer can show a hint.
 */
async function openExternalTarget(req: OpenExternalRequest): Promise<OpenExternalResult> {
  try {
    if (req.kind === 'url') {
      let url = req.target.trim();
      if (/^10\.\d{4,9}\//.test(url)) url = `https://doi.org/${url}`; // bare DOI
      if (!/^(https?:|mailto:)/i.test(url)) {
        return { ok: false, error: 'Unsupported URL scheme' };
      }
      await shell.openExternal(url);
      return { ok: true };
    }
    let p = req.target.trim();
    const fileScheme = /^file:\/\/(localhost)?/i;
    if (fileScheme.test(p)) p = decodeURI(p.replace(fileScheme, ''));
    const err = await shell.openPath(p);
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function registerIpc(): void {
  // The handler set is typed by IpcHandlers so every channel is covered and the
  // request/response shapes are checked against the contract.
  const handlers: IpcHandlers = {
    [IpcChannels.openDocument]: (req) => openPath(req.path),
    [IpcChannels.closeDocument]: (req) => store.closeDocument(req),
    [IpcChannels.listPublications]: (req) => store.listPublications(req),
    [IpcChannels.listGroups]: (req) => store.listGroups(req),
    [IpcChannels.getItemDetail]: (req) => store.getItemDetail(req),
    [IpcChannels.openExternal]: (req) => openExternalTarget(req),
    [IpcChannels.applyEdit]: (req) => store.applyEdit(req),
    [IpcChannels.listMacros]: (req) => store.listMacros(req),
    [IpcChannels.saveDocument]: (req) => {
      const res = store.saveDocument(req.documentId, req.targetPath);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setTitle(`${basename(res.path)} — BibDesk`);
        mainWindow.setRepresentedFilename?.(res.path);
      }
      return res;
    },
    [IpcChannels.formatCitation]: (req) => {
      try {
        const html = formatCitation(store.cslItemFor(req.documentId, req.itemId), req.styleId);
        return { styleId: req.styleId, html };
      } catch (e) {
        return { styleId: req.styleId, html: '', error: e instanceof Error ? e.message : String(e) };
      }
    },
    [IpcChannels.addAttachment]: async (req) => {
      const opts: Electron.OpenDialogOptions = {
        title: 'Add Attachment',
        properties: ['openFile', 'multiSelections'],
      };
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) {
        return {
          dirty: store.isDirty(req.documentId),
          affectedItemId: req.itemId,
          detail: store.getItemDetail(req),
        };
      }
      return store.addAttachments(req.documentId, req.itemId, result.filePaths);
    },
    [IpcChannels.removeAttachment]: (req) =>
      store.removeAttachment(req.documentId, req.itemId, req.field),
    [IpcChannels.searchOnline]: async (req) => {
      try {
        const results = await searchOnline(req.source, req.query);
        return { results };
      } catch (e) {
        return { results: [], error: e instanceof Error ? e.message : String(e) };
      }
    },
    [IpcChannels.importOnline]: (req) =>
      store.importEntry(req.documentId, req.result.entryType, req.result.fields),
    [IpcChannels.ftsSearch]: (req) => store.ftsSearch(req.documentId, req.query),
    [IpcChannels.getSettings]: () => getSettings(),
    [IpcChannels.updateSettings]: (req) => {
      const s = updateSettings(req.patch);
      store.setEditConfig({ citeKeyFormat: s.citeKeyFormat, defaultEntryType: s.defaultEntryType });
      if (req.patch.columns) buildMenu(); // refresh View→Columns checkmarks
      return s;
    },
    [IpcChannels.readAttachment]: (req) => {
      const p = store.attachmentPath(req.documentId, req.itemId, req.url);
      if (!p) return { data: null, error: 'Attachment not found or not readable' };
      try {
        return { data: new Uint8Array(readFileSync(p)) };
      } catch (e) {
        return { data: null, error: e instanceof Error ? e.message : String(e) };
      }
    },
    [IpcChannels.exportText]: (req) => {
      try {
        return { text: store.exportText(req.documentId, req.format, req.itemIds) };
      } catch (e) {
        return { text: '', error: e instanceof Error ? e.message : String(e) };
      }
    },
    [IpcChannels.pasteEntries]: (req) => store.importBibtexText(req.documentId, req.text),
    [IpcChannels.importFiles]: (req) => store.importFiles(req.documentId, req.paths),
    [IpcChannels.importDialog]: async (req) => {
      const opts: Electron.OpenDialogOptions = {
        title: 'Import',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Bibliographies', extensions: ['bib', 'ris'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      };
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) {
        return { dirty: store.isDirty(req.documentId), addedIds: [], warnings: [] };
      }
      return store.importFiles(req.documentId, result.filePaths);
    },
    [IpcChannels.findReplace]: (req) => store.findReplace(req),
    [IpcChannels.findDuplicates]: (req) => store.findDuplicates(req.documentId),
    [IpcChannels.fieldSuggestions]: (req) => store.fieldSuggestions(req.documentId, req.field),
  };

  // ipcMain.handle prepends the IpcMainInvokeEvent; the contract handlers ignore it.
  ipcMain.handle(IpcChannels.openDocument, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.openDocument](req),
  );
  ipcMain.handle(IpcChannels.closeDocument, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.closeDocument](req),
  );
  ipcMain.handle(IpcChannels.listPublications, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.listPublications](req),
  );
  ipcMain.handle(IpcChannels.listGroups, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.listGroups](req),
  );
  ipcMain.handle(IpcChannels.getItemDetail, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.getItemDetail](req),
  );
  ipcMain.handle(IpcChannels.openExternal, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.openExternal](req),
  );
  ipcMain.handle(IpcChannels.applyEdit, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.applyEdit](req),
  );
  ipcMain.handle(IpcChannels.listMacros, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.listMacros](req),
  );
  ipcMain.handle(IpcChannels.saveDocument, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.saveDocument](req),
  );
  ipcMain.handle(IpcChannels.formatCitation, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.formatCitation](req),
  );
  ipcMain.handle(IpcChannels.addAttachment, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.addAttachment](req),
  );
  ipcMain.handle(IpcChannels.removeAttachment, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.removeAttachment](req),
  );
  ipcMain.handle(IpcChannels.searchOnline, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.searchOnline](req),
  );
  ipcMain.handle(IpcChannels.importOnline, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.importOnline](req),
  );
  ipcMain.handle(IpcChannels.ftsSearch, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.ftsSearch](req),
  );
  ipcMain.handle(IpcChannels.getSettings, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.getSettings](req),
  );
  ipcMain.handle(IpcChannels.updateSettings, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.updateSettings](req),
  );
  ipcMain.handle(IpcChannels.readAttachment, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.readAttachment](req),
  );
  ipcMain.handle(IpcChannels.exportText, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.exportText](req),
  );
  ipcMain.handle(IpcChannels.pasteEntries, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.pasteEntries](req),
  );
  ipcMain.handle(IpcChannels.importFiles, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.importFiles](req),
  );
  ipcMain.handle(IpcChannels.importDialog, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.importDialog](req),
  );
  ipcMain.handle(IpcChannels.findReplace, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.findReplace](req),
  );
  ipcMain.handle(IpcChannels.findDuplicates, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.findDuplicates](req),
  );
  ipcMain.handle(IpcChannels.fieldSuggestions, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.fieldSuggestions](req),
  );
}

// ---------------------------------------------------------------------------
// macOS open-file (must be registered before `ready`)
// ---------------------------------------------------------------------------

app.on('open-file', (event, path) => {
  event.preventDefault();
  if (path.toLowerCase().endsWith('.bib')) {
    openPathWhenReady(path);
  }
});

// No untitled file: only re-show the main window on activate-with-no-windows.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// Single-instance lock: route a second-instance launch's path into this one.
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    for (const arg of argv.slice(1)) {
      if (arg.toLowerCase().endsWith('.bib') && existsSync(arg)) {
        openPathWhenReady(arg);
        break;
      }
    }
  });

  void app.whenReady().then(() => {
    const settings = loadSettings();
    store.setEditConfig({
      citeKeyFormat: settings.citeKeyFormat,
      defaultEntryType: settings.defaultEntryType,
    });
    registerIpc();
    buildMenu();
    mainWindow = createWindow();

    // Auto-open from BIBDESK_OPEN / CLI, or honor a path buffered by open-file.
    const startup = pendingOpenPath ?? startupOpenPath();
    pendingOpenPath = null;
    if (startup) openPathWhenReady(startup);

    if (process.env.BIBDESK_OPEN_HELP) setTimeout(openHelp, 600);
    if (process.env.BIBDESK_OPEN_PREFS) setTimeout(openPreferences, 1400);
  });
}
