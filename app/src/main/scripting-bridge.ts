/**
 * Wires the macOS AppleScript dictionary to the live library: loads the native
 * Cocoa-Scripting addon (`app/native/scripting`) and points its `dispatch` at a
 * {@link ScriptingService} over the running {@link DocumentStore}. So
 * `tell application "Bibliofile" to get cite key of publication 1 of document 1`
 * resolves against the user's actual open `.bib`.
 *
 * No-op on non-macOS or when the addon isn't built — keeps the app working
 * everywhere; AppleScript is a macOS-only enhancement.
 */
import { app } from 'electron';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DocumentStore } from './document-service.js';
import { ScriptingService } from './scripting.js';

interface ScriptingAddon {
  setDispatch(fn: (requestJson: string) => string): void;
}

/** Candidate locations for the built native addon (dev tree and packaged app). */
function addonCandidates(): string[] {
  const rel = 'native/scripting/build/Release/bibliophile_scripting.node';
  return [
    join(app.getAppPath(), rel),
    join(app.getAppPath(), '..', rel),
    join(process.resourcesPath ?? '', 'bibliophile_scripting.node'),
  ];
}

/**
 * Load the native scripting addon + bind it to the live store. Safe to call once.
 * `onMutate(documentId)` is invoked after an AppleScript write so the host can
 * refresh open windows (the AppleScript path bypasses the IPC broadcast).
 */
export function initScripting(store: DocumentStore, onMutate?: (documentId: string) => void): void {
  if (process.platform !== 'darwin') return;
  try {
    const addonPath = addonCandidates().find((p) => existsSync(p));
    if (!addonPath) {
      console.log('[scripting] native addon not built; AppleScript disabled');
      return;
    }
    const require = createRequire(import.meta.url);
    const addon = require(addonPath) as ScriptingAddon;
    const service = new ScriptingService(store, app.getName(), app.getVersion(), onMutate);
    addon.setDispatch((json) => service.dispatch(json));
    console.log(`[scripting] AppleScript bridge ready (${addonPath})`);
  } catch (e) {
    console.warn('[scripting] AppleScript bridge unavailable:', e instanceof Error ? e.message : e);
  }
}
