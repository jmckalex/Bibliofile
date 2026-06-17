/**
 * Groups sidebar — renders the flat GroupNode[] as an N-level tree (joined via
 * parentId). Folders are nestable containers for groups (and sub-folders);
 * groups hold the publications. Clicking a group selects it and filters the
 * table; clicking a folder expands/collapses it. Static & smart groups and
 * folders are editable: create (header buttons), rename (double-click), delete
 * (× on hover). Drag a group/folder onto a folder to file/nest it, or onto the
 * Library row to move it back to the top level; static groups also accept
 * dropped publication rows (add members).
 */

import { useMemo, useState, type DragEvent, type JSX } from 'react';
import type { GroupKind, GroupNode } from '@bibdesk/shared';
import { useStore } from './store.js';
import { SmartGroupDialog } from './SmartGroupDialog.js';

/** Simple glyph per group kind (no icon dependency). */
const KIND_ICON: Record<GroupKind, string> = {
  library: '📚',
  static: '📁',
  smart: '⚙',
  category: '🏷',
  author: '👤',
  url: '🔗',
  script: '📜',
  folder: '🗂',
};

const EDITABLE = (k: GroupKind): boolean => k === 'static' || k === 'smart';
/** Renamable via inline edit: static/smart groups, author groups, and folders. */
const RENAMABLE = (k: GroupKind): boolean => EDITABLE(k) || k === 'author' || k === 'folder';
/** Deletable via the × button: static/smart groups and folders. */
const DELETABLE = (k: GroupKind): boolean => EDITABLE(k) || k === 'folder';
/** Real parsed groups that can be filed into a folder. */
const FILEABLE = (k: GroupKind): boolean => k === 'static' || k === 'smart' || k === 'url' || k === 'script';
/** A node the user can drag (to file/nest it). */
const MOVABLE = (k: GroupKind): boolean => FILEABLE(k) || k === 'folder';

const GROUPREF = 'application/x-bibdesk-groupref'; // a dragged group/folder: "<kind>:<id>"
const CITEKEYS = 'application/x-bibdesk-citekeys'; // dragged publication rows

interface Ref {
  kind: GroupKind;
  id: string;
}

