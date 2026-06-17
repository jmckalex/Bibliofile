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
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  shell,
  safeStorage,
  clipboard,
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
  type PrintRequest,
  type PrintResponse,
} from '@bibdesk/shared';

import { DocumentStore } from './document-service.js';
import { runAgentTurn } from './agent.js';
import { parseAppUrl } from './app-url.js';
import { dispatchBridge } from './bridge.js';
import { htmlToRtf, wrapRtf } from './rtf.js';
import { buildPrintHtml } from './print.js';
import { loadCoverIndex, resolveCover, coverFilePath } from './journal-covers.js';
import { formatCitation } from './csl.js';
import { searchOnline, extractDoi } from './online.js';
import { extractPdfText } from './pdf-text.js';
import { buildHelpHtml, findHelpDir } from './help.js';
import { getSettings, loadSettings, updateSettings } from './settings.js';

// A stable product name so userData (settings, agent key, automation
// `bridge.json`) lives at a predictable `…/Application Support/BibDesk/` path the
// native helpers can find — instead of the `@bibdesk/app` package name.
app.setName('BibDesk');

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
        // optionally Cmd-click extra rows to exercise multi-select + the batch bar
        const multi = process.env.BIBDESK_SMOKE_MULTI
          ? "document.querySelectorAll('.bd-tr')[1]?.dispatchEvent(new MouseEvent('click',{bubbles:true,metaKey:true}));document.querySelectorAll('.bd-tr')[2]?.dispatchEvent(new MouseEvent('click',{bubbles:true,metaKey:true}));"
          : '';
        // optionally click an arbitrary selector after a short delay (opens a panel/dialog)
        const click = process.env.BIBDESK_SMOKE_CLICK
          ? `setTimeout(()=>document.querySelector(${JSON.stringify(process.env.BIBDESK_SMOKE_CLICK)})?.click(),700);`
          : '';
        // optionally double-click a selector (exercises inline-rename editors)
        const dblclick = process.env.BIBDESK_SMOKE_DBLCLICK
          ? `setTimeout(()=>document.querySelector(${JSON.stringify(process.env.BIBDESK_SMOKE_DBLCLICK)})?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})),700);`
          : '';
        void win.webContents
          .executeJavaScript(`document.querySelector('.bd-tr')?.click();${dark}${pdf}${paste}${multi}${click}${dblclick} true`)
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

/** Re-notify the renderer of the open document so it reloads after a main-side mutation. */
function refreshOpenDocument(): void {
  if (lastDocumentId) notifyDocumentOpened(store.summarize(lastDocumentId));
}

/** Strip an HTML citation fragment to plain text (for the clipboard text flavor). */
function htmlToPlain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Import dropped files, upgrading PDFs: extract the PDF's text, find a DOI, look
 * it up (CrossRef), and import the real metadata + attach the PDF — instead of a
 * filename-stub entry. PDFs with no DOI (and all non-PDFs) fall back to the
 * store's plain import. Returns the combined {@link ImportResult}-shaped result.
 */
async function importFilesSmart(
  documentId: string,
  paths: readonly string[],
): Promise<{ dirty: boolean; addedIds: string[]; warnings: string[] }> {
  const isPdf = (p: string): boolean => /\.pdf$/i.test(p);
  const addedIds: string[] = [];
  const warnings: string[] = [];

  for (const pdf of paths.filter(isPdf)) {
    let handled = false;
    try {
      const doi = extractDoi(await extractPdfText(pdf, 3)); // first few pages
      if (doi) {
        const results = await searchOnline('doi', doi).catch(() => []);
        const r = results[0];
        if (r) {
          const res = store.importEntry(documentId, r.entryType, r.fields);
          if (res.affectedItemId) {
            store.addAttachments(documentId, res.affectedItemId, [pdf]);
            addedIds.push(res.affectedItemId);
            handled = true;
          }
        }
      }
    } catch {
      /* fall through to the stub-entry import below */
    }
    if (!handled) {
      const r = store.importFiles(documentId, [pdf]);
      addedIds.push(...r.addedIds);
      warnings.push(...r.warnings);
    }
  }

  const others = paths.filter((p) => !isPdf(p));
  if (others.length) {
    const r = store.importFiles(documentId, others);
    addedIds.push(...r.addedIds);
    warnings.push(...r.warnings);
  }
  return { dirty: store.isDirty(documentId), addedIds, warnings };
}

