/**
 * Folders — a "beyond BibDesk" organizational layer over groups. A folder holds
 * other folders (nestable, via `parentId`) and/or groups (by group name); folders
 * never hold publications directly (groups do). The folder tree is persisted IN
 * the `.bib` as a dedicated, namespaced `@comment{BibDesk-Electron Folders{…}}`
 * block whose payload is base64-encoded JSON — so it round-trips with the file
 * (the `.bib` stays the source of truth) and real BibDesk simply ignores it (an
 * unrecognised free `@comment`, preserved verbatim in `preambles`).
 */

/** One folder: a named container that nests (parentId) and lists child group names. */
export interface FolderRecord {
  readonly id: string;
  readonly name: string;
  /** Parent folder id, or null when the folder is top-level. */
  readonly parentId: string | null;
  /** Names of the groups placed directly in this folder. */
  readonly groups: string[];
}

/** Anything carrying a mutable `preambles` array (i.e. a parsed `BibLibrary`). */
interface HasPreambles {
  preambles: string[];
}

const FOLDERS_RE = /^@comment\{BibDesk-Electron Folders\{([A-Za-z0-9+/=]*)\}\}$/;

function normalizeFolder(x: unknown): FolderRecord | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return null;
  return {
    id: o.id,
    name: o.name,
    parentId: typeof o.parentId === 'string' ? o.parentId : null,
    groups: Array.isArray(o.groups) ? o.groups.filter((g): g is string => typeof g === 'string') : [],
  };
}

/** Read the folder tree from a library's preserved `@comment` block (or `[]`). */
export function readFolders(lib: HasPreambles): FolderRecord[] {
  for (const p of lib.preambles) {
    const m = FOLDERS_RE.exec(p.trim());
    if (!m) continue;
    try {
      const parsed: unknown = JSON.parse(Buffer.from(m[1]!, 'base64').toString('utf8'));
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeFolder).filter((f): f is FolderRecord => f !== null);
      }
    } catch {
      /* malformed payload → treat as no folders */
    }
    return [];
  }
  return [];
}

/** Replace the library's folders `@comment` block with `folders` (removed when empty). */
export function writeFolders(lib: HasPreambles, folders: readonly FolderRecord[]): void {
  for (let i = lib.preambles.length - 1; i >= 0; i--) {
    if (FOLDERS_RE.test(lib.preambles[i]!.trim())) lib.preambles.splice(i, 1);
  }
  if (folders.length > 0) {
    const b64 = Buffer.from(JSON.stringify(folders), 'utf8').toString('base64');
    lib.preambles.push(`@comment{BibDesk-Electron Folders{${b64}}}`);
  }
}

/** A fresh folder id not present in `folders` (sequential, collision-free). */
export function nextFolderId(folders: readonly FolderRecord[]): string {
  let max = 0;
  for (const f of folders) {
    const m = /^fld-(\d+)$/.exec(f.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `fld-${max + 1}`;
}

/** True if `candidateParent` is `folderId` or a descendant of it (cycle guard). */
export function isSelfOrDescendant(
  folders: readonly FolderRecord[],
  folderId: string,
  candidateParent: string,
): boolean {
  let cur: string | null = candidateParent;
  const byId = new Map(folders.map((f) => [f.id, f]));
  while (cur) {
    if (cur === folderId) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}
