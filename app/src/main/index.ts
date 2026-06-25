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
  type JournalCoverProposal,
  type ImportResult,
  type PdfReviewBatch,
} from '@bibdesk/shared';
import { sharedTypeManager, LABEL_COLORS } from '@bibdesk/model';

import { DocumentStore } from './document-service.js';
import { resolveActivePanelBody, renderMultiPanels, MULTI_LIST_CAP } from './panel.js';
import { runAgentTurn } from './agent.js';
import { runScript, type ScriptCapabilities } from './script-host.js';
import { syncFetch } from './sync-fetch.js';
import {
  ensureScriptsDir,
  listScriptFiles,
  newScriptFile,
  isScriptTrusted,
  recordScriptTrust,
} from './script-files.js';
import { parseAppUrl } from './app-url.js';
import { dispatchBridge } from './bridge.js';
import { initScripting } from './scripting-bridge.js';
import { htmlToRtf, wrapRtf } from './rtf.js';
import { buildPrintHtml } from './print.js';
import {
  loadCoverIndex,
  resolveCover,
  coverPathOf,
  saveUserCover,
  userCoversDir,
  invalidateCoverIndex,
} from './journal-covers.js';
import { fetchWikipediaCover } from './journal-wikipedia.js';
import {
  formatCitation,
  loadUserStyles,
  listStyles,
  installCslFile,
  removeCslStyle,
} from './csl.js';
import { renderCite, renderBibliography } from './csl-format.js';
import { findTexBin, renderTexPreview, renderTexPreviewSvg, SVG_MAX_KEYS } from './tex-preview.js';
import { searchOnline, extractDoi, extractArxivId, searchArxivById } from './online.js';
import { importPdfsSmart } from './import-smart.js';
import { extractPdfText } from './pdf-text.js';
import { PdfPool } from './pdf-pool.js';
import { PdfTextCache } from './pdf-cache.js';
import { buildHelpHtml, findHelpDir } from './help.js';
import { getSettings, loadSettings, updateSettings } from './settings.js';
import { t, setMainLocale } from './i18n.js';
import { encodingLabel, SUPPORTED_ENCODINGS } from './bib-encoding.js';

// A stable product name so userData (settings, agent key, automation
// `bridge.json`) lives at a predictable `…/Application Support/Bibliofile/` path
// the native helpers can find — instead of the `@bibdesk/app` package name.
app.setName('Bibliofile');

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
  for (const w of annotationWindows.values()) if (w === f) return undefined; // an annotation editor
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
 * True while an app-quit is in progress (⌘Q / menu Quit). A dirty window's
 * `close` handler must `preventDefault()` to show its save prompt synchronously,
 * which ALSO aborts the quit; once the window actually closes we re-issue
 * `app.quit()` to resume it. Without this the app lingers windowless after you
 * pick "Save" from the quit prompt (looks like a hang in dev).
 */
