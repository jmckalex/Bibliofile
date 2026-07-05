/**
 * Electron window security wiring: a process-wide navigation / window-open guard
 * for every present and future `webContents`, and the dev-server CSP response
 * header. The packaged-app CSP is injected as a `<meta>` tag at renderer build
 * time (see `electron.vite.config.ts`); this module only adds the dev header.
 *
 * The guard closes the escalation path behind the C1 stored-XSS finding: with a
 * preload bridge (`window.bibdesk`) attached to every load, injected code must
 * not be able to navigate a trusted app window to an attacker document (a remote
 * origin OR an arbitrary local file) that would then inherit that bridge.
 */

import { app, shell, session } from 'electron';
import { contentSecurityPolicy } from '../security/csp.js';
import { isAppNavigation } from '../security/navigation.js';

/** Open http/https/mailto externally; deny everything else. Shared by the
 *  window-open handler and the will-navigate fallback. */
function openExternalIfWeb(url: string): void {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
}

/**
 * Install a global guard on every `webContents` (main, editor, annotation, help,
 * print — present and future): deny `window.open`/`target=_blank` (opening web
 * URLs externally instead), and block any top-level navigation that leaves the
 * current app document (opening web URLs externally). Register once, before any
 * window is created.
 */
export function installNavigationGuards(): void {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      openExternalIfWeb(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (e, url) => {
      if (isAppNavigation(url, contents.getURL())) return; // reload / same document
      e.preventDefault();
      openExternalIfWeb(url);
    });
  });
}

/**
 * In development the renderer is served over http by Vite; apply the (looser,
 * HMR-compatible) CSP as a response header on the default session. The packaged
 * app gets its stricter CSP from the build-time `<meta>` tag instead.
 *
 * Only the app's own top-level document responses are stamped (`mainFrame`).
 * The default session also carries the responses of cross-origin note-embed
 * `<iframe>`s; stamping the app policy onto THOSE would clamp e.g. a YouTube
 * embed to `'self' localhost` and render it blank. A CSP is a per-document
 * policy delivered on the document response, so tagging the main frame is
 * sufficient — the app's own sub-resources are governed by the document's CSP.
 */
export function installDevCsp(devOrigin: string): void {
  const policy = contentSecurityPolicy('dev', devOrigin);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame') {
      callback({}); // leave embeds and sub-resources untouched
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}
