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

import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  type ExportSelectionRequest,
  type ExportSelectionResponse,
  type EntryTypeInfo,
  type TemplateExportScope,
} from '@bibdesk/shared';
import { sharedTypeManager } from '@bibdesk/model';

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
import { PdfPool } from './pdf-pool.js';
import { PdfTextCache } from './pdf-cache.js';
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

/**
 * Open library windows, keyed by the documentId each one shows. The app is
 * multi-document: one library window per open `.bib`. (Per-entry editor windows
 * live in `editorWindows`; the manual is `helpWindow`.)
 */
const docWindows = new Map<string, BrowserWindow>();

/** documentId of the most recently focused library window (menu/save fallback). */
let lastFocusedDocId: string | null = null;

/** A `.bib` path requested before any window/renderer was ready. */
let pendingOpenPath: string | null = null;

/** The documentId shown in `win`, or null if it is not a library window. */
function docIdForWindow(win: BrowserWindow | null): string | null {
  if (!win) return null;
  for (const [id, w] of docWindows) if (w === win) return id;
  return null;
}

/** Any still-open library window's documentId (last-resort fallback). */
function firstLibraryDocId(): string | null {
  for (const [id, w] of docWindows) if (!w.isDestroyed()) return id;
  return null;
}

/** The library window showing `documentId`, if still open. */
function windowForDoc(documentId: string | null): BrowserWindow | undefined {
  if (!documentId) return undefined;
  const w = docWindows.get(documentId);
  return w && !w.isDestroyed() ? w : undefined;
}

/**
 * The documentId the document-scoped actions (Save, Undo, Export, the bridge…)
 * apply to: the focused library window's document, else the last focused one,
 * else any open library. Null when no library is open.
 */
function focusedDocId(): string | null {
  const id = docIdForWindow(BrowserWindow.getFocusedWindow());
  if (id) return id;
  if (windowForDoc(lastFocusedDocId)) return lastFocusedDocId;
  return firstLibraryDocId();
}

/** The library window the document-scoped dialogs/menus should attach to. */
function focusedWindow(): BrowserWindow | undefined {
  return windowForDoc(focusedDocId());
}

/**
 * A focused, document-less window a newly opened library can be loaded into (so
 * opening from the welcome screen reuses that window). Undefined → make a new one.
 */
function reusableWelcomeWindow(): BrowserWindow | undefined {
  const f = BrowserWindow.getFocusedWindow();
  if (!f || f.isDestroyed() || f === helpWindow) return undefined;
  if (docIdForWindow(f)) return undefined; // already shows a library
  for (const w of editorWindows.values()) if (w === f) return undefined; // a per-entry editor
  return f;
}

/** The library window currently showing `path`, if that file is already open. */
function windowForPath(path: string): BrowserWindow | undefined {
  const abs = resolve(path);
  for (const [id, w] of docWindows) {
    if (w.isDestroyed()) continue;
    try {
      if (resolve(store.summarize(id).path) === abs) return w;
    } catch {
      /* doc no longer in the store */
    }
  }
  return undefined;
}

/** Windows that already have their focus/close/closed listeners wired (attach once). */
const wiredWindows = new WeakSet<BrowserWindow>();

/** Windows whose unsaved-changes close prompt has been answered "close anyway". */
const closeConfirmed = new WeakSet<BrowserWindow>();

/**
 * Bind `win` to `documentId` (the library it now shows). Idempotent per window:
 * reusing a window for a new document (welcome-screen reuse, Revert) drops and
 * closes the previously shown document, but the focus/closed listeners attach
 * only once.
 */
