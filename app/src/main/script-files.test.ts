import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureScriptsDir,
  listScriptFiles,
  newScriptFile,
  isScriptTrusted,
  recordScriptTrust,
} from './script-files.js';

let userData: string;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'bibscripts-'));
});

describe('script-files', () => {
  it('ensureScriptsDir creates the folder; listing is empty initially', () => {
    expect(listScriptFiles(userData)).toEqual([]);
    const dir = ensureScriptsDir(userData);
    expect(dir).toBe(join(userData, 'scripts'));
    expect(listScriptFiles(userData)).toEqual([]);
  });

  it('lists *.js files (sorted, name without extension), ignoring others', () => {
    const dir = ensureScriptsDir(userData);
    writeFileSync(join(dir, 'b.js'), '//');
    writeFileSync(join(dir, 'a.js'), '//');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    expect(listScriptFiles(userData).map((f) => f.name)).toEqual(['a', 'b']);
  });

  it('newScriptFile creates a unique untitled[-N].js with starter content', () => {
    const p1 = newScriptFile(userData);
    const p2 = newScriptFile(userData);
    expect(p1).toMatch(/untitled\.js$/);
    expect(p2).toMatch(/untitled-2\.js$/);
    expect(listScriptFiles(userData).map((f) => f.name).sort()).toEqual(['untitled', 'untitled-2']);
  });

  it('trust is per-file by content; an edit re-prompts', () => {
    const dir = ensureScriptsDir(userData);
    const path = join(dir, 's.js');
    writeFileSync(path, 'console.log(1);');
    expect(isScriptTrusted(userData, path, 'console.log(1);')).toBe(false);
    recordScriptTrust(userData, path, 'console.log(1);');
    expect(isScriptTrusted(userData, path, 'console.log(1);')).toBe(true);
    // edited content → no longer trusted
    expect(isScriptTrusted(userData, path, 'console.log(2);')).toBe(false);
  });
});
