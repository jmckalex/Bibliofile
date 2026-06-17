import { describe, it, expect } from 'vitest';
import { readFolders, writeFolders, nextFolderId, isSelfOrDescendant, type FolderRecord } from './folders.js';

describe('folders persistence', () => {
  it('round-trips folders through the @comment block', () => {
    const lib = { preambles: [] as string[] };
    const folders: FolderRecord[] = [
      { id: 'fld-1', name: 'PH456', parentId: null, groups: ['Required', 'Recommended'] },
      { id: 'fld-2', name: 'Week 1', parentId: 'fld-1', groups: [] },
    ];
    writeFolders(lib, folders);
    expect(lib.preambles).toHaveLength(1);
    expect(lib.preambles[0]).toMatch(/^@comment\{BibDesk-Electron Folders\{/);
    expect(readFolders(lib)).toEqual(folders);
  });

  it('writeFolders([]) removes the block and preserves other preambles', () => {
    const lib = { preambles: ['@preamble{"x"}'] };
    writeFolders(lib, [{ id: 'fld-1', name: 'A', parentId: null, groups: [] }]);
    expect(lib.preambles).toHaveLength(2);
    writeFolders(lib, []);
    expect(lib.preambles).toEqual(['@preamble{"x"}']);
    expect(readFolders(lib)).toEqual([]);
  });

  it('is base64-safe for names with braces / @', () => {
    const lib = { preambles: [] as string[] };
    const folders: FolderRecord[] = [{ id: 'fld-1', name: 'A {weird} @name', parentId: null, groups: ['G}'] }];
    writeFolders(lib, folders);
    expect(readFolders(lib)).toEqual(folders);
  });

  it('nextFolderId returns max+1', () => {
    expect(nextFolderId([])).toBe('fld-1');
    expect(
      nextFolderId([
        { id: 'fld-3', name: '', parentId: null, groups: [] },
        { id: 'fld-1', name: '', parentId: null, groups: [] },
      ]),
    ).toBe('fld-4');
  });

  it('isSelfOrDescendant detects cycles', () => {
    const fs: FolderRecord[] = [
      { id: 'a', name: 'A', parentId: null, groups: [] },
      { id: 'b', name: 'B', parentId: 'a', groups: [] },
      { id: 'c', name: 'C', parentId: 'b', groups: [] },
    ];
    expect(isSelfOrDescendant(fs, 'a', 'a')).toBe(true); // self
    expect(isSelfOrDescendant(fs, 'a', 'c')).toBe(true); // c descends from a
    expect(isSelfOrDescendant(fs, 'c', 'a')).toBe(false); // a is not under c
  });
});