function bindWindowToDoc(win: BrowserWindow, documentId: string): void {
  const prev = docIdForWindow(win);
  if (prev && prev !== documentId) {
    docWindows.delete(prev);
    try {
      store.closeDocument({ documentId: prev });
    } catch {
      /* already gone */
    }
  }
  docWindows.set(documentId, win);
  lastFocusedDocId = documentId;
  if (wiredWindows.has(win)) return;
  wiredWindows.add(win);
  win.on('focus', () => {
    const id = docIdForWindow(win);
    if (id) lastFocusedDocId = id;
  });
  // Prompt to save unsaved changes before a library window closes.
  win.on('close', (e) => {
    if (closeConfirmed.has(win)) return; // already answered
    const id = docIdForWindow(win);
    if (!id || !store.isDirty(id)) return; // nothing unsaved → let it close
    e.preventDefault();
    const { displayName, path } = store.summarize(id);
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: `Save changes to “${displayName}” before closing?`,
      detail: 'Your changes will be lost if you don’t save them.',
    });
    if (choice === 2) return; // Cancel → keep the window open
    if (choice === 0) {
      try {
        store.saveDocument(id, path);
      } catch (err) {
        void dialog.showMessageBox(win, {
          type: 'error',
          message: 'Could not save the document',
          detail: err instanceof Error ? err.message : String(err),
        });
        return; // save failed → keep the window open
      }
    }
    closeConfirmed.add(win);
    win.close();
  });
  win.on('closed', () => {
    const id = docIdForWindow(win);
    if (id) {
      docWindows.delete(id);
      if (lastFocusedDocId === id) lastFocusedDocId = firstLibraryDocId();
      try {
        store.closeDocument({ documentId: id });
      } catch {
        /* already gone */
      }
    }
    buildMenu(); // refresh document-scoped + Window menus
  });
}

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
      const smokeDocId = focusedDocId();
      if (smokeDocId) {
        try {
          const r = store.ftsSearch(smokeDocId, 'basel');
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

/** Standalone editor windows, keyed by `${documentId}::${itemId}` (one per item). */
const editorWindows = new Map<string, BrowserWindow>();

/**
 * Open (or focus) the standalone editor window for one item — the BibDesk-style
 * separate editor. It loads the same renderer with a `#editor=<doc>::<item>`
 * hash; the renderer mounts the edit UI for that item and talks to the shared
 * main-process document store. Edits broadcast back so the main window refreshes.
 */
function createEditorWindow(documentId: string, itemId: string): void {
  const key = `${documentId}::${itemId}`;
  const existing = editorWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 420,
    minHeight: 360,
    show: false,
    title: 'Edit Publication — BibDesk',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  const hash = `editor=${encodeURIComponent(documentId)}::${encodeURIComponent(itemId)}`;
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(`${devUrl}#${hash}`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash });
  }
  editorWindows.set(key, win);
  win.on('closed', () => editorWindows.delete(key));
}

/**
 * Tell every window EXCEPT the originator that the open document changed, so it
 * can refresh (e.g. the main window's table + read-only view after an edit made
 * in a separate editor window, or an editor after a main-window edit).
 */
function broadcastDocumentChanged(documentId: string, except?: Electron.WebContents): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents !== except && w !== helpWindow) {
      w.webContents.send(IpcEvents.documentChanged, { documentId });
    }
  }
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
/**
 * Lazily-created PDF extraction pool + persistent text cache. The pool runs
 * pdfjs in worker threads (off the main loop, parallel across cores); the cache
 * skips re-extraction of unchanged files across sessions. `pdfExtract` is the
 * combined extractor handed to {@link DocumentStore.indexAttachments}.
 */
let pdfPool: PdfPool | undefined;
let pdfCache: PdfTextCache | undefined;

function ensurePdf(): { pool: PdfPool; cache: PdfTextCache } {
  if (!pdfPool) pdfPool = new PdfPool(join(__dirname, 'pdf-worker.js'));
  if (!pdfCache) pdfCache = new PdfTextCache(join(app.getPath('userData'), 'pdf-text-cache.json'));
  return { pool: pdfPool, cache: pdfCache };
}

/** Extract one PDF's text: cache hit, else a worker-thread extraction (then cached). */
async function pdfExtract(absPath: string): Promise<string> {
  const { pool, cache } = ensurePdf();
  const cached = cache.get(absPath);
  if (cached !== undefined) return cached;
  const text = await pool.extract(absPath);
  cache.set(absPath, text);
  return text;
}

/**
 * Open a `.bib` by absolute path into a library window. If the file is already
 * open, focus its window instead of re-parsing. Otherwise load it into the
 * supplied `target`, a reusable focused welcome window, or a fresh window; bind
 * the window to the parsed document, set the title, and notify it. Returns the
 * document summary. Throws on read/parse failure.
 */
function openPath(path: string, target?: BrowserWindow): OpenedDocument {
  const existing = windowForPath(path);
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return store.summarize(docIdForWindow(existing)!);
  }
  const win = target ?? reusableWelcomeWindow() ?? createWindow();
  return loadDocumentInto(win, path);
}

/**
 * Parse `path` and show it in `win` (binding, title, notify, background index).
 * Bypasses the "already open" check so Revert can re-read into the same window.
 */
function loadDocumentInto(win: BrowserWindow, path: string): OpenedDocument {
  const opened = store.openFile(path);
  app.addRecentDocument(path);
  bindWindowToDoc(win, opened.documentId);
  setWindowTitle(win, opened.displayName, opened.path);
  buildMenu(); // refresh document-scoped + Window menu now that a doc is open
  notifyDocumentOpened(opened, win);
  scheduleIndex(opened.documentId);
  return opened;
}