/** Build a complete RTF bibliography document for the whole library (CSL-formatted). */
function buildLibraryRtf(documentId: string, styleId: string): string {
  const ids = store.listPublications({ documentId, offset: 0, limit: -1 }).rows.map((r) => r.id);
  const paras = ids.map((id) => htmlToRtf(formatCitation(store.cslItemFor(documentId, id), styleId)));
  return wrapRtf(paras);
}

/**
 * Print a CSL-formatted bibliography for the given items: render to a print-ready
 * HTML document, load it into an offscreen window, and invoke the OS print
 * dialog (which on macOS also offers Save as PDF). A user cancel counts as ok.
 */
async function printItems(req: PrintRequest): Promise<PrintResponse> {
  const entries = req.itemIds.map((id) => formatCitation(store.cslItemFor(req.documentId, id), req.styleId));
  const html = buildPrintHtml(entries, req.title);
  // A temp file avoids data-URL length limits for large bibliographies.
  const file = join(tmpdir(), `bibdesk-print-${randomBytes(6).toString('hex')}.html`);
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    writeFileSync(file, html, 'utf8');
    await win.loadFile(file);
    await new Promise<void>((resolvePrint, reject) => {
      win.webContents.print({ silent: false }, (success, failureReason) => {
        // Chromium reports a user cancel as success=false / 'cancelled' — not an error.
        if (!success && failureReason && failureReason !== 'cancelled') {
          reject(new Error(failureReason));
        } else {
          resolvePrint();
        }
      });
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (!win.isDestroyed()) win.close();
    try {
      rmSync(file, { force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  }
}

/**
 * Dispatch an `x-bibdesk://` automation URL (AppleScript / shell / other apps).
 * Commands: `open?file=`, `import?bibtex=|doi=`, `new?type=&Field=…`. Mutating
 * commands refresh the renderer; unknown/no-op commands are ignored.
 */
function handleAppUrl(raw: string): void {
  const action = parseAppUrl(raw);
  if (!action) return;
  const { command, params } = action;
  switch (command) {
    case 'open':
      if (params.file) openPathWhenReady(params.file);
      return;
    case 'import':
      if (!lastDocumentId) return;
      if (params.bibtex) {
        store.importBibtexText(lastDocumentId, params.bibtex);
        refreshOpenDocument();
      } else if (params.doi) {
        const docId = lastDocumentId;
        void searchOnline('doi', params.doi)
          .then((results) => {
            const r = results[0];
            if (r) {
              store.importEntry(docId, r.entryType, r.fields);
              refreshOpenDocument();
            }
          })
          .catch((e) => console.error('[x-bibdesk] doi import failed:', e));
      }
      return;
    case 'new': {
      if (!lastDocumentId) return;
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(params)) if (k.toLowerCase() !== 'type') fields[k] = v;
      store.importEntry(lastDocumentId, params.type || 'misc', fields);
      refreshOpenDocument();
      return;
    }
    default:
      return; // unknown command — ignore
  }
}

/**
 * Start the local automation bridge: a loopback (127.0.0.1), token-authed HTTP
 * server exposing the {@link dispatchBridge} command surface. The port + token are
 * written to `bridge.json` under userData so AppleScript/shell and the native
 * helper apps can discover and call it. Loopback-only + a per-launch token keep it
 * off the network and away from other local users.
 */
function startBridge(): void {
  const token = randomBytes(24).toString('hex');
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const given = (req.headers['x-bibdesk-token'] as string | undefined) ?? url.searchParams.get('token') ?? '';
    if (given !== token) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
      return;
    }
    const method = url.pathname.replace(/^\/+/, '') || 'ping';
    const params: Record<string, string> = {};
    for (const [k, v] of url.searchParams) if (k !== 'token') params[k] = v;
    let result;
    try {
      result = dispatchBridge(store, lastDocumentId, { method, params });
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if ((result as { mutated?: boolean }).mutated) refreshOpenDocument();
    res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
  });
  server.on('error', (e) => console.error('[bridge] server error:', e.message));
  server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      writeFileSync(
        join(app.getPath('userData'), 'bridge.json'),
        JSON.stringify({ port, token, pid: process.pid }, null, 2),
      );
    } catch {
      /* non-fatal: automation just won't be discoverable */
    }
    if (process.env.BIBDESK_SMOKE) console.log(`[smoke] bridge on 127.0.0.1:${port}`);
  });
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

