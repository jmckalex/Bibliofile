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

import { join } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';

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
  type OpenedDocument,
  type OpenExternalRequest,
  type OpenExternalResult,
} from '@bibdesk/shared';

import { DocumentStore } from './document-service.js';

// ---------------------------------------------------------------------------
// Process-wide singletons
// ---------------------------------------------------------------------------

/** The one document store for this process (pure; no Electron deps). */
const store = new DocumentStore();

/** The main window (one window in this read-only viewer session). */
let mainWindow: BrowserWindow | null = null;

/** A `.bib` path requested before the window/renderer was ready. */
let pendingOpenPath: string | null = null;

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
      win.webContents
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
        void win.webContents
          .executeJavaScript(`document.querySelector('.bd-tr')?.click();${dark} true`)
          .catch(() => undefined)
          .finally(() => setTimeout(capture, 1800));
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
  notifyDocumentOpened(opened);
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

/** Open a path now if the window exists, else stash it for after launch. */
function openPathWhenReady(path: string): void {
  if (mainWindow) {
    try {
      openPath(path);
    } catch (err) {
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

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: 'File',
    submenu: [
      {
        label: 'Open…',
        accelerator: 'CmdOrCtrl+O',
        click: () => {
          void showOpenDialog();
        },
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  });

  template.push({ label: 'Edit', role: 'editMenu' });
  template.push({ label: 'View', role: 'viewMenu' });
  template.push({ label: 'Window', role: 'windowMenu' });

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
    registerIpc();
    buildMenu();
    mainWindow = createWindow();

    // Auto-open from BIBDESK_OPEN / CLI, or honor a path buffered by open-file.
    const startup = pendingOpenPath ?? startupOpenPath();
    pendingOpenPath = null;
    if (startup) openPathWhenReady(startup);
  });
}