let isQuitting = false;

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
      buttons: [t('common.save'), t('dialog.dontSave'), t('common.cancel')],
      defaultId: 0,
      cancelId: 2,
      message: t('dialog.saveBeforeClose', { name: displayName }),
      detail: t('dialog.changesLost'),
    });
    if (choice === 2) {
      // Cancel → keep the window open AND abort any quit this close was part of.
      isQuitting = false;
      return;
    }
    if (choice === 0) {
      try {
        store.saveDocument(id, path);
      } catch (err) {
        isQuitting = false; // failed save aborts the quit too
        void dialog.showMessageBox(win, {
          type: 'error',
          message: t('dialog.couldNotSave'),
          detail: err instanceof Error ? err.message : String(err),
        });
        return; // save failed → keep the window open
      }
    }
    closeConfirmed.add(win);
    win.close();
    // `preventDefault()` above cancelled the in-progress ⌘Q/menu-Quit; now that
    // the window is actually closing, resume it (macOS won't quit on
    // window-all-closed). Deferred so this close event finishes unwinding first.
    if (isQuitting) setImmediate(() => app.quit());
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
    void dialog.showMessageBox({ type: 'info', message: t('dialog.helpUnavailable') });
    return;
  }
  const tmp = join(tmpdir(), 'bibdesk-help.html');
  writeFileSync(tmp, buildHelpHtml(dir));
  helpWindow = new BrowserWindow({
    width: 940,
    height: 820,
    title: t('window.help'),
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
    title: 'Bibliofile',
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
        // optionally open the Preferences pane (its own IPC event, not a menuCommand)
        if (process.env.BIBDESK_SMOKE_PREFS) {
          setTimeout(() => win.webContents.send(IpcEvents.showPreferences, null), 900);
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
    title: t('editor.docTitleEmpty'),
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

/** Open windows for the standalone annotation editor, keyed by `<doc>::<item>`. */
const annotationWindows = new Map<string, BrowserWindow>();

/**
 * Open (or focus) the standalone annotation editor for one item: a top-level,
 * non-blocking window with the entry's pretty-printed preview card above a
 * markdown editor that debounce-saves the annotation back to the shared document
 * (the main window refreshes via the documentChanged broadcast). Loads the same
 * renderer with an `#annotation=<doc>::<item>` hash.
 */
function createAnnotationWindow(documentId: string, itemId: string): void {
  const key = `${documentId}::${itemId}`;
  const existing = annotationWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 640,
    height: 780,
    minWidth: 460,
    minHeight: 420,
    show: false,
    title: t('annotation.windowTitleEmpty'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  const hash = `annotation=${encodeURIComponent(documentId)}::${encodeURIComponent(itemId)}`;
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(`${devUrl}#${hash}`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash });
  }
  annotationWindows.set(key, win);
  win.on('closed', () => annotationWindows.delete(key));
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
/** Pages of each PDF to extract for the full-text index (0 = all). Mirrors the
 * `ftsPageLimit` setting; updated on startup + when settings change. */
let ftsPageLimit = 40;

function ensurePdf(): { pool: PdfPool; cache: PdfTextCache } {
  if (!pdfPool) pdfPool = new PdfPool(join(__dirname, 'pdf-worker.js'));
  if (!pdfCache) pdfCache = new PdfTextCache(join(app.getPath('userData'), 'pdf-text-cache.json'));
  return { pool: pdfPool, cache: pdfCache };
}

/** Extract one PDF's text: cache hit, else a worker-thread extraction (then cached). */
async function pdfExtract(absPath: string): Promise<string> {
  const { pool, cache } = ensurePdf();
  const cached = cache.get(absPath, ftsPageLimit);
  if (cached !== undefined) return cached;
  const text = await pool.extract(absPath, ftsPageLimit);
  cache.set(absPath, text, ftsPageLimit);
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
  win.setTitle(`${displayName} — Bibliofile`);
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

/**
 * Host-mediated I/O for scripts: synchronous file read/write/exists (raw paths —
 * the AppleScript trust level), and a synchronous `fetch` gated behind a one-time
 * per-run network confirmation (a script can read the whole library, so network
 * access could exfiltrate it). `win` anchors the confirmation dialog.
 */
function makeScriptCapabilities(win: BrowserWindow | undefined): ScriptCapabilities {
  let networkAllowed: boolean | null = null; // unasked → asked once per run
  return {
    readText: (p) => readFileSync(p, 'utf8'),
    writeText: (p, text) => writeFileSync(p, text),
    exists: (p) => existsSync(p),
    fetch: (url, opts) => {
      if (networkAllowed === null) {
        networkAllowed = win
          ? dialog.showMessageBoxSync(win, {
              type: 'warning',
              buttons: [t('script.allow'), t('common.cancel')],
              defaultId: 0,
              cancelId: 1,
              message: t('script.networkTitle'),
              detail: t('script.networkDetail', { url: String(url) }),
            }) === 0
          : true;
      }
      if (!networkAllowed) throw new Error('Network access was denied.');
      return syncFetch(String(url), opts ?? {}, 8000);
    },
  };
}

/**
 * Run a saved script (Scripts menu) against the focused document. Prompts once
 * per file (and again if it was edited) since folder scripts may not have been
 * authored/re-read by the user, then runs it via the host and reports the result
 * in a dialog (folder scripts are fire-and-forget; the Console is for interactive
 * runs). Refreshes open windows when the run changed the document.
 */
function runSavedScript(path: string): void {
  const documentId = focusedDocId();
  if (!documentId) return;
  const win = focusedWindow();
  let code: string;
  try {
    code = readFileSync(path, 'utf8');
  } catch (e) {
    if (win) dialog.showMessageBoxSync(win, { type: 'error', message: t('script.readFailed', { name: basename(path) }), detail: e instanceof Error ? e.message : String(e) });
    return;
  }
  const userData = app.getPath('userData');
  if (!isScriptTrusted(userData, path, code)) {
    const choice = win
      ? dialog.showMessageBoxSync(win, {
          type: 'warning',
          buttons: [t('script.runButton'), t('common.cancel')],
          defaultId: 0,
          cancelId: 1,
          message: t('script.trustTitle', { name: basename(path) }),
          detail: t('script.trustDetail'),
        })
      : 0;
    if (choice !== 0) return;
    recordScriptTrust(userData, path, code);
  }
  const r = runScript(store, documentId, code, {
    timeoutMs: 10000,
    version: app.getVersion(),
    filename: basename(path),
    capabilities: makeScriptCapabilities(win),
  });
  if (r.mutated) {
    broadcastDocumentChanged(documentId);
    buildMenu();
  }
  if (!win) return;
  if (r.error) {
    const detail = (r.error.line != null ? `Line ${r.error.line}: ` : '') + r.error.message;
    dialog.showMessageBoxSync(win, { type: 'error', message: t('script.failed', { name: basename(path) }), detail });
  } else {
    const lines = [...r.output];
    if (r.result !== undefined) lines.push('⇒ ' + (typeof r.result === 'string' ? r.result : JSON.stringify(r.result)));
    dialog.showMessageBoxSync(win, {
      type: 'info',
      message: t('script.ran', { name: basename(path) }),
      detail: lines.join('\n').slice(0, 4000) || t('scripting.ranNoOutput'),
    });
  }
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
      message: t('dialog.couldNotOpen', { path }),
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
 * Import dropped files, upgrading PDFs into real entries. For each PDF we read
 * its first pages, look for a DOI (then an arXiv id), and:
 *   - if the library already has that paper, attach the PDF to the existing entry
 *     (deduped by basename) rather than creating a duplicate — `linked`;
 *   - else look the identifier up (CrossRef for DOI, arXiv API for an arXiv id),
 *     import the real metadata, and attach the PDF — `created`;
 *   - else (no identifier / lookup miss) stage it as an editable draft for the
 *     review dialog — `review` — instead of littering the library with an empty stub.
 * Non-PDFs go through the store's plain import. The `summary` counts feed the
 * renderer's result notice; `review` carries the staged drafts.
 */
async function importFilesSmart(
  documentId: string,
  paths: readonly string[],
): Promise<ImportResult> {
  const isPdf = (p: string): boolean => /\.pdf$/i.test(p);
  // PDFs go through the testable DOI/arXiv → entry pipeline (deps injected here).
  const r = await importPdfsSmart(paths.filter(isPdf), {
    extractText: extractPdfText,
    extractDoi,
    extractArxivId,
    findExisting: (ids) => store.findItemByIdentifier(documentId, ids),
    attachmentNames: (id) => store.itemAttachmentNames(documentId, id),
    addAttachment: (id, pdf) => {
      store.addAttachments(documentId, id, [pdf]);
    },
    lookupDoi: (doi) => searchOnline('doi', doi),
    lookupArxiv: (id) => searchArxivById(id),
    importEntry: (type, fields) => store.importEntry(documentId, type, fields).affectedItemId ?? null,
  });
  const addedIds = [...r.addedIds];
  const warnings: string[] = [];

  // Non-PDFs (e.g. a dropped .bib to merge) take the store's plain import path.
  const others = paths.filter((p) => !isPdf(p));
  if (others.length) {
    const o = store.importFiles(documentId, others);
    addedIds.push(...o.addedIds);
    warnings.push(...o.warnings);
  }

  // No-identifier PDFs are NOT auto-created (that would litter a large library with
  // empty entries). Stage each as an editable draft in an off-library scratch doc;
  // the renderer opens the review dialog. Nothing touches the real library until
  // the user Accepts a draft (see the commitStagedEntry handler).
  let review: PdfReviewBatch | undefined;
  if (r.review.length) {
    const stagingDocId = store.openText('', '').documentId;
    const items = r.review
      .map((pdf) => {
        const title = basename(pdf).replace(/\.[^.]+$/, '');
        const res = store.importEntry(
          stagingDocId,
          getSettings().defaultEntryType || 'misc',
          title ? { Title: title } : {},
        );
        return res.affectedItemId ? { itemId: res.affectedItemId, pdf, name: basename(pdf) } : null;
      })
      .filter((x): x is { itemId: string; pdf: string; name: string } => x !== null);
    if (items.length) review = { stagingDocId, items };
    else store.closeDocument({ documentId: stagingDocId });
  }

  return {
    dirty: store.isDirty(documentId),
    addedIds,
    warnings,
    summary: r.summary,
    ...(review ? { review } : {}),
  };
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
      message: t('dialog.couldNotOpen', { path }),
      detail: err instanceof Error ? err.message : String(err),
    };
    if (win) void dialog.showMessageBox(win, opts);
    else void dialog.showMessageBox(opts);
  }
}

function openDialogOptions(): Electron.OpenDialogOptions {
  return {
    title: t('dialog.openTitle'),
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
    ? await dialog.showSaveDialog(win, { title: t('dialog.newBibTitle'), defaultPath: 'Untitled.bib', filters: [{ name: 'BibTeX', extensions: ['bib'] }] })
    : await dialog.showSaveDialog({ title: t('dialog.newBibTitle'), defaultPath: 'Untitled.bib', filters: [{ name: 'BibTeX', extensions: ['bib'] }] });
  if (result.canceled || !result.filePath) return;
  try {
    writeFileSync(result.filePath, '', 'utf8');
    openPath(result.filePath);
  } catch (err) {
    const opts = {
      type: 'error' as const,
      message: t('dialog.couldNotCreate'),
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

/**
 * Save `documentId`, but if writing in its (legacy) encoding would drop characters
 * the encoding can't hold (e.g. € in Latin-1, CJK/emoji in any 8-bit), prompt first:
 * Convert to UTF-8, save anyway (lossy), or cancel. Returns `cancelled` on cancel.
 */
async function saveWithEncodingGuard(
  documentId: string,
  targetPath: string | undefined,
  win: BrowserWindow | undefined,
): Promise<{ documentId: string; path: string; cancelled?: boolean }> {
  const preview = store.saveEncodingPreview(documentId);
  let opts: { encoding?: string } | undefined;
  if (preview.lossy) {
    const box: Electron.MessageBoxOptions = {
      type: 'warning',
      message: t('save.lossyTitle', { encoding: encodingLabel(preview.encoding) }),
      detail: t('save.lossyDetail', {
        encoding: encodingLabel(preview.encoding),
        chars: preview.lostChars.join('  '),
      }),
      buttons: [t('save.convertUtf8'), t('save.saveAnyway'), t('common.cancel')],
      defaultId: 0,
      cancelId: 2,
    };
    const { response } = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box);
    if (response === 2) return { documentId, path: store.summarize(documentId).path, cancelled: true };
    if (response === 0) opts = { encoding: 'utf8' };
  }
  const res = store.saveDocument(documentId, targetPath, opts);
  if (win) setWindowTitle(win, basename(res.path), res.path);
  if (opts?.encoding) buildMenu(); // encoding changed → refresh the Text Encoding marks
  return res;
}

/** File → Text Encoding submenu: pick an encoding to re-read with, or Convert to UTF-8. */
function textEncodingMenuItems(): MenuItemConstructorOptions[] {
  const id = focusedDocId();
  const current = id ? store.documentEncoding(id) : undefined;
  const items: MenuItemConstructorOptions[] = SUPPORTED_ENCODINGS.map((e) => ({
    label: e.label,
    type: 'radio' as const,
    checked: e.id === current,
    enabled: !!id,
    click: () => void reinterpretEncoding(e.id),
  }));
  items.push({ type: 'separator' });
  items.push({
    label: t('menu.file.convertUtf8'),
    enabled: !!id && current !== 'utf8',
    click: () => convertEncodingToUtf8(),
  });
  return items;
}

/** Re-read the focused document's file decoding it with `encoding` (fix a mis-detect). */
async function reinterpretEncoding(encoding: string): Promise<void> {
  const id = focusedDocId();
  if (!id || store.documentEncoding(id) === encoding) return;
  const win = windowForDoc(id);
  if (store.isDirty(id)) {
    const box: Electron.MessageBoxOptions = {
      type: 'warning',
      message: t('encoding.rereadTitle'),
      detail: t('encoding.rereadDetail', { encoding: encodingLabel(encoding) }),
      buttons: [t('encoding.reread'), t('common.cancel')],
      defaultId: 1,
      cancelId: 1,
    };
    const { response } = win ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box);
    if (response === 1) return;
  }
  store.setDocumentEncoding(id, encoding, false); // re-reads from disk
  notifyDocumentOpened(store.summarize(id), win);
  buildMenu();
}

/** Keep the in-memory data; write the focused document as UTF-8 from now on. */
function convertEncodingToUtf8(): void {
  const id = focusedDocId();
  if (!id || store.documentEncoding(id) === 'utf8') return;
  store.setDocumentEncoding(id, 'utf8', true); // convert-only → marks dirty
  notifyDocumentOpened(store.summarize(id), windowForDoc(id));
  buildMenu();
}

/** Save As: pick a new path, write there, and re-sync the renderer (name + dirty). */
async function saveDocumentAs(): Promise<void> {
  const id = focusedDocId();
  if (!id) return;
  const win = windowForDoc(id);
  const current = store.summarize(id);
  const result = await dialog.showSaveDialog(win!, {
    title: t('dialog.saveAsTitle'),
    defaultPath: current.path,
    filters: [{ name: 'BibTeX', extensions: ['bib'] }],
  });
  if (result.canceled || !result.filePath) return;
  try {
    const saved = await saveWithEncodingGuard(id, result.filePath, win);
    if (saved.cancelled) return;
    app.addRecentDocument(saved.path);
    // Re-notify so the renderer picks up the new display name + cleared dirty.
    notifyDocumentOpened(store.summarize(id), win);
  } catch (err) {
    void dialog.showMessageBox(win!, {
      type: 'error',
      message: t('dialog.couldNotSave'),
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
    buttons: [t('dialog.revert'), t('common.cancel')],
    defaultId: 0,
    cancelId: 1,
    message: t('dialog.revertConfirm'),
    detail: t('dialog.revertDetail'),
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
    title: t('dialog.exportTitle'),
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
      message: t('dialog.couldNotExport'),
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
    title: t('dialog.exportSelectedTitle'),
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
    ...tmpls.map((tmpl): MenuItemConstructorOptions => ({
      label: tmpl.name,
      submenu: [
        { label: t('menu.export.scope.library'), enabled, click: () => requestExportTemplate(tmpl.name, 'library') },
        { label: t('menu.export.scope.shown'), enabled, click: () => requestExportTemplate(tmpl.name, 'shown') },
        { label: t('menu.export.scope.selected'), enabled, click: () => requestExportTemplate(tmpl.name, 'selected') },
      ],
    })),
  ];
}

/** Columns offered in the View→Columns menu (label per builtin/common key). */
/** Colored-circle glyphs for the Color Label menu, parallel to LABEL_COLORS. */
const COLOR_MENU_DOTS = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚪'];

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
    label: columnLabel(c.key, c.label),
    type: 'checkbox' as const,
    checked: shown.has(c.key),
    enabled: hasOpenDocument(),
    click: () => focusedWindow()?.webContents.send(IpcEvents.menuToggleColumn, c.key),
  }));
}

/** Localized display name for a column, falling back to its English label (so
 *  BibTeX field-name columns like Journal/DOI stay untranslated). */
function columnLabel(key: string, fallback: string): string {
  const k = `column.${key}`;
  const tr = t(k);
  return tr === k ? fallback : tr;
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const docEnabled = hasOpenDocument();
  const fid = focusedDocId();
  const undo = fid ? store.undoState(fid) : { canUndo: false, canRedo: false };
  const template: MenuItemConstructorOptions[] = [];

  const prefsItem: MenuItemConstructorOptions = {
    label: t('menu.preferences'),
    accelerator: 'CmdOrCtrl+,',
    click: () => openPreferences(),
  };

  // --- Application menu (macOS) ---
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: t('menu.about') },
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
    label: t('menu.file'),
    submenu: [
      {
        label: t('menu.file.newPublication'),
        accelerator: 'CmdOrCtrl+N',
        enabled: docEnabled,
        click: () => sendMenuCommand('newPublication'),
      },
      { type: 'separator' },
      {
        label: t('menu.file.open'),
        accelerator: 'CmdOrCtrl+O',
        click: () => void showOpenDialog(),
      },
      { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
      { type: 'separator' },
      {
        label: t('menu.file.save'),
        accelerator: 'CmdOrCtrl+S',
        enabled: docEnabled,
        click: () => sendMenuCommand('save'),
      },
      {
        label: t('menu.file.saveAs'),
        accelerator: 'Shift+CmdOrCtrl+S',
        enabled: docEnabled,
        click: () => void saveDocumentAs(),
      },
      {
        label: t('menu.file.revert'),
        enabled: docEnabled,
        click: () => void revertToSaved(),
      },
      { label: t('menu.file.textEncoding'), enabled: docEnabled, submenu: textEncodingMenuItems() },
      {
        label: isMac ? t('menu.file.showInFinder') : t('menu.file.showInFileManager'),
        enabled: docEnabled,
        click: () => {
          const id = focusedDocId();
          if (id) shell.showItemInFolder(store.summarize(id).path);
        },
      },
      { type: 'separator' },
      {
        label: t('menu.file.import'),
        submenu: [
          {
            label: t('menu.file.importFile'),
            accelerator: 'Shift+CmdOrCtrl+I',
            enabled: docEnabled,
            click: () => sendMenuCommand('importFile'),
          },
          {
            label: t('menu.file.searchOnline'),
            accelerator: 'Shift+CmdOrCtrl+O',
            enabled: docEnabled,
            click: () => sendMenuCommand('online'),
          },
        ],
      },
      {
        label: t('menu.file.export'),
        submenu: [
          { label: t('menu.file.exportBibtex'), enabled: docEnabled, click: () => void exportDocumentAs('bibtex') },
          { label: t('menu.file.exportRis'), enabled: docEnabled, click: () => void exportDocumentAs('ris') },
          { label: t('menu.file.exportCsv'), enabled: docEnabled, click: () => void exportDocumentAs('csv') },
          { label: t('menu.file.exportHtml'), enabled: docEnabled, click: () => void exportDocumentAs('html') },
          { label: t('menu.file.exportRtf'), enabled: docEnabled, click: () => void exportDocumentAs('rtf') },
          { type: 'separator' },
          { label: t('menu.file.exportSelected'), enabled: docEnabled, click: () => sendMenuCommand('exportSelected') },
          ...templateMenuItems(),
        ],
      },
      {
        label: t('menu.file.selectFromAux'),
        enabled: docEnabled,
        click: () => sendMenuCommand('selectFromAux'),
      },
      { type: 'separator' },
      {
        label: t('menu.file.print'),
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
    label: t('menu.edit'),
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
        label: t('menu.edit.selectIncomplete'),
        enabled: docEnabled,
        click: () => sendMenuCommand('selectIncomplete'),
      },
      { type: 'separator' },
      {
        label: t('menu.edit.pastePublication'),
        accelerator: 'Shift+CmdOrCtrl+V',
        enabled: docEnabled,
        click: () => sendMenuCommand('pastePublication'),
      },
      { type: 'separator' },
      {
        label: t('menu.edit.find'),
        accelerator: 'CmdOrCtrl+F',
        enabled: docEnabled,
        click: () => sendMenuCommand('find'),
      },
      {
        label: t('menu.edit.findReplace'),
        accelerator: 'Alt+CmdOrCtrl+F',
        enabled: docEnabled,
        click: () => sendMenuCommand('findReplace'),
      },
      { type: 'separator' },
      {
        label: t('menu.edit.copyCiteKey'),
        accelerator: 'Alt+CmdOrCtrl+K',
        enabled: docEnabled,
        click: () => sendMenuCommand('copyCiteKey'),
      },
      {
        label: t('menu.edit.copyCitation'),
        enabled: docEnabled,
        click: () => sendMenuCommand('copyCitation'),
      },
      {
        label: t('menu.edit.copyRtf'),
        accelerator: 'Alt+CmdOrCtrl+R',
        enabled: docEnabled,
        click: () => sendMenuCommand('copyRtf'),
      },
      {
        label: t('menu.edit.copyBibtex'),
        accelerator: 'Alt+CmdOrCtrl+B',
        enabled: docEnabled,
        click: () => sendMenuCommand('copyBibtex'),
      },
      {
        label: t('menu.edit.copyCite'),
        accelerator: 'Alt+CmdOrCtrl+C',
        enabled: docEnabled,
        click: () => sendMenuCommand('copyCite'),
      },
      {
        label: t('menu.edit.copyAs'),
        submenu: [
          { label: t('menu.edit.copyAs.ris'), enabled: docEnabled, click: () => sendMenuCommand('copyRis') },
          { label: t('menu.edit.copyAs.minimalBibtex'), enabled: docEnabled, click: () => sendMenuCommand('copyMinimalBibtex') },
          { label: t('menu.edit.copyAs.bibitem'), enabled: docEnabled, click: () => sendMenuCommand('copyBibitem') },
        ],
      },
    ],
  });

  // --- Publication ---
  template.push({
    label: t('menu.publication'),
    submenu: [
      {
        label: t('menu.publication.new'),
        accelerator: 'CmdOrCtrl+N',
        enabled: docEnabled,
        click: () => sendMenuCommand('newPublication'),
      },
      {
        label: t('menu.publication.newCrossref'),
        enabled: docEnabled,
        click: () => sendMenuCommand('newWithCrossref'),
      },
      {
        label: t('menu.publication.edit'),
        accelerator: 'CmdOrCtrl+E',
        enabled: docEnabled,
        click: () => sendMenuCommand('editEntry'),
      },
      {
        label: t('menu.publication.duplicate'),
        accelerator: 'Shift+CmdOrCtrl+D',
        enabled: docEnabled,
        click: () => sendMenuCommand('duplicate'),
      },
      {
        label: t('menu.publication.delete'),
        enabled: docEnabled,
        click: () => sendMenuCommand('delete'),
      },
      { type: 'separator' },
      {
        label: t('menu.publication.generateCiteKey'),
        accelerator: 'CmdOrCtrl+K',
        enabled: docEnabled,
        click: () => sendMenuCommand('generateCiteKey'),
      },
      {
        label: t('menu.publication.selectParent'),
        enabled: docEnabled,
        click: () => sendMenuCommand('selectParent'),
      },
      {
        label: t('menu.publication.colorLabel'),
        enabled: docEnabled,
        submenu: [
          ...LABEL_COLORS.map((c, i) => ({
            label: `${COLOR_MENU_DOTS[i] ?? '●'}  ${c.name}`,
            enabled: docEnabled,
            click: () => focusedWindow()?.webContents.send(IpcEvents.menuSetColor, i + 1),
          })),
          { type: 'separator' as const },
          {
            label: t('menu.publication.colorNone'),
            enabled: docEnabled,
            click: () => focusedWindow()?.webContents.send(IpcEvents.menuSetColor, 0),
          },
        ],
      },
      {
        label: t('menu.publication.findDuplicates'),
        enabled: docEnabled,
        click: () => sendMenuCommand('findDuplicates'),
      },
      { type: 'separator' },
      {
        label: t('menu.publication.addAttachment'),
        enabled: docEnabled,
        click: () => sendMenuCommand('addAttachment'),
      },
      {
        label: t('menu.publication.autoFile'),
        enabled: docEnabled,
        click: () => sendMenuCommand('autoFile'),
      },
      {
        label: t('menu.publication.consolidate'),
        enabled: docEnabled,
        click: () => sendMenuCommand('consolidate'),
      },
      {
        label: t('menu.publication.findBrokenLinks'),
        enabled: docEnabled,
        click: () => sendMenuCommand('findBrokenLinks'),
      },
      { type: 'separator' },
      {
        label: t('menu.publication.macros'),
        enabled: docEnabled,
        click: () => sendMenuCommand('editMacros'),
      },
    ],
  });

  // --- Tools ---
  template.push({
    label: t('menu.tools'),
    submenu: [
      {
        label: t('menu.tools.assistant'),
        accelerator: 'CmdOrCtrl+J',
        enabled: docEnabled,
        click: () => sendMenuCommand('assistant'),
      },
      {
        label: t('menu.tools.scriptConsole'),
        accelerator: 'CmdOrCtrl+Alt+J',
        enabled: docEnabled,
        click: () => sendMenuCommand('scriptConsole'),
      },
      {
        label: t('menu.tools.scripts'),
        submenu: [
          ...(listScriptFiles(app.getPath('userData')).map((f) => ({
            label: f.name,
            enabled: docEnabled,
            click: () => runSavedScript(f.path),
          })) as Electron.MenuItemConstructorOptions[]),
          ...(listScriptFiles(app.getPath('userData')).length === 0
            ? [{ label: t('scripts.none'), enabled: false } as Electron.MenuItemConstructorOptions]
            : []),
          { type: 'separator' },
          {
            label: t('scripts.new'),
            click: () => {
              void shell.openPath(newScriptFile(app.getPath('userData')));
              buildMenu();
            },
          },
          {
            label: t('scripts.openFolder'),
            click: () => void shell.openPath(ensureScriptsDir(app.getPath('userData'))),
          },
        ],
      },
      { type: 'separator' },
      {
        label: t('menu.tools.journalCovers'),
        enabled: docEnabled,
        click: () => sendMenuCommand('scanJournalCovers'),
      },
      { type: 'separator' },
      {
        label: t('menu.tools.texPreview'),
        enabled: docEnabled,
        click: () => sendMenuCommand('texPreview'),
      },
    ],
  });

  // --- View ---
  template.push({
    label: t('menu.view'),
    submenu: [
      {
        label: t('menu.view.toggleSide'),
        accelerator: 'CmdOrCtrl+Alt+S',
        click: () => sendMenuCommand('toggleSidePanel'),
      },
      {
        label: t('menu.view.toggleBottom'),
        accelerator: 'CmdOrCtrl+Alt+B',
        click: () => sendMenuCommand('toggleBottomPanel'),
      },
      {
        label: t('menu.view.sidePanel'),
        submenu: [
          {
            label: t('panel.details'),
            accelerator: 'CmdOrCtrl+Alt+1',
            click: () => sendMenuCommand('sidePaneDetails'),
          },
          {
            label: t('panel.claude'),
            accelerator: 'CmdOrCtrl+Alt+2',
            click: () => sendMenuCommand('sidePaneAssistant'),
          },
        ],
      },
      {
        label: t('menu.view.bottomPanel'),
        submenu: [
          {
            label: t('panel.annotation'),
            accelerator: 'CmdOrCtrl+Alt+3',
            click: () => sendMenuCommand('bottomPaneAnnotation'),
          },
          {
            label: t('panel.tabbed'),
            accelerator: 'CmdOrCtrl+Alt+4',
            click: () => sendMenuCommand('bottomPaneTabbed'),
          },
          {
            label: t('panel.texPreview'),
            accelerator: 'CmdOrCtrl+Alt+5',
            click: () => sendMenuCommand('bottomPaneTexPreview'),
          },
        ],
      },
      { type: 'separator' },
      { label: t('menu.view.columns'), submenu: columnMenuItems() },
      { type: 'separator' },
      {
        label: t('menu.view.toggleTheme'),
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
    label: t('menu.window'),
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
        label: t('menu.help.bibdesk'),
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
    buttons: [t('dialog.approve'), t('dialog.deny')],
    defaultId: 0,
    cancelId: 1,
    message: t('dialog.assistantRun', { name }),
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
    case 'regenerate_cite_keys': {
      const keys = Array.isArray(input.citeKeys) ? (input.citeKeys as string[]) : undefined;
      const res = store.agentRegenerateCiteKeys(documentId, keys);
      if (res.count === 0) return 'No cite keys changed (they already match the configured format).';
      const sample = res.changes.slice(0, 25).map((c) => `${c.from} → ${c.to}`).join('\n');
      const crossref =
        res.crossrefUpdated > 0
          ? `\nRepointed ${res.crossrefUpdated} crossref reference(s) to the renamed entries.`
          : '';
      return `Regenerated ${res.count} cite key(s):\n${sample}${res.changes.length > 25 ? '\n…' : ''}${crossref}`;
    }
    case 'batch_set_field': {
      const keys = Array.isArray(input.citeKeys) ? (input.citeKeys as string[]) : undefined;
      const value = String(input.value ?? '');
      const res = store.agentBatchSetField(documentId, String(input.field), value, keys);
      const verb = value ? `Set ${input.field}` : `Cleared ${input.field}`;
      return `${verb} on ${res.count} entr${res.count === 1 ? 'y' : 'ies'}.`;
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
    [IpcChannels.renderMultiPanel]: (req) => {
      // Build the (capped) per-item context, then render both multi templates.
      const shown = req.itemIds.slice(0, MULTI_LIST_CAP);
      const items = shown.map((id) => {
        const d = store.getItemDetail({ documentId: req.documentId, itemId: id });
        return { id, citeKey: d.citeKey, previewHtml: d.previewHtml, notesHtml: d.notesHtml };
      });
      const count = req.itemIds.length;
      return {
        count,
        ...renderMultiPanels({ count, moreCount: Math.max(0, count - items.length), items }),
      };
    },
    [IpcChannels.openExternal]: (req) => openExternalTarget(req),
    [IpcChannels.applyEdit]: (req) => store.applyEdit(req),
    [IpcChannels.batchEdit]: (req) => store.batchEdit(req.documentId, req.itemIds, req.op),
    [IpcChannels.listMacros]: (req) => store.listMacros(req),
    [IpcChannels.saveDocument]: (req) =>
      saveWithEncodingGuard(req.documentId, req.targetPath, windowForDoc(req.documentId)),
    [IpcChannels.formatCitation]: (req) => {
      try {
        const html = formatCitation(
          store.cslItemFor(req.documentId, req.itemId),
          req.styleId,
          getSettings().citationAutolink,
        );
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
    [IpcChannels.listCitationStyles]: () => ({ styles: listStyles() }),
    [IpcChannels.installCitationStyle]: async () => {
      const parent = dialogParent();
      const opts: Electron.OpenDialogOptions = {
        title: t('prefs.installStyleTitle'),
        properties: ['openFile'],
        filters: [
          { name: 'CSL style', extensions: ['csl'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      };
      const result = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
      const file = result.canceled ? undefined : result.filePaths[0];
      if (!file) return {}; // cancelled
      try {
        return { style: installCslFile(file) };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
    [IpcChannels.removeCitationStyle]: (req) => ({ ok: removeCslStyle(req.id) }),
    [IpcChannels.texPreview]: async (req) => {
      try {
        const bibText = store.serializeDocument(req.documentId);
        const s = getSettings();
        const binDir = s.texBinDir || undefined;
        const citeKeys = req.scope === 'selection' ? req.citeKeys : undefined;
        const keyCount = citeKeys?.length ?? 0;

        // Small selections → crisp, theme-able inline SVG; the whole library and
        // big selections → PDF (PDF.js). Fall back to PDF when dvisvgm is absent.
        const useSvg =
          req.scope === 'selection' &&
          keyCount > 0 &&
          keyCount <= SVG_MAX_KEYS &&
          !!findTexBin('dvisvgm', binDir);
        if (useSvg) {
          const svg = await renderTexPreviewSvg({ bibText, citeKeys, bstStyle: s.texBibStyle, binDir });
          if (svg.svgs?.length) return { ok: true, kind: 'svg', svgs: svg.svgs };
          // A real compile error (TeX present) is worth surfacing; otherwise drop
          // through and let the PDF path report the missing-TeX message.
          if (svg.error && findTexBin('latex', binDir)) return { ok: false, error: svg.error };
        }

        const result = await renderTexPreview({ bibText, citeKeys, bstStyle: s.texBibStyle, binDir });
        if (result.error || !result.pdfPath) {
          return { ok: false, error: result.error ?? t('texPreview.failed') };
        }
        return { ok: true, kind: 'pdf', pdfBytes: new Uint8Array(readFileSync(result.pdfPath)) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    [IpcChannels.journalCover]: (req) => {
      const journal =
        store.fieldValue(req.documentId, req.itemId, 'Journal') ||
        store.fieldValue(req.documentId, req.itemId, 'Booktitle');
      const loaded = loadCoverIndex(app.getAppPath(), app.getPath('userData'));
      if (!loaded) return { data: null, ...(journal ? { journal } : {}) };
      const issn = store.fieldValue(req.documentId, req.itemId, 'Issn');
      const hit = resolveCover(loaded.index, issn, journal);
      const path = hit ? coverPathOf(loaded, hit) : null;
      if (!hit || !path) return { data: null, ...(journal ? { journal } : {}) };
      try {
        return {
          data: new Uint8Array(readFileSync(path)),
          kind: hit.kind,
          ...(journal ? { journal } : {}),
        };
      } catch {
        return { data: null, ...(journal ? { journal } : {}) };
      }
    },
    [IpcChannels.setJournalCover]: (req) => {
      const journal =
        store.fieldValue(req.documentId, req.itemId, 'Journal') ||
        store.fieldValue(req.documentId, req.itemId, 'Booktitle');
      if (!journal) return { ok: false };
      const issn = store.fieldValue(req.documentId, req.itemId, 'Issn');
      try {
        saveUserCover({
          userDir: userCoversDir(app.getPath('userData')),
          name: journal,
          ...(issn ? { issns: [issn] } : {}),
          ext: req.ext,
          bytes: req.data,
          kind: 'user',
        });
        invalidateCoverIndex();
        return { ok: true, journal };
      } catch {
        return { ok: false, journal };
      }
    },
    [IpcChannels.scanJournalCovers]: async (req) => {
      // Cap the scan so a huge library doesn't fire hundreds of Wikipedia requests.
      const CAP = 80;
      const loaded = loadCoverIndex(app.getAppPath(), app.getPath('userData'));
      const missing = store
        .distinctJournals(req.documentId)
        .filter((j) => !(loaded && resolveCover(loaded.index, j.issn, j.journal)));
      const proposals: JournalCoverProposal[] = [];
      for (const j of missing.slice(0, CAP)) {
        const cover = await fetchWikipediaCover(j.journal);
        if (!cover) continue;
        proposals.push({
          journal: j.journal,
          ...(j.issn ? { issn: j.issn } : {}),
          data: cover.data,
          ext: cover.ext,
          sourceUrl: cover.sourceUrl,
          wikiTitle: cover.wikiTitle,
        });
      }
      return { proposals, missing: missing.length, ...(missing.length > CAP ? { capped: true } : {}) };
    },
    [IpcChannels.saveJournalCovers]: (req) => {
      const userDir = userCoversDir(app.getPath('userData'));
      let saved = 0;
      for (const c of req.covers) {
        try {
          saveUserCover({
            userDir,
            name: c.journal,
            ...(c.issn ? { issns: [c.issn] } : {}),
            ext: c.ext,
            bytes: c.data,
            kind: 'wikipedia',
            ...(c.sourceUrl ? { sourceUrl: c.sourceUrl } : {}),
            ...(c.wikiTitle ? { wikiTitle: c.wikiTitle } : {}),
          });
          saved += 1;
        } catch {
          /* skip a cover that failed to write */
        }
      }
      if (saved) {
        invalidateCoverIndex();
        // Refresh every window (including the one that ran the scan) so covers re-resolve.
        broadcastDocumentChanged(req.documentId);
      }
      return { saved };
    },
    [IpcChannels.addAttachment]: async (req) => {
      // Paths supplied (drag-and-drop onto the detail pane) → attach directly.
      if (req.paths && req.paths.length > 0) {
        return store.addAttachments(req.documentId, req.itemId, req.paths);
      }
      // Otherwise prompt with a native file picker.
      const opts: Electron.OpenDialogOptions = {
        title: t('dialog.addAttachmentTitle'),
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
        ? await dialog.showOpenDialog(parent, { title: t('dialog.locateFileTitle'), properties: ['openFile'] })
        : await dialog.showOpenDialog({ title: t('dialog.locateFileTitle'), properties: ['openFile'] });
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
        autoFileOnAdd: s.autoFileOnAdd,
        annotationStorage: s.annotationStorage,
        abstractStorage: s.abstractStorage,
        renderCite,
        renderBibliography,
        defaultCiteStyle: s.defaultCiteStyle,
        inlineCiteStyle: s.inlineCiteStyle,
        citationAutolink: s.citationAutolink,
        detailsTemplate: resolveActivePanelBody(s.detailsForks, s.activeDetailsFork),
        bottomPanelTemplate: resolveActivePanelBody(s.bottomForks, s.activeBottomFork),
      });
      // Full-text page-limit changed → re-extract + re-index every open document's
      // PDFs at the new limit (the cache misses on the limit change, so it's a real
      // re-extraction; runs in the background worker pool).
      if (s.ftsPageLimit !== ftsPageLimit) {
        ftsPageLimit = s.ftsPageLimit;
        for (const id of store.openDocumentIds()) {
          void store.reindexAttachments(id, pdfExtract).then(() => pdfCache?.flush());
        }
      }
      // Re-localize the menu when the UI language changes.
      if (req.patch.locale !== undefined) setMainLocale(s.locale);
      // refresh View→Columns checkmarks, the File→Export template list, or labels
      if (req.patch.columns || req.patch.exportTemplates || req.patch.locale !== undefined) {
        buildMenu();
      }
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
        title: t('dialog.selectFromAuxTitle'),
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
        buttons: [t('dialog.ok')],
        message: sel.matchedIds.length
          ? t(sel.matchedIds.length === 1 ? 'dialog.auxSelected' : 'dialog.auxSelectedPlural', {
              count: sel.matchedIds.length,
              file: basename(file),
            })
          : t('dialog.auxNoMatch', { file: basename(file) }),
        ...(sel.missingKeys.length
          ? {
              detail: t(
                sel.missingKeys.length === 1 ? 'dialog.auxMissing' : 'dialog.auxMissingPlural',
                {
                  count: sel.missingKeys.length,
                  list: `${sel.missingKeys.slice(0, 15).join(', ')}${sel.missingKeys.length > 15 ? ', …' : ''}`,
                },
              ),
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
        title: t('dialog.exportFolderTitle'),
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
        buttons: [t('dialog.ok')],
        message: t(copied === 1 ? 'dialog.exportedFiles' : 'dialog.exportedFilesPlural', {
          count: copied,
          dest: basename(dest),
        }),
        ...(errors.length
          ? {
              detail: t(errors.length === 1 ? 'dialog.problems' : 'dialog.problemsPlural', {
                count: errors.length,
                list: `${errors.slice(0, 12).join('\n')}${errors.length > 12 ? '\n…' : ''}`,
              }),
            }
          : {}),
      };
      if (parent) void dialog.showMessageBox(parent, summary);
      else void dialog.showMessageBox(summary);
      return { canceled: false, copied, errors };
    },
    [IpcChannels.setColor]: (req) => store.setItemColor(req.documentId, req.itemIds, req.colorIndex),
    [IpcChannels.selectIncomplete]: (req) => {
      const itemIds = store.incompleteItemIds(req.documentId);
      if (itemIds.length === 0) {
        const w = dialogParent();
        const opts: Electron.MessageBoxOptions = {
          type: 'info',
          buttons: [t('dialog.ok')],
          message: t('dialog.noIncomplete'),
          detail: t('dialog.noIncompleteDetail'),
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
    [IpcChannels.previewPanel]: (req) => store.previewPanel(req),
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
        title: t('dialog.importTitle'),
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
    [IpcChannels.commitStagedEntry]: (req) =>
      store.commitStagedEntry(req.stagingDocId, req.itemId, req.documentId, req.attachPath),
    [IpcChannels.discardStagingDoc]: (req) => {
      try {
        store.closeDocument({ documentId: req.stagingDocId });
      } catch {
        /* already gone — fine */
      }
      return { ok: true };
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
    [IpcChannels.openAnnotation]: (req) => {
      createAnnotationWindow(req.documentId, req.itemId);
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
    [IpcChannels.autoFile]: async (req) => {
      const ids = req.itemIds;
      if (ids.length === 0) return { moved: 0, errors: [], dirty: store.isDirty(req.documentId) };

      // Single entry: file it directly — quick, no confirm — and return its detail.
      if (ids.length === 1) {
        const res = store.autoFile(req.documentId, ids[0]!);
        return {
          moved: res.moved,
          errors: res.errors,
          dirty: store.isDirty(req.documentId),
          detail: res.detail,
        };
      }

      // Multiple entries: this moves files on disk, so confirm first.
      const confirmOpts: Electron.MessageBoxOptions = {
        type: 'warning',
        buttons: [t('dialog.autoFile'), t('common.cancel')],
        defaultId: 0,
        cancelId: 1,
        message: t('dialog.autoFileConfirm'),
        detail: t('dialog.autoFileDetail', { count: ids.length }),
      };
      const parent = dialogParent();
      const choice = parent
        ? await dialog.showMessageBox(parent, confirmOpts)
        : await dialog.showMessageBox(confirmOpts);
      if (choice.response !== 0) return { moved: 0, errors: [], dirty: store.isDirty(req.documentId) };

      const res = store.consolidateLinkedFiles(req.documentId, ids);
      const summaryOpts: Electron.MessageBoxOptions = {
        type: res.errors.length ? 'warning' : 'info',
        buttons: [t('dialog.ok')],
        message:
          res.moved > 0
            ? t('dialog.filed', {
                count: res.moved,
                fileNoun: t(res.moved === 1 ? 'dialog.file' : 'dialog.files'),
                entryCount: res.itemsAffected,
                entryNoun: t(res.itemsAffected === 1 ? 'dialog.entry' : 'dialog.entries'),
              })
            : t('dialog.noFilingNeeded'),
        ...(res.errors.length
          ? {
              detail: t(res.errors.length === 1 ? 'dialog.problems' : 'dialog.problemsPlural', {
                count: res.errors.length,
                list: `${res.errors.slice(0, 12).join('\n')}${res.errors.length > 12 ? '\n…' : ''}`,
              }),
            }
          : {}),
      };
      if (parent) void dialog.showMessageBox(parent, summaryOpts);
      else void dialog.showMessageBox(summaryOpts);
      return { moved: res.moved, errors: res.errors, dirty: res.dirty };
    },
    [IpcChannels.consolidateLinkedFiles]: async (req) => {
      const scope =
        req.itemIds && req.itemIds.length > 0
          ? t(
              req.itemIds.length === 1
                ? 'dialog.consolidateScopeSelected'
                : 'dialog.consolidateScopeSelectedPlural',
              { count: req.itemIds.length },
            )
          : t('dialog.consolidateScopeAll');
      const confirmOpts: Electron.MessageBoxOptions = {
        type: 'warning',
        buttons: [t('dialog.consolidate'), t('common.cancel')],
        defaultId: 0,
        cancelId: 1,
        message: t('dialog.consolidateConfirm'),
        detail: t('dialog.consolidateDetail', { scope }),
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
        buttons: [t('dialog.ok')],
        message:
          res.moved > 0
            ? t('dialog.filed', {
                count: res.moved,
                fileNoun: t(res.moved === 1 ? 'dialog.file' : 'dialog.files'),
                entryCount: res.itemsAffected,
                entryNoun: t(res.itemsAffected === 1 ? 'dialog.entry' : 'dialog.entries'),
              })
            : t('dialog.noFilingNeeded'),
        ...(res.errors.length
          ? {
              detail: t(res.errors.length === 1 ? 'dialog.problems' : 'dialog.problemsPlural', {
                count: res.errors.length,
                list: `${res.errors.slice(0, 12).join('\n')}${res.errors.length > 12 ? '\n…' : ''}`,
              }),
            }
          : {}),
      };
      if (parent) void dialog.showMessageBox(parent, summaryOpts);
      else void dialog.showMessageBox(summaryOpts);
      return res;
    },
    [IpcChannels.chooseFolder]: async () => {
      const opts: Electron.OpenDialogOptions = {
        title: t('dialog.choosePapersTitle'),
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
    [IpcChannels.runScript]: (req) => {
      const r = runScript(store, req.documentId, req.code, {
        timeoutMs: 10000,
        version: app.getVersion(),
        capabilities: makeScriptCapabilities(focusedWindow()),
      });
      return {
        output: r.output,
        result:
          r.result === undefined
            ? undefined
            : typeof r.result === 'string'
              ? r.result
              : JSON.stringify(r.result, null, 2),
        mutated: r.mutated,
        error: r.error?.message,
        errorLine: r.error?.line,
      };
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
  ipcMain.handle(IpcChannels.renderMultiPanel, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.renderMultiPanel](req),
  );
  ipcMain.handle(IpcChannels.openExternal, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.openExternal](req),
  );
  mutating(IpcChannels.applyEdit);
  mutating(IpcChannels.batchEdit);
  mutating(IpcChannels.setColor);
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
  ipcMain.handle(IpcChannels.listCitationStyles, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.listCitationStyles](req),
  );
  ipcMain.handle(IpcChannels.installCitationStyle, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.installCitationStyle](req),
  );
  ipcMain.handle(IpcChannels.removeCitationStyle, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.removeCitationStyle](req),
  );
  ipcMain.handle(IpcChannels.texPreview, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.texPreview](req),
  );
  ipcMain.handle(IpcChannels.journalCover, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.journalCover](req),
  );
  // Drop-to-add broadcasts documentChanged to OTHER windows (the originating window
  // re-renders its cover element itself). Scan is read-only; save broadcasts itself.
  mutating(IpcChannels.setJournalCover);
  ipcMain.handle(IpcChannels.scanJournalCovers, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.scanJournalCovers](req),
  );
  ipcMain.handle(IpcChannels.saveJournalCovers, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.saveJournalCovers](req),
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
  ipcMain.handle(IpcChannels.previewPanel, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.previewPanel](req),
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
  mutating(IpcChannels.commitStagedEntry); // creates the entry in `documentId` (target)
  ipcMain.handle(IpcChannels.discardStagingDoc, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.discardStagingDoc](req),
  );
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
  ipcMain.handle(IpcChannels.openAnnotation, (_e: IpcMainInvokeEvent, req) =>
    handlers[IpcChannels.openAnnotation](req),
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
  mutating(IpcChannels.runScript);
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

// Mark that a quit is underway, so a dirty window's save-prompt (which must
// preventDefault the close, aborting the quit) can resume it after closing.
app.on('before-quit', () => {
  isQuitting = true;
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
    ftsPageLimit = settings.ftsPageLimit ?? 40; // PDF full-text extraction depth
    loadUserStyles(); // register any user-installed CSL styles before first render
    setMainLocale(settings.locale); // bind the menu translator before buildMenu()
    store.setEditConfig({
      citeKeyFormat: settings.citeKeyFormat,
      defaultEntryType: settings.defaultEntryType,
      papersFolder: settings.papersFolder,
      autoFileFormat: settings.autoFileFormat,
      autoFileOnAdd: settings.autoFileOnAdd,
      annotationStorage: settings.annotationStorage,
      abstractStorage: settings.abstractStorage,
      renderCite,
      renderBibliography,
      defaultCiteStyle: settings.defaultCiteStyle,
      inlineCiteStyle: settings.inlineCiteStyle,
      citationAutolink: settings.citationAutolink,
      detailsTemplate: resolveActivePanelBody(settings.detailsForks, settings.activeDetailsFork),
      bottomPanelTemplate: resolveActivePanelBody(settings.bottomForks, settings.activeBottomFork),
    });
    registerIpc();
    ensureScriptsDir(app.getPath('userData')); // create the Scripts folder for the Scripts menu
    buildMenu();
    startBridge();
    // macOS AppleScript dictionary (no-op elsewhere / if the native addon isn't
    // built). A scripted write refreshes open windows + menus like an IPC edit
    // would; defer to the next loop turn so it runs after the synchronous Apple
    // Event handler (which re-entered V8) returns.
    initScripting(store, (documentId) => {
      setImmediate(() => {
        broadcastDocumentChanged(documentId);
        buildMenu();
      });
    });
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
          message: t('dialog.couldNotOpen', { path: startup }),
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