/** Document-level Undo: restore the previous snapshot and re-sync the renderer. */
function doUndo(): void {
  if (lastDocumentId && store.undo(lastDocumentId)) {
    notifyDocumentOpened(store.summarize(lastDocumentId));
  }
}

/** Document-level Redo. */
function doRedo(): void {
  if (lastDocumentId && store.redo(lastDocumentId)) {
    notifyDocumentOpened(store.summarize(lastDocumentId));
  }
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
const EXPORT_EXT: Record<'bibtex' | 'ris' | 'csv' | 'html' | 'rtf', string> = {
  bibtex: 'bib',
  ris: 'ris',
  csv: 'csv',
  html: 'html',
  rtf: 'rtf',
};

/** Export the whole library to a file in the given format. */
async function exportDocumentAs(format: 'bibtex' | 'ris' | 'csv' | 'html' | 'rtf'): Promise<void> {
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
    // RTF is a CSL-formatted bibliography (built here); the rest serialize in the store.
    const text =
      format === 'rtf'
        ? buildLibraryRtf(lastDocumentId, getSettings().defaultCiteStyle)
        : store.exportText(lastDocumentId, format);
    writeFileSync(result.filePath, text, 'utf8');
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
            label: 'From File (BibTeX / RIS / EndNote)…',
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
          { label: 'RTF (formatted bibliography)…', enabled: docEnabled, click: () => void exportDocumentAs('rtf') },
        ],
      },
      { type: 'separator' },
      {
        label: 'Print…',
        accelerator: 'CmdOrCtrl+P',
        enabled: docEnabled,
        click: () => sendMenuCommand('print'),
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
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', enabled: docEnabled, click: () => doUndo() },
      {
        label: 'Redo',
        accelerator: 'Shift+CmdOrCtrl+Z',
        enabled: docEnabled,
        click: () => doRedo(),
      },
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
        label: 'Copy Citation as RTF',
        accelerator: 'Alt+CmdOrCtrl+R',
        enabled: docEnabled,
        click: () => sendMenuCommand('copyRtf'),
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
      {
        label: 'AutoFile Linked Files',
        enabled: docEnabled,
        click: () => sendMenuCommand('autoFile'),
      },
      {
        label: 'Find Broken Links…',
        enabled: docEnabled,
        click: () => sendMenuCommand('findBrokenLinks'),
      },
      { type: 'separator' },
      {
        label: 'Macros (@string)…',
        enabled: docEnabled,
        click: () => sendMenuCommand('editMacros'),
      },
    ],
  });

  // --- Tools ---
  template.push({
    label: 'Tools',
    submenu: [
      {
        label: 'Claude Assistant…',
        accelerator: 'CmdOrCtrl+J',
        enabled: docEnabled,
        click: () => sendMenuCommand('assistant'),
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

// ---------------------------------------------------------------------------
// Claude assistant: API key (safeStorage), HTTPS call, tool dispatch, approval
// ---------------------------------------------------------------------------

/** Per-document Anthropic-format conversation history. */
const agentHistories = new Map<string, unknown[]>();

function agentKeyPath(): string {
  return join(app.getPath('userData'), 'agent-key.bin');
}

function hasAgentKey(): boolean {
  return existsSync(agentKeyPath());
}

/** Decrypt and return the stored Anthropic key, or null. */
function loadAgentKey(): string | null {
  try {
    if (!hasAgentKey() || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(readFileSync(agentKeyPath()));
  } catch {
    return null;
  }
}

/** Store (or, with an empty string, delete) the Anthropic key, encrypted at rest. */
function saveAgentKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) {
    if (hasAgentKey()) {
      try {
        rmSync(agentKeyPath());
      } catch {
        /* ignore */
      }
    }
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is unavailable.');
  writeFileSync(agentKeyPath(), safeStorage.encryptString(trimmed));
}

/** POST to the Anthropic Messages API; returns the parsed body (or an error shape). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callAnthropic(body: any, apiKey: string): Promise<any> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: { message: `HTTP ${res.status}: ${text.slice(0, 400)}` } };
    }
    return await res.json();
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

/** Ask the user to approve a mutating assistant action (native dialog). */
async function approveAgentTool(name: string, input: unknown): Promise<boolean> {
  const result = await dialog.showMessageBox(mainWindow ?? undefined!, {
    type: 'question',
    buttons: ['Approve', 'Deny'],
    defaultId: 0,
    cancelId: 1,
    message: `The assistant wants to run “${name}”.`,
    detail: JSON.stringify(input, null, 2),
  });
  return result.response === 0;
}

/** Execute one assistant tool against the open document; return a string result. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function executeAgentTool(documentId: string, name: string, input: any): string {
  const idFor = (citeKey: string): string | undefined => store.itemIdForCiteKey(documentId, citeKey);
  switch (name) {
    case 'list_entries': {
      const rows = store.listPublications({ documentId, offset: 0, limit: -1 }).rows;
      return (
        rows
          .map((r) => `${r.citeKey} — ${r.title || '(untitled)'} (${r.type}${r.year ? ', ' + r.year : ''})`)
          .join('\n') || '(the library is empty)'
      );
    }
    case 'get_entry': {
      const id = idFor(input.citeKey);
      if (!id) return `No entry with cite key "${input.citeKey}".`;
      const d = store.getItemDetail({ documentId, itemId: id });
      return `${d.citeKey} [${d.type}]\n` + d.fields.map((f) => `${f.name}: ${f.rawValue}`).join('\n');
    }
    case 'search': {
      const q = String(input.query ?? '').toLowerCase();
      const rows = store.listPublications({ documentId, offset: 0, limit: -1 }).rows;
      const hits = rows.filter((r) =>
        [r.citeKey, r.title, r.authorsDisplay, r.year].some((v) => v.toLowerCase().includes(q)),
      );
      return hits.map((r) => `${r.citeKey} — ${r.title}`).join('\n') || '(no matches)';
    }
    case 'find_duplicates': {
      const res = store.findDuplicates(documentId);
      if (res.groups.length === 0) return 'No duplicates found.';
      return res.groups
        .map((g) => `${g.kind}: ${g.entries.map((e) => e.citeKey).join(', ')}`)
        .join('\n');
    }
    case 'export': {
      const ids = Array.isArray(input.citeKeys)
        ? (input.citeKeys as string[]).map(idFor).filter((x): x is string => !!x)
        : undefined;
      const text = store.exportText(documentId, input.format, ids);
      return text.length > 20000 ? text.slice(0, 20000) + '\n…(truncated)' : text;
    }
    case 'set_field': {
      const id = idFor(input.citeKey);
      if (!id) return `No entry with cite key "${input.citeKey}".`;
      store.applyEdit({ documentId, command: { kind: 'setField', itemId: id, field: input.field, value: String(input.value ?? '') } });
      return `Set ${input.field} on ${input.citeKey}.`;
    }
    case 'add_entry': {
      const res = store.importEntry(documentId, String(input.type ?? 'misc'), input.fields ?? {});
      const key = res.affectedItemId
        ? store.getItemDetail({ documentId, itemId: res.affectedItemId }).citeKey
        : '(new)';
      return `Added entry ${key}.`;
    }
    case 'delete_entry': {
      const id = idFor(input.citeKey);
      if (!id) return `No entry with cite key "${input.citeKey}".`;
      store.applyEdit({ documentId, command: { kind: 'deleteEntry', itemId: id } });
      return `Deleted ${input.citeKey}.`;
    }
    case 'generate_cite_key': {
      const id = idFor(input.citeKey);
      if (!id) return `No entry with cite key "${input.citeKey}".`;
      const res = store.applyEdit({ documentId, command: { kind: 'generateCiteKey', itemId: id } });
      const key = res.affectedItemId
        ? store.getItemDetail({ documentId, itemId: res.affectedItemId }).citeKey
        : input.citeKey;
      return `Cite key is now ${key}.`;
    }
    default:
      return `Unknown tool: ${name}`;
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
    [IpcChannels.batchEdit]: (req) => store.batchEdit(req.documentId, req.itemIds, req.op),
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
    [IpcChannels.copyRtf]: (req) => {
      try {
        const html = formatCitation(store.cslItemFor(req.documentId, req.itemId), req.styleId);
        clipboard.write({ rtf: wrapRtf([htmlToRtf(html)]), text: htmlToPlain(html) });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    [IpcChannels.journalCover]: (req) => {
      const journal =
        store.fieldValue(req.documentId, req.itemId, 'Journal') ||
        store.fieldValue(req.documentId, req.itemId, 'Booktitle');
      const loaded = loadCoverIndex(app.getAppPath());
      if (!loaded) return { data: null, ...(journal ? { journal } : {}) };
      const issn = store.fieldValue(req.documentId, req.itemId, 'Issn');
      const hit = resolveCover(loaded.index, issn, journal);
      if (!hit) return { data: null, ...(journal ? { journal } : {}) };
      try {
        return {
          data: new Uint8Array(readFileSync(coverFilePath(loaded.dir, hit.file))),
          kind: hit.kind,
          ...(journal ? { journal } : {}),
        };
      } catch {
        return { data: null, ...(journal ? { journal } : {}) };
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
    [IpcChannels.findBrokenLinks]: (req) => ({ links: store.findBrokenLinks(req.documentId) }),
    [IpcChannels.relocateAttachment]: async (req) => {
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, { title: 'Locate File', properties: ['openFile'] })
        : await dialog.showOpenDialog({ title: 'Locate File', properties: ['openFile'] });
      const picked = result.canceled ? undefined : result.filePaths[0];
      if (!picked) {
        return {
          dirty: store.isDirty(req.documentId),
          affectedItemId: req.itemId,
          detail: store.getItemDetail({ documentId: req.documentId, itemId: req.itemId }),
        };
      }
      return store.relocateAttachment(req.documentId, req.itemId, req.field, picked);
    },
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
      store.setEditConfig({
        citeKeyFormat: s.citeKeyFormat,
        defaultEntryType: s.defaultEntryType,
        papersFolder: s.papersFolder,
        autoFileFormat: s.autoFileFormat,
      });
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
    [IpcChannels.print]: (req) => printItems(req),
    [IpcChannels.pasteEntries]: (req) => store.importBibtexText(req.documentId, req.text),
    [IpcChannels.importFiles]: (req) => importFilesSmart(req.documentId, req.paths),
    [IpcChannels.importDialog]: async (req) => {
      const opts: Electron.OpenDialogOptions = {
        title: 'Import',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Bibliographies', extensions: ['bib', 'ris', 'enw', 'enl', 'xml'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      };
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) {
        return { dirty: store.isDirty(req.documentId), addedIds: [], warnings: [] };
      }
      return importFilesSmart(req.documentId, result.filePaths);
    },
    [IpcChannels.findReplace]: (req) => store.findReplace(req),
    [IpcChannels.findDuplicates]: (req) => store.findDuplicates(req.documentId),
    [IpcChannels.groupEdit]: (req) => store.groupEdit(req),
    [IpcChannels.groupConditions]: (req) => store.groupConditions(req),
    [IpcChannels.renameAuthor]: (req) => store.renameAuthor(req.documentId, req.oldName, req.newName),
    [IpcChannels.fieldSuggestions]: (req) => store.fieldSuggestions(req.documentId, req.field),
    [IpcChannels.autoFile]: (req) => {
      const res = store.autoFile(req.documentId, req.itemId);
      return { ...res, dirty: store.isDirty(req.documentId) };
    },
    [IpcChannels.chooseFolder]: async () => {
      const opts: Electron.OpenDialogOptions = {
        title: 'Choose Papers Folder',
        properties: ['openDirectory', 'createDirectory'],
      };
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, opts)
        : await dialog.showOpenDialog(opts);
      return { path: result.canceled || !result.filePaths[0] ? null : result.filePaths[0] };
    },
    [IpcChannels.agentKeyStatus]: () => ({
      hasKey: hasAgentKey(),
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    }),
    [IpcChannels.agentSetKey]: (req) => {
      saveAgentKey(req.key);
      return { hasKey: hasAgentKey(), encryptionAvailable: safeStorage.isEncryptionAvailable() };
    },
    [IpcChannels.agentReset]: (req) => {
      agentHistories.delete(req.documentId);
      return { ok: true };
    },
    [IpcChannels.agentRun]: async (req) => {
      const apiKey = loadAgentKey();
      if (!apiKey) {
        return { reply: '', toolLog: [], mutated: false, error: 'No Anthropic API key set (Preferences → Claude Assistant).' };
      }
      const history = agentHistories.get(req.documentId) ?? [];
      history.push({ role: 'user', content: req.message });
      const result = await runAgentTurn(history, {
        model: getSettings().agentModel || 'claude-opus-4-8',
        callModel: (body) => callAnthropic(body, apiKey),
        executeTool: (name, input) => executeAgentTool(req.documentId, name, input),
        approve: (name, input) => approveAgentTool(name, input),
      });
      agentHistories.set(req.documentId, history);
      return result;
    },
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
  ipcMain.handle(IpcChannels.batchEdit, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.batchEdit](req),
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
  ipcMain.handle(IpcChannels.copyRtf, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.copyRtf](req),
  );
  ipcMain.handle(IpcChannels.journalCover, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.journalCover](req),
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
  ipcMain.handle(IpcChannels.print, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.print](req),
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
  ipcMain.handle(IpcChannels.findBrokenLinks, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.findBrokenLinks](req),
  );
  ipcMain.handle(IpcChannels.relocateAttachment, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.relocateAttachment](req),
  );
  ipcMain.handle(IpcChannels.groupEdit, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.groupEdit](req),
  );
  ipcMain.handle(IpcChannels.groupConditions, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.groupConditions](req),
  );
  ipcMain.handle(IpcChannels.renameAuthor, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.renameAuthor](req),
  );
  ipcMain.handle(IpcChannels.fieldSuggestions, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.fieldSuggestions](req),
  );
  ipcMain.handle(IpcChannels.autoFile, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.autoFile](req),
  );
  ipcMain.handle(IpcChannels.chooseFolder, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.chooseFolder](req),
  );
  ipcMain.handle(IpcChannels.agentKeyStatus, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.agentKeyStatus](req),
  );
  ipcMain.handle(IpcChannels.agentSetKey, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.agentSetKey](req),
  );
  ipcMain.handle(IpcChannels.agentReset, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.agentReset](req),
  );
  ipcMain.handle(IpcChannels.agentRun, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.agentRun](req),
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

// macOS automation: `open location "x-bibdesk://…"` (AppleScript) delivers here.
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAppUrl(url);
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
    // Windows/Linux deliver the protocol URL (and .bib paths) via argv.
    for (const arg of argv.slice(1)) {
      if (arg.startsWith('x-bibdesk://')) {
        handleAppUrl(arg);
        break;
      }
      if (arg.toLowerCase().endsWith('.bib') && existsSync(arg)) {
        openPathWhenReady(arg);
        break;
      }
    }
  });

  void app.whenReady().then(() => {
    // Register the automation URL scheme (AppleScript / shell / other apps).
    app.setAsDefaultProtocolClient('x-bibdesk');

    const settings = loadSettings();
    store.setEditConfig({
      citeKeyFormat: settings.citeKeyFormat,
      defaultEntryType: settings.defaultEntryType,
      papersFolder: settings.papersFolder,
      autoFileFormat: settings.autoFileFormat,
    });
    registerIpc();
    buildMenu();
    startBridge();
    mainWindow = createWindow();

    // Auto-open from BIBDESK_OPEN / CLI, or honor a path buffered by open-file.
    const startup = pendingOpenPath ?? startupOpenPath();
    pendingOpenPath = null;
    if (startup) openPathWhenReady(startup);

    // A protocol URL passed on the initial command line (Windows/Linux cold start).
    const urlArg = process.argv.find((a) => a.startsWith('x-bibdesk://'));
    if (urlArg) handleAppUrl(urlArg);

    if (process.env.BIBDESK_OPEN_HELP) setTimeout(openHelp, 600);
    if (process.env.BIBDESK_OPEN_PREFS) setTimeout(openPreferences, 1400);
  });
}
