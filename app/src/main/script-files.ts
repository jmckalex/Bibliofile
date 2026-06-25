/**
 * Saved-scripts folder support for the JavaScript scripting host — the
 * `userData/scripts/*.js` files that populate the Scripts menu (mirrors BibDesk's
 * macOS Scripts menu, which the port otherwise lacks).
 *
 * Pure filesystem helpers (the `userData` path is injected) so they're testable
 * without Electron. The menu wiring + run-with-trust-prompt orchestration lives in
 * `index.ts`. Trust is per-file, keyed by absolute path → sha256(content) in
 * `scripts-trust.json`, so an *edited* script re-prompts.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ScriptFile {
  /** Display name (filename without `.js`). */
  readonly name: string;
  /** Absolute path. */
  readonly path: string;
}

/** Starter content for a new script file. */
const STARTER = `// Bibliofile script — runs against the open library via the global \`bibliofile\`.
// Saved scripts appear in Tools ▸ Scripts; the Script Console runs code interactively.
const doc = bibliofile.activeDocument;
console.log(doc.count() + ' entries');
`;

/** The scripts folder under userData, created if missing. */
export function ensureScriptsDir(userDataPath: string): string {
  const dir = join(userDataPath, 'scripts');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Saved `*.js` scripts, sorted by name. */
export function listScriptFiles(userDataPath: string): ScriptFile[] {
  const dir = join(userDataPath, 'scripts');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.js'))
      .sort((a, b) => a.localeCompare(b))
      .map((f) => ({ name: f.replace(/\.js$/i, ''), path: join(dir, f) }));
  } catch {
    return [];
  }
}

/** Create a new `untitled[-N].js` starter script; returns its path. */
export function newScriptFile(userDataPath: string): string {
  const dir = ensureScriptsDir(userDataPath);
  let name = 'untitled';
  let path = join(dir, `${name}.js`);
  for (let n = 2; existsSync(path); n++) {
    name = `untitled-${n}`;
    path = join(dir, `${name}.js`);
  }
  writeFileSync(path, STARTER);
  return path;
}

function trustFile(userDataPath: string): string {
  return join(userDataPath, 'scripts-trust.json');
}
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
function readTrust(userDataPath: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(trustFile(userDataPath), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Whether `path`'s current `code` has been trusted before (exact content). */
export function isScriptTrusted(userDataPath: string, path: string, code: string): boolean {
  return readTrust(userDataPath)[path] === hashCode(code);
}

/** Remember that `path`'s current `code` is trusted (so it won't re-prompt). */
export function recordScriptTrust(userDataPath: string, path: string, code: string): void {
  const map = readTrust(userDataPath);
  map[path] = hashCode(code);
  try {
    writeFileSync(trustFile(userDataPath), JSON.stringify(map, null, 2));
  } catch {
    /* non-fatal: the script just re-prompts next time */
  }
}