function GroupRow({
  node,
  depth,
  selected,
  editing,
  collapsible,
  open,
  onSelect,
  onToggle,
  onStartRename,
  onCommitRename,
  onDelete,
  onDropKeys,
  onDropRef,
  onEditSmart,
}: {
  node: GroupNode;
  depth: number;
  selected: boolean;
  editing: boolean;
  collapsible: boolean;
  open: boolean;
  onSelect: (node: GroupNode) => void;
  onToggle: (node: GroupNode) => void;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, name: string) => void;
  onDelete: (node: GroupNode) => void;
  onDropKeys: (id: string, keys: string[]) => void;
  onDropRef: (target: GroupNode, ref: Ref) => void;
  onEditSmart: (id: string) => void;
}) {
  const [dropping, setDropping] = useState(false);
  const acceptsRefs = node.kind === 'folder' || node.kind === 'library';
  const acceptsKeys = node.kind === 'static';

  const handleDragOver = (e: DragEvent): void => {
    const t = e.dataTransfer.types;
    if ((acceptsRefs && t.includes(GROUPREF)) || (acceptsKeys && t.includes(CITEKEYS))) {
      e.preventDefault();
      setDropping(true);
    }
  };
  const handleDrop = (e: DragEvent): void => {
    setDropping(false);
    if (acceptsRefs && e.dataTransfer.types.includes(GROUPREF)) {
      e.preventDefault();
      const [kind, ...rest] = e.dataTransfer.getData(GROUPREF).split(':');
      const id = rest.join(':');
      if (kind && id) onDropRef(node, { kind: kind as GroupKind, id });
    } else if (acceptsKeys && e.dataTransfer.types.includes(CITEKEYS)) {
      e.preventDefault();
      const keys = e.dataTransfer.getData(CITEKEYS).split(',').map((k) => k.trim()).filter(Boolean);
      if (keys.length) onDropKeys(node.id, keys);
    }
  };

  return (
    <div
      className={
        'bd-group' +
        (selected ? ' bd-group--selected' : '') +
        (dropping ? ' bd-group--drop' : '')
      }
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      aria-current={selected ? 'true' : undefined}
      draggable={MOVABLE(node.kind) && !editing}
      onDragStart={(e) => {
        e.dataTransfer.setData(GROUPREF, `${node.kind}:${node.id}`);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => {
        if (editing) return;
        if (node.kind === 'folder') {
          if (collapsible) onToggle(node);
        } else onSelect(node);
      }}
      onDoubleClick={() => RENAMABLE(node.kind) && onStartRename(node.id)}
      title={node.name}
      onDragOver={handleDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={handleDrop}
    >
      {collapsible ? (
        <button
          type="button"
          className="bd-group__twisty"
          aria-label={open ? 'Collapse' : 'Expand'}
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node);
          }}
        >
          {open ? '▾' : '▸'}
        </button>
      ) : (
        <span className="bd-group__twisty bd-group__twisty--leaf" aria-hidden="true" />
      )}
      <span className="bd-group__icon" aria-hidden="true">
        {KIND_ICON[node.kind]}
      </span>
      {editing ? (
        <input
          className="bd-group__rename"
          autoFocus
          defaultValue={node.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => onCommitRename(node.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') onCommitRename(node.id, node.name);
          }}
        />
      ) : (
        <span className="bd-group__name">{node.name}</span>
      )}
      {node.kind !== 'folder' && <span className="bd-group__count">{node.count}</span>}
      {node.kind === 'smart' && !editing && (
        <button
          type="button"
          className="bd-group__edit"
          title={`Edit conditions for “${node.name}”`}
          onClick={(e) => {
            e.stopPropagation();
            onEditSmart(node.id);
          }}
        >
          ✎
        </button>
      )}
      {DELETABLE(node.kind) && !editing && (
        <button
          type="button"
          className="bd-group__del"
          title={`Delete “${node.name}”`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node);
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function GroupsSidebar() {
  const groups = useStore((s) => s.groups);
  const selectedGroupId = useStore((s) => s.selectedGroupId);
  const selectGroup = useStore((s) => s.selectGroup);
  const groupEdit = useStore((s) => s.groupEdit);
  const renameAuthor = useStore((s) => s.renameAuthor);
  const hasDoc = useStore((s) => s.documentId !== undefined);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [smartOpen, setSmartOpen] = useState(false);
  const [editSmartId, setEditSmartId] = useState<string | undefined>();
  // Per-node open override (id → open). Category sections default collapsed (their
  // 1000s of children would bury everything); folders and others default open.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const childrenByParent = useMemo(() => {
    const m = new Map<string, GroupNode[]>();
    for (const g of groups) {
      if (!g.parentId) continue;
      const list = m.get(g.parentId);
      if (list) list.push(g);
      else m.set(g.parentId, [g]);
    }
    return m;
  }, [groups]);
  const roots = useMemo(() => groups.filter((g) => !g.parentId), [groups]);

  const isOpen = (node: GroupNode): boolean => openSections[node.id] ?? node.kind !== 'category';
  const toggle = (node: GroupNode): void => setOpenSections((s) => ({ ...s, [node.id]: !isOpen(node) }));

  const newStatic = async (): Promise<void> => {
    const id = await groupEdit({ kind: 'createStatic', name: 'New Group' });
    if (id) setEditingId(id);
  };
  const newFolder = async (): Promise<void> => {
    const id = await groupEdit({ kind: 'createFolder', name: 'New Folder' });
    if (id) setEditingId(id);
  };
  const commitRename = (id: string, name: string): void => {
    setEditingId(undefined);
    const trimmed = name.trim();
    const group = groups.find((g) => g.id === id);
    if (!group || !trimmed || trimmed === group.name) return;
    if (group.kind === 'author') void renameAuthor(group.name, trimmed);
    else if (group.kind === 'folder') void groupEdit({ kind: 'renameFolder', folderId: id, name: trimmed });
    else void groupEdit({ kind: 'rename', groupId: id, name: trimmed });
  };
  const onDelete = (node: GroupNode): void => {
    if (node.kind === 'folder') void groupEdit({ kind: 'deleteFolder', folderId: node.id });
    else void groupEdit({ kind: 'delete', groupId: node.id });
  };
  // Drop a group/folder onto a folder (file/nest) or onto Library (move to top level).
  const onDropRef = (target: GroupNode, ref: Ref): void => {
    if (ref.id === target.id) return;
    const folderId = target.kind === 'folder' ? target.id : undefined;
    if (ref.kind === 'folder') {
      void groupEdit({ kind: 'moveFolder', folderId: ref.id, ...(folderId ? { parentId: folderId } : {}) });
    } else {
      void groupEdit({ kind: 'setGroupFolder', groupId: ref.id, ...(folderId ? { folderId } : {}) });
    }
  };

  const renderNode = (node: GroupNode, depth: number): JSX.Element => {
    const children = childrenByParent.get(node.id) ?? [];
    const collapsible = children.length > 0;
    const open = isOpen(node);
    return (
      <div key={node.id}>
        <GroupRow
          node={node}
          depth={depth}
          selected={node.id === selectedGroupId}
          editing={editingId === node.id}
          collapsible={collapsible}
          open={open}
          onSelect={(n) => selectGroup(n.id)}
          onToggle={toggle}
          onStartRename={setEditingId}
          onCommitRename={commitRename}
          onDelete={onDelete}
          onDropKeys={(id, keys) => void groupEdit({ kind: 'setMembers', groupId: id, citeKeys: keys, add: true })}
          onDropRef={onDropRef}
          onEditSmart={setEditSmartId}
        />
        {collapsible && open && children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <nav className="bd-sidebar" aria-label="Groups">
      {hasDoc && (
        <div className="bd-sidebar__actions">
          <button type="button" className="bd-btn bd-btn--small" onClick={() => void newStatic()} title="New static group">
            ＋ Group
          </button>
          <button type="button" className="bd-btn bd-btn--small" onClick={() => setSmartOpen(true)} title="New smart group">
            ⚙ Smart
          </button>
          <button type="button" className="bd-btn bd-btn--small" onClick={() => void newFolder()} title="New folder">
            🗂 Folder
          </button>
        </div>
      )}
      {roots.map((node) => renderNode(node, 0))}
      {smartOpen && <SmartGroupDialog onClose={() => setSmartOpen(false)} />}
      {editSmartId && (
        <SmartGroupDialog editGroupId={editSmartId} onClose={() => setEditSmartId(undefined)} />
      )}
    </nav>
  );
}
