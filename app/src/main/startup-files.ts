/**
 * Which libraries to open when the app starts (Preferences ▸ General ▸ Open at
 * startup). Electron-free so it is unit-testable; index.ts does the opening.
 */

import { resolve } from 'node:path';

export interface StartupPlan {
  /** Paths to open, in order. Opening an already-open path just focuses its window. */
  readonly open: readonly string[];
  /** Listed startup libraries that no longer exist (moved, renamed, unmounted). */
  readonly missing: readonly string[];
}

/**
 * The "Open at startup" list first, in its order, then the file the app was
 * launched with, last so that its window ends up in front. Duplicates (compared
 * as resolved paths) are dropped, as are non-string entries a hand-edited
 * settings.json might hold. Listed files that don't exist are reported in
 * `missing`, not opened. The launch path was already checked by its caller.
 */
export function planStartupOpen(
  startupFiles: unknown,
  launchPath: string | undefined,
  exists: (path: string) => boolean,
): StartupPlan {
  const listed = Array.isArray(startupFiles)
    ? startupFiles.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    : [];
  const seen = new Set<string>();
  const open: string[] = [];
  const missing: string[] = [];
  for (const raw of listed) {
    const path = resolve(raw);
    if (seen.has(path)) continue;
    seen.add(path);
    (exists(path) ? open : missing).push(path);
  }
  if (launchPath) {
    const path = resolve(launchPath);
    const at = open.indexOf(path);
    if (at >= 0) open.splice(at, 1);
    open.push(path);
  }
  return { open, missing };
}
