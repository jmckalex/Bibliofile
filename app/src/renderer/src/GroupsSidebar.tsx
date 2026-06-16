/**
 * Groups sidebar — renders the flat GroupNode[] as a 2-level tree (joined via
 * parentId). Clicking a group selects it and filters the publications table.
 */

import { useMemo } from 'react';
import type { GroupKind, GroupNode } from '@bibdesk/shared';
import { useStore } from './store.js';

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
  onSelect,
}: {
  group: GroupNode;
  child: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={
        'bd-group' +
        (child ? ' bd-group--child' : '') +
        (selected ? ' bd-group--selected' : '')
      }
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(group.id)}
      title={group.name}
    >
      <span className="bd-group__icon" aria-hidden="true">
        {KIND_ICON[group.kind]}
      </span>
      <span className="bd-group__name">{group.name}</span>
      <span className="bd-group__count">{group.count}</span>
    </button>
  );
}

export function GroupsSidebar() {
  const groups = useStore((s) => s.groups);
  const selectedGroupId = useStore((s) => s.selectedGroupId);
  const selectGroup = useStore((s) => s.selectGroup);

  const tree = useMemo(() => buildTree(groups), [groups]);

  return (
    <nav className="bd-sidebar" aria-label="Groups">
      {tree.map(({ node, children }) => (
        <div key={node.id}>
          <GroupRow
            group={node}
            child={false}
            selected={node.id === selectedGroupId}
            onSelect={selectGroup}
          />
          {children.map((c) => (
            <GroupRow
              key={c.id}
              group={c}
              child
              selected={c.id === selectedGroupId}
              onSelect={selectGroup}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}
