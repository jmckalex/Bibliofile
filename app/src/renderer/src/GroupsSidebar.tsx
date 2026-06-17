/**
 * Groups sidebar — renders the flat GroupNode[] as a 2-level tree (joined via
 * parentId). Clicking a group selects it and filters the table. Static & smart
 * groups are editable: create (header buttons), rename (double-click), delete
 * (× on hover), and — for static groups — add members by dropping publication
 * rows onto them.
 */

import { useMemo, useState, type DragEvent } from 'react';
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
};

const EDITABLE = (k: GroupKind): boolean => k === 'static' || k === 'smart';

interface TreeNode {
  node: GroupNode;
  children: GroupNode[];
}

/** Build a 2-level tree: roots (no parentId) with their direct children. */
function buildTree(groups: readonly GroupNode[]): TreeNode[] {
  const childrenByParent = new Map<string, GroupNode[]>();
  for (const g of groups) {
    if (g.parentId) {
      const list = childrenByParent.get(g.parentId);
      if (list) list.push(g);
      else childrenByParent.set(g.parentId, [g]);
    }
  }
  return groups
    .filter((g) => !g.parentId)
    .map((node) => ({ node, children: childrenByParent.get(node.id) ?? [] }));
}

function GroupRow({
  group,
  child,
  selected,
  editing,
  onSelect,
  onStartRename,
  onCommitRename,
  onDelete,
  onDropKeys,
}: {
  group: GroupNode;
  child: boolean;
  selected: boolean;
  editing: boolean;
  onSelect: (id: string) => void;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDropKeys: (id: string, keys: string[]) => void;
}) {
  const [dropping, setDropping] = useState(false);
  const editable = EDITABLE(group.kind);

  return (
    <div
      className={
        'bd-group' +
        (child ? ' bd-group--child' : '') +
        (selected ? ' bd-group--selected' : '') +
        (dropping ? ' bd-group--drop' : '')
      }
      aria-current={selected ? 'true' : undefined}
      onClick={() => !editing && onSelect(group.id)}
      onDoubleClick={() => editable && onStartRename(group.id)}
      title={group.name}
      {...(group.kind === 'static'
        ? {
            onDragOver: (e: DragEvent) => {
              if (e.dataTransfer.types.includes('application/x-bibdesk-citekeys')) {
                e.preventDefault();
                setDropping(true);
              }
            },
            onDragLeave: () => setDropping(false),
            onDrop: (e: DragEvent) => {
              e.preventDefault();
              setDropping(false);
              const raw = e.dataTransfer.getData('application/x-bibdesk-citekeys');
              const keys = raw.split(',').map((k) => k.trim()).filter(Boolean);
              if (keys.length) onDropKeys(group.id, keys);
            },
          }
        : {})}
    >
      <span className="bd-group__icon" aria-hidden="true">
        {KIND_ICON[group.kind]}
      </span>
      {editing ? (
        <input
          className="bd-group__rename"
          autoFocus
          defaultValue={group.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => onCommitRename(group.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') onCommitRename(group.id, group.name);
          }}
        />
      ) : (
        <span className="bd-group__name">{group.name}</span>
      )}
      <span className="bd-group__count">{group.count}</span>
      {editable && !editing && (
        <button
          type="button"
          className="bd-group__del"
          title={`Delete “${group.name}”`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(group.id);
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
  const hasDoc = useStore((s) => s.documentId !== undefined);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [smartOpen, setSmartOpen] = useState(false);

  const tree = useMemo(() => buildTree(groups), [groups]);

  const newStatic = async (): Promise<void> => {
    const id = await groupEdit({ kind: 'createStatic', name: 'New Group' });
    if (id) setEditingId(id);
  };
  const commitRename = (id: string, name: string): void => {
    setEditingId(undefined);
    const trimmed = name.trim();
    const current = groups.find((g) => g.id === id)?.name;
    if (trimmed && trimmed !== current) void groupEdit({ kind: 'rename', groupId: id, name: trimmed });
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
        </div>
      )}
      {tree.map(({ node, children }) => (
        <div key={node.id}>
          <GroupRow
            group={node}
            child={false}
            selected={node.id === selectedGroupId}
            editing={editingId === node.id}
            onSelect={selectGroup}
            onStartRename={setEditingId}
            onCommitRename={commitRename}
            onDelete={(id) => void groupEdit({ kind: 'delete', groupId: id })}
            onDropKeys={(id, keys) => void groupEdit({ kind: 'setMembers', groupId: id, citeKeys: keys, add: true })}
          />
          {children.map((c) => (
            <GroupRow
              key={c.id}
              group={c}
              child
              selected={c.id === selectedGroupId}
              editing={editingId === c.id}
              onSelect={selectGroup}
              onStartRename={setEditingId}
              onCommitRename={commitRename}
              onDelete={(id) => void groupEdit({ kind: 'delete', groupId: id })}
              onDropKeys={(id, keys) => void groupEdit({ kind: 'setMembers', groupId: id, citeKeys: keys, add: true })}
            />
          ))}
        </div>
      ))}
      {smartOpen && <SmartGroupDialog onClose={() => setSmartOpen(false)} />}
    </nav>
  );
}
