/**
 * Pure navigation policy for the window guard — kept electron-free so it is unit
 * testable (the repo convention: modules that import `electron` are not unit
 * tested). The electron wiring lives in `main/window-security.ts`.
 */

/**
 * True when navigating from `current` to `target` stays within the SAME loaded
 * document (a reload, or a query/hash re-entry) — the only navigations an app
 * window should perform. Everything else (a remote origin, or a different local
 * file) is a redirect an injection would use, and must be blocked.
 *
 * Compares protocol + host + pathname rather than `origin`, because every
 * `file://` URL has the same opaque origin (`"null"`), which would otherwise let
 * a navigation to `file:///etc/passwd` masquerade as same-origin.
 */
export function isAppNavigation(target: string, current: string): boolean {
  if (!current) return false; // no current document yet → nothing is "same"
  try {
    const t = new URL(target);
    const c = new URL(current);
    return t.protocol === c.protocol && t.host === c.host && t.pathname === c.pathname;
  } catch {
    return false;
  }
}