/**
 * Index a document's attachment PDF text in the background — a worker pool (off
 * the main loop) with a persistent cache, deferred so the renderer's initial
 * load (groups/rows) gets an unblocked main process first.
 */
function scheduleIndex(documentId: string): void {
  setTimeout(() => {
    void store.indexAttachments(documentId, pdfExtract).then(() => pdfCache?.flush());
  }, 2000);
}

/** Set a window's title + represented file (macOS proxy icon) for a document. */
function setWindowTitle(win: BrowserWindow, displayName: string, path: string): void {
  if (win.isDestroyed()) return;
  win.setTitle(`${displayName} — BibDesk`);
  win.setRepresentedFilename?.(path);
}

/** Push a `documentOpened` event to a window's renderer (or buffer until ready). */
function notifyDocumentOpened(opened: OpenedDocument, win: BrowserWindow | undefined): void {
  const wc = win && !win.isDestroyed() ? win.webContents : undefined;
  if (!wc) return;
  if (wc.isLoading()) {
    wc.once('did-finish-load', () => wc.send(IpcEvents.documentOpened, opened));
  } else {
    wc.send(IpcEvents.documentOpened, opened);
  }
}

/** Ask the focused library window's renderer to open the Preferences pane. */
function openPreferences(): void {
  focusedWindow()?.webContents.send(IpcEvents.showPreferences, null);
}

/** Open a path now if the app is ready, else stash it for after launch. */
function openPathWhenReady(path: string): void {
  if (!app.isReady()) {
    pendingOpenPath = path;
    return;
  }
  try {
    openPath(path);
  } catch (err) {
    console.error('[open] failed:', err instanceof Error ? err.stack : String(err));
    const win = focusedWindow();
    const opts = {
      type: 'error' as const,
      message: `Could not open ${path}`,
      detail: err instanceof Error ? err.message : String(err),
    };
    if (win) void dialog.showMessageBox(win, opts);
    else void dialog.showMessageBox(opts);
  }
}

/** Re-notify a document's window so it reloads after a main-side mutation. */
function refreshDocument(documentId: string | null): void {
  const win = windowForDoc(documentId);
  if (documentId && win) notifyDocumentOpened(store.summarize(documentId), win);
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
    case 'import': {
      const docId = focusedDocId();
      if (!docId) return;
      if (params.bibtex) {
        store.importBibtexText(docId, params.bibtex);
        refreshDocument(docId);
      } else if (params.doi) {
        void searchOnline('doi', params.doi)
          .then((results) => {
            const r = results[0];
            if (r) {
              store.importEntry(docId, r.entryType, r.fields);
              refreshDocument(docId);
            }
          })
          .catch((e) => console.error('[x-bibdesk] doi import failed:', e));
      }
      return;
    }
    case 'new': {
      const docId = focusedDocId();
      if (!docId) return;
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(params)) if (k.toLowerCase() !== 'type') fields[k] = v;
      store.importEntry(docId, params.type || 'misc', fields);
      refreshDocument(docId);
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
    const bridgeDocId = focusedDocId();
    try {
      result = dispatchBridge(store, bridgeDocId, { method, params });
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if ((result as { mutated?: boolean }).mutated) refreshDocument(bridgeDocId);
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

/** The window a menu-driven dialog should attach to: the literally focused one. */
function dialogParent(): BrowserWindow | undefined {
  const f = BrowserWindow.getFocusedWindow();
  if (f && !f.isDestroyed() && f !== helpWindow) return f;
  return focusedWindow();
}

async function showOpenDialog(): Promise<void> {
  const win = dialogParent();
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

/**
 * Create a new, empty bibliography: prompt for a save location, write an empty
 * `.bib` there, then open it (so it has a real path and Save works normally).
 */
async function newDocument(): Promise<void> {
  const win = dialogParent();
  const result = win
    ? await dialog.showSaveDialog(win, { title: 'New Bibliography', defaultPath: 'Untitled.bib', filters: [{ name: 'BibTeX', extensions: ['bib'] }] })
    : await dialog.showSaveDialog({ title: 'New Bibliography', defaultPath: 'Untitled.bib', filters: [{ name: 'BibTeX', extensions: ['bib'] }] });
  if (result.canceled || !result.filePath) return;
  try {
    writeFileSync(result.filePath, '', 'utf8');
    openPath(result.filePath);
  } catch (err) {
    const opts = {
      type: 'error' as const,
      message: 'Could not create the bibliography',
      detail: err instanceof Error ? err.message : String(err),
    };
    if (win) void dialog.showMessageBox(win, opts);
    else void dialog.showMessageBox(opts);
  }
}

/** Send a menu command to the focused library window (which acts on its own state). */
function sendMenuCommand(command: MenuCommand): void {
  focusedWindow()?.webContents.send(IpcEvents.menuCommand, command);
}

/** Is any library open? Gates document-scoped menu items. */
function hasOpenDocument(): boolean {
  return docWindows.size > 0;
}

/** Document-level Undo: restore the previous snapshot and re-sync that window. */
function doUndo(): void {
  const id = focusedDocId();
  if (id && store.undo(id)) {
    notifyDocumentOpened(store.summarize(id), windowForDoc(id));
    buildMenu(); // refresh Undo/Redo labels + enabled state
  }
}

/** Document-level Redo. */
function doRedo(): void {
  const id = focusedDocId();
  if (id && store.redo(id)) {
    notifyDocumentOpened(store.summarize(id), windowForDoc(id));
    buildMenu();
  }
}

/** Save As: pick a new path, write there, and re-sync the renderer (name + dirty). */
async function saveDocumentAs(): Promise<void> {
  const id = focusedDocId();
  if (!id) return;
  const win = windowForDoc(id);
  const current = store.summarize(id);
  const result = await dialog.showSaveDialog(win!, {
    title: 'Save As',
    defaultPath: current.path,
    filters: [{ name: 'BibTeX', extensions: ['bib'] }],
  });
  if (result.canceled || !result.filePath) return;
  try {
    const saved = store.saveDocument(id, result.filePath);
    app.addRecentDocument(saved.path);
    if (win) setWindowTitle(win, basename(saved.path), saved.path);
    // Re-notify so the renderer picks up the new display name + cleared dirty.
    notifyDocumentOpened(store.summarize(id), win);
  } catch (err) {
    void dialog.showMessageBox(win!, {
      type: 'error',
      message: 'Could not save the document',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Revert to Saved: re-read the document from disk, discarding unsaved edits. */
async function revertToSaved(): Promise<void> {
  const id = focusedDocId();
  if (!id) return;
  const win = windowForDoc(id);
  const { path } = store.summarize(id);
  const choice = await dialog.showMessageBox(win!, {
    type: 'warning',
    buttons: ['Revert', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Revert to the last saved version?',
    detail: 'Any unsaved changes will be lost.',
  });
  if (choice.response !== 0 || !win) return;
  loadDocumentInto(win, path); // re-read from disk into the same window
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
  const id = focusedDocId();
  if (!id) return;
  const current = store.summarize(id);
  const ext = EXPORT_EXT[format];
  const base = current.displayName.replace(/\.bib$/i, '');
  const result = await dialog.showSaveDialog(focusedWindow()!, {
    title: 'Export',
    defaultPath: `${base}.${ext}`,
    filters: [{ name: format.toUpperCase(), extensions: [ext] }],
  });
  if (result.canceled || !result.filePath) return;
  try {
    // RTF is a CSL-formatted bibliography (built here); the rest serialize in the store.
    const text =
      format === 'rtf'
        ? buildLibraryRtf(id, getSettings().defaultCiteStyle)
        : store.exportText(id, format);
    writeFileSync(result.filePath, text, 'utf8');
  } catch (err) {
    void dialog.showMessageBox(focusedWindow()!, {
      type: 'error',
      message: 'Could not export the document',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Export just the given entries (the current selection) to a `.bib` file. Unlike
 * {@link exportDocumentAs} (whole library), the renderer supplies the item ids;
 * a cancelled save dialog counts as ok.
 */
async function exportSelectionAs(req: ExportSelectionRequest): Promise<ExportSelectionResponse> {
  if (!req.itemIds.length) return { ok: false, error: 'No entries are selected.' };
  if (!store.has(req.documentId)) return { ok: false, error: 'No document open.' };
  const base = store.summarize(req.documentId).displayName.replace(/\.bib$/i, '');
  const result = await dialog.showSaveDialog((windowForDoc(req.documentId) ?? focusedWindow())!, {
    title: 'Export Selected Entries',
    defaultPath: `${base}-selection.bib`,
    filters: [{ name: 'BibTeX', extensions: ['bib'] }],
  });
  if (result.canceled || !result.filePath) return { ok: true };
  try {
    writeFileSync(result.filePath, store.exportText(req.documentId, 'bibtex', req.itemIds), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Ask the focused window to export `templateName` at `scope`. The renderer owns
 * the selection and the filtered/sorted view, so it resolves the scope to ordered
 * itemIds and invokes the `exportTemplate` IPC (which shows the save dialog).
 */
function requestExportTemplate(templateName: string, scope: TemplateExportScope): void {
  focusedWindow()?.webContents.send(IpcEvents.menuExportTemplate, { templateName, scope });
}

/**
 * File → Export entries for the user's custom templates (empty when none defined).
 * Each template is a submenu with the three export scopes.
 */
function templateMenuItems(): MenuItemConstructorOptions[] {
  const tmpls = getSettings().exportTemplates;
  if (tmpls.length === 0) return [];
  const enabled = hasOpenDocument();
  return [
    { type: 'separator' },
    ...tmpls.map((t): MenuItemConstructorOptions => ({
      label: t.name,
      submenu: [
        { label: 'Whole Library…', enabled, click: () => requestExportTemplate(t.name, 'library') },
        { label: 'Shown Entries…', enabled, click: () => requestExportTemplate(t.name, 'shown') },
        { label: 'Selected Entries…', enabled, click: () => requestExportTemplate(t.name, 'selected') },
      ],
    })),
  ];
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
    click: () => focusedWindow()?.webContents.send(IpcEvents.menuToggleColumn, c.key),
  }));
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const docEnabled = hasOpenDocument();
  const fid = focusedDocId();
  const undo = fid ? store.undoState(fid) : { canUndo: false, canRedo: false };
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
          const id = focusedDocId();
          if (id) shell.showItemInFolder(store.summarize(id).path);
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
          { type: 'separator' },
          { label: 'Selected Entries (BibTeX)…', enabled: docEnabled, click: () => sendMenuCommand('exportSelected') },
          ...templateMenuItems(),
        ],
      },
      {
        label: 'Select Publications from .aux File…',
        enabled: docEnabled,
        click: () => sendMenuCommand('selectFromAux'),
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
      {
        label: undo.undoLabel ? `Undo ${undo.undoLabel}` : 'Undo',
        accelerator: 'CmdOrCtrl+Z',
        enabled: undo.canUndo,
        click: () => doUndo(),
      },
      {
        label: undo.redoLabel ? `Redo ${undo.redoLabel}` : 'Redo',
        accelerator: 'Shift+CmdOrCtrl+Z',
        enabled: undo.canRedo,
        click: () => doRedo(),
      },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
      {
        label: 'Select Incomplete Publications',
        enabled: docEnabled,
        click: () => sendMenuCommand('selectIncomplete'),
      },
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
      {
        label: 'Copy As',
        submenu: [
          { label: 'RIS', enabled: docEnabled, click: () => sendMenuCommand('copyRis') },
          { label: 'Minimal BibTeX', enabled: docEnabled, click: () => sendMenuCommand('copyMinimalBibtex') },
          { label: 'LaTeX \\bibitem', enabled: docEnabled, click: () => sendMenuCommand('copyBibitem') },
        ],
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
        label: 'New Publication with Crossref',
        enabled: docEnabled,
        click: () => sendMenuCommand('newWithCrossref'),
      },
      {
        label: 'Edit Publication…',
        accelerator: 'CmdOrCtrl+E',
        enabled: docEnabled,
        click: () => sendMenuCommand('editEntry'),
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
        label: 'Select Crossref Parent',
        enabled: docEnabled,
        click: () => sendMenuCommand('selectParent'),
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
        label: 'Consolidate Linked Files…',
        enabled: docEnabled,
        click: () => sendMenuCommand('consolidate'),
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

  // List every open library so the user can switch between windows.
  const focusedId = focusedDocId();
  const openLibraries: MenuItemConstructorOptions[] = [...docWindows.entries()]
    .filter(([, w]) => !w.isDestroyed())
    .map(([id, w]) => ({ id, w, name: store.summarize(id).displayName }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ id, w, name }) => ({
      label: name,
      type: 'checkbox' as const,
      checked: id === focusedId,
      click: () => {
        if (w.isMinimized()) w.restore();
        w.focus();
      },
    }));

  template.push({
    role: 'window',
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? [{ type: 'separator' as const }, { role: 'front' as const }]
        : [{ role: 'close' as const }]),
      ...(openLibraries.length ? [{ type: 'separator' as const }, ...openLibraries] : []),
    ],
  });

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
  const result = await dialog.showMessageBox(focusedWindow()!, {
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
      const win = windowForDoc(req.documentId);
      if (win) setWindowTitle(win, basename(res.path), res.path);
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
      const parent = dialogParent();
      const result = parent
        ? await dialog.showOpenDialog(parent, opts)
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
      const parent = dialogParent();
      const result = parent
        ? await dialog.showOpenDialog(parent, { title: 'Locate File', properties: ['openFile'] })
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
    [IpcChannels.ftsSearch]: (req) => store.ftsSearch(req.documentId, req.query, req.includePdf),
    [IpcChannels.getSettings]: () => getSettings(),
    [IpcChannels.updateSettings]: (req) => {
      const s = updateSettings(req.patch);
      store.setEditConfig({
        citeKeyFormat: s.citeKeyFormat,
        defaultEntryType: s.defaultEntryType,
        papersFolder: s.papersFolder,
        autoFileFormat: s.autoFileFormat,
        annotationStorage: s.annotationStorage,
      });
      // refresh View→Columns checkmarks and the File→Export template list
      if (req.patch.columns || req.patch.exportTemplates) buildMenu();
      return s;
    },
    [IpcChannels.listEntryTypes]: () => {
      // Bundled types (with any custom overrides the manager applied), then any
      // brand-new custom types not present in the bundled set.
      const custom = getSettings().customTypes;
      const seen = new Set<string>();
      const types: EntryTypeInfo[] = [];
      for (const name of sharedTypeManager.bundledTypes()) {
        seen.add(name.toLowerCase());
        types.push({
          name,
          standard: sharedTypeManager.isStandardType(name),
          required: sharedTypeManager.requiredFieldsForType(name),
          optional: sharedTypeManager.optionalFieldsForType(name),
        });
      }
      for (const [name, t] of Object.entries(custom)) {
        if (seen.has(name.toLowerCase())) continue;
        types.push({ name, standard: false, required: [...t.required], optional: [...t.optional] });
      }
      return { types };
    },
    [IpcChannels.selectFromAux]: async (req) => {
      const parent = dialogParent();
      const opts: Electron.OpenDialogOptions = {
        title: 'Select Publications from .aux File',
        properties: ['openFile'],
        filters: [
          { name: 'LaTeX aux', extensions: ['aux'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      };
      const result = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
      const file = result.canceled ? undefined : result.filePaths[0];
      if (!file) return { canceled: true, matchedIds: [], matchedKeys: [], missingKeys: [] };
      const sel = store.selectFromAux(req.documentId, readFileSync(file, 'utf8'));
      const summary: Electron.MessageBoxOptions = {
        type: 'info',
        buttons: ['OK'],
        message: sel.matchedIds.length
          ? `Selected ${sel.matchedIds.length} publication${sel.matchedIds.length === 1 ? '' : 's'} cited in ${basename(file)}.`
          : `No entries cited in ${basename(file)} matched this library.`,
        ...(sel.missingKeys.length
          ? {
              detail: `${sel.missingKeys.length} cited key${sel.missingKeys.length === 1 ? '' : 's'} not in this library:\n${sel.missingKeys.slice(0, 15).join(', ')}${sel.missingKeys.length > 15 ? ', …' : ''}`,
            }
          : {}),
      };
      if (parent) void dialog.showMessageBox(parent, summary);
      else void dialog.showMessageBox(summary);
      return { canceled: false, ...sel };
    },
    [IpcChannels.exportFolderTree]: async (req) => {
      const parent = dialogParent();
      const opts: Electron.OpenDialogOptions = {
        title: 'Export Folder to PDF Tree',
        properties: ['openDirectory', 'createDirectory'],
      };
      const result = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
      const dest = result.canceled ? undefined : result.filePaths[0];
      if (!dest) return { canceled: true, copied: 0, errors: [] };
      const plan = store.folderExportPlan(req.documentId, req.folderId);
      let copied = 0;
      const errors: string[] = [];
      for (const entry of plan) {
        const dir = join(dest, entry.dir);
        try {
          mkdirSync(dir, { recursive: true });
        } catch (e) {
          errors.push(`${entry.dir}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        const used = new Set<string>();
        for (const src of entry.files) {
          let name = basename(src);
          if (used.has(name.toLowerCase())) {
            // de-collide identical filenames within one group directory
            const dot = name.lastIndexOf('.');
            const stem = dot > 0 ? name.slice(0, dot) : name;
            const ext = dot > 0 ? name.slice(dot) : '';
            let n = 2;
            while (used.has(`${stem}-${n}${ext}`.toLowerCase())) n++;
            name = `${stem}-${n}${ext}`;
          }
          used.add(name.toLowerCase());
          try {
            copyFileSync(src, join(dir, name));
            copied++;
          } catch (e) {
            errors.push(`${basename(src)}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
      const summary: Electron.MessageBoxOptions = {
        type: errors.length ? 'warning' : 'info',
        buttons: ['OK'],
        message: `Exported ${copied} file${copied === 1 ? '' : 's'} to ${basename(dest)}.`,
        ...(errors.length
          ? {
              detail: `${errors.length} problem${errors.length === 1 ? '' : 's'}:\n${errors.slice(0, 12).join('\n')}${errors.length > 12 ? '\n…' : ''}`,
            }
          : {}),
      };
      if (parent) void dialog.showMessageBox(parent, summary);
      else void dialog.showMessageBox(summary);
      return { canceled: false, copied, errors };
    },
    [IpcChannels.selectIncomplete]: (req) => {
      const itemIds = store.incompleteItemIds(req.documentId);
      if (itemIds.length === 0) {
        const w = dialogParent();
        const opts: Electron.MessageBoxOptions = {
          type: 'info',
          buttons: ['OK'],
          message: 'No incomplete publications.',
          detail: 'Every entry has the required fields for its type.',
        };
        if (w) void dialog.showMessageBox(w, opts);
        else void dialog.showMessageBox(opts);
      }
      return { itemIds };
    },
    [IpcChannels.previewTemplate]: (req) => {
      try {
        return { text: store.renderExportTemplate(req.documentId, req.body, { limit: 8 }) };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
    [IpcChannels.exportTemplate]: async (req) => {
      const tmpl = getSettings().exportTemplates.find((t) => t.name === req.templateName);
      if (!tmpl) return { error: `No export template named “${req.templateName}”.` };
      const ext = (tmpl.extension || 'txt').replace(/^\./, '');
      const base = store.summarize(req.documentId).displayName.replace(/\.bib$/i, '');
      const win = windowForDoc(req.documentId) ?? focusedWindow();
      const opts: Electron.SaveDialogOptions = {
        title: `Export — ${tmpl.name}`,
        defaultPath: `${base}.${ext}`,
        filters: [{ name: tmpl.name, extensions: [ext] }],
      };
      const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (result.canceled || !result.filePath) return { canceled: true };
      try {
        const scope = req.itemIds && req.itemIds.length ? { itemIds: req.itemIds } : {};
        writeFileSync(result.filePath, store.renderExportTemplate(req.documentId, tmpl.body, scope), 'utf8');
        return { ok: true };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
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
    [IpcChannels.exportSelection]: (req) => exportSelectionAs(req),
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
      const parent = dialogParent();
      const result = parent
        ? await dialog.showOpenDialog(parent, opts)
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
    [IpcChannels.openEditor]: (req) => {
      createEditorWindow(req.documentId, req.itemId);
      return { ok: true };
    },
    [IpcChannels.openDialog]: () => {
      void showOpenDialog();
      return { ok: true };
    },
    [IpcChannels.newDocument]: () => {
      void newDocument();
      return { ok: true };
    },
    [IpcChannels.fieldSuggestions]: (req) => store.fieldSuggestions(req.documentId, req.field),
    [IpcChannels.autoFile]: (req) => {
      const res = store.autoFile(req.documentId, req.itemId);
      return { ...res, dirty: store.isDirty(req.documentId) };
    },
    [IpcChannels.consolidateLinkedFiles]: async (req) => {
      const scope =
        req.itemIds && req.itemIds.length > 0
          ? `the ${req.itemIds.length} selected ${req.itemIds.length === 1 ? 'entry' : 'entries'}`
          : 'every entry in the library';
      const confirmOpts: Electron.MessageBoxOptions = {
        type: 'warning',
        buttons: ['Consolidate', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        message: 'Consolidate linked files?',
        detail: `This moves the managed file attachments for ${scope} into your Papers folder, renaming them by the AutoFile format. Files are moved on disk.`,
      };
      const parent = dialogParent();
      const choice = parent
        ? await dialog.showMessageBox(parent, confirmOpts)
        : await dialog.showMessageBox(confirmOpts);
      if (choice.response !== 0) {
        return { scanned: 0, itemsAffected: 0, moved: 0, dirty: store.isDirty(req.documentId), errors: [] };
      }
      const res = store.consolidateLinkedFiles(req.documentId, req.itemIds);
      const summaryOpts: Electron.MessageBoxOptions = {
        type: res.errors.length ? 'warning' : 'info',
        buttons: ['OK'],
        message:
          res.moved > 0
            ? `Filed ${res.moved} ${res.moved === 1 ? 'file' : 'files'} across ${res.itemsAffected} ${res.itemsAffected === 1 ? 'entry' : 'entries'}.`
            : 'No linked files needed filing.',
        ...(res.errors.length
          ? {
              detail: `${res.errors.length} ${res.errors.length === 1 ? 'problem' : 'problems'}:\n${res.errors.slice(0, 12).join('\n')}${res.errors.length > 12 ? '\n…' : ''}`,
            }
          : {}),
      };
      if (parent) void dialog.showMessageBox(parent, summaryOpts);
      else void dialog.showMessageBox(summaryOpts);
      return res;
    },
    [IpcChannels.chooseFolder]: async () => {
      const opts: Electron.OpenDialogOptions = {
        title: 'Choose Papers Folder',
        properties: ['openDirectory', 'createDirectory'],
      };
      const parent = dialogParent();
      const result = parent
        ? await dialog.showOpenDialog(parent, opts)
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
  // Register a content-mutating channel so that, after it runs, every OTHER window
  // is told the document changed (cross-window refresh for the separate editor).
  const mutating = (channel: (typeof IpcChannels)[keyof typeof IpcChannels]): void => {
    ipcMain.handle(channel, async (e: IpcMainInvokeEvent, req: { documentId?: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (handlers as any)[channel](req);
      if (typeof req?.documentId === 'string') broadcastDocumentChanged(req.documentId, e.sender);
      buildMenu(); // refresh Undo/Redo labels after a mutating action
      return result;
    });
  };

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
  mutating(IpcChannels.applyEdit);
  mutating(IpcChannels.batchEdit);
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
  mutating(IpcChannels.addAttachment);
  mutating(IpcChannels.removeAttachment);
  ipcMain.handle(IpcChannels.searchOnline, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.searchOnline](req),
  );
  mutating(IpcChannels.importOnline);
  ipcMain.handle(IpcChannels.ftsSearch, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.ftsSearch](req),
  );
  ipcMain.handle(IpcChannels.getSettings, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.getSettings](req),
  );
  ipcMain.handle(IpcChannels.updateSettings, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.updateSettings](req),
  );
  ipcMain.handle(IpcChannels.listEntryTypes, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.listEntryTypes](req),
  );
  ipcMain.handle(IpcChannels.selectFromAux, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.selectFromAux](req),
  );
  ipcMain.handle(IpcChannels.exportFolderTree, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.exportFolderTree](req),
  );
  ipcMain.handle(IpcChannels.selectIncomplete, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.selectIncomplete](req),
  );
  ipcMain.handle(IpcChannels.previewTemplate, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.previewTemplate](req),
  );
  ipcMain.handle(IpcChannels.exportTemplate, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.exportTemplate](req),
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
  ipcMain.handle(IpcChannels.exportSelection, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.exportSelection](req),
  );
  mutating(IpcChannels.pasteEntries);
  mutating(IpcChannels.importFiles);
  mutating(IpcChannels.importDialog);
  mutating(IpcChannels.findReplace);
  ipcMain.handle(IpcChannels.findDuplicates, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.findDuplicates](req),
  );
  ipcMain.handle(IpcChannels.findBrokenLinks, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.findBrokenLinks](req),
  );
  mutating(IpcChannels.relocateAttachment);
  mutating(IpcChannels.groupEdit);
  ipcMain.handle(IpcChannels.groupConditions, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.groupConditions](req),
  );
  mutating(IpcChannels.renameAuthor);
  ipcMain.handle(IpcChannels.openEditor, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.openEditor](req),
  );
  ipcMain.handle(IpcChannels.openDialog, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.openDialog](req),
  );
  ipcMain.handle(IpcChannels.newDocument, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.newDocument](req),
  );
  ipcMain.handle(IpcChannels.fieldSuggestions, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.fieldSuggestions](req),
  );
  mutating(IpcChannels.autoFile);
  mutating(IpcChannels.consolidateLinkedFiles);
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
  mutating(IpcChannels.agentRun);
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

// Re-show a welcome window on dock-activate when nothing is open (macOS).
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Persist the PDF text cache and tear down the worker pool on quit.
app.on('will-quit', () => {
  pdfCache?.flush();
  void pdfPool?.destroy();
});

// ---------------------------------------------------------------------------
// Single-instance lock: route a second-instance launch's path into this one.
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const win = focusedWindow() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
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
      annotationStorage: settings.annotationStorage,
    });
    registerIpc();
    buildMenu();
    startBridge();
    const first = createWindow();

    // Auto-open from BIBDESK_OPEN / CLI, or honor a path buffered by open-file —
    // into the initial (welcome) window so no empty window is left behind.
    const startup = pendingOpenPath ?? startupOpenPath();
    pendingOpenPath = null;
    if (startup) {
      try {
        openPath(startup, first);
      } catch (err) {
        console.error('[open] startup failed:', err instanceof Error ? err.stack : String(err));
        void dialog.showMessageBox(first, {
          type: 'error',
          message: `Could not open ${startup}`,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // A protocol URL passed on the initial command line (Windows/Linux cold start).
    const urlArg = process.argv.find((a) => a.startsWith('x-bibdesk://'));
    if (urlArg) handleAppUrl(urlArg);

    if (process.env.BIBDESK_OPEN_HELP) setTimeout(openHelp, 600);
    if (process.env.BIBDESK_OPEN_PREFS) setTimeout(openPreferences, 1400);
  });
}
