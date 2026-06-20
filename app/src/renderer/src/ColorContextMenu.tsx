/**
 * A Finder-style row context menu shown on right-click in the publications
 * table: a horizontal row of label-color dots plus a "clear" (✕), and a Delete
 * item that removes the selection. Picking a dot applies that color to the
 * current selection; ✕ removes it. Dismissed by Escape or any click outside.
 */
import { useEffect } from 'react';
import { LABEL_COLORS } from '@bibdesk/model';
import { useT } from './i18n.js';
import { Icon } from './icons.js';

export function ColorContextMenu({
  x,
  y,
  current,
  count,
  onPick,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  /** Hex of the right-clicked row's current color, to mark the active dot. */
  current?: string;
  /** How many rows the menu acts on (drives the Delete label). */
  count: number;
  /** 1-based palette index, or null to clear. */
  onPick: (colorIndex: number | null) => void;
  /** Delete the current selection. */
  onDelete: () => void;
  onClose: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (): void => onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return (
    <div
      className="bd-colormenu"
      style={{ left: x, top: y }}
      role="menu"
      // Keep clicks inside from bubbling to the window dismiss handler.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bd-colormenu__colors">
        {LABEL_COLORS.map((c, i) => (
          <button
            key={c.name}
            type="button"
            className={'bd-colordot' + (current === c.hex ? ' bd-colordot--on' : '')}
            style={{ background: c.hex }}
            title={c.name}
            aria-label={c.name}
            aria-pressed={current === c.hex}
            onClick={() => {
              onPick(i + 1);
              onClose();
            }}
          />
        ))}
        <button
          type="button"
          className="bd-colordot bd-colordot--none"
          title={t('color.none')}
          aria-label={t('color.none')}
          onClick={() => {
            onPick(null);
            onClose();
          }}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="bd-colormenu__sep" />
      <button
        type="button"
        role="menuitem"
        className="bd-colormenu__item bd-colormenu__item--danger"
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        <Icon name="trash" />
        {count > 1 ? t('context.deleteEntries', { count }) : t('context.delete')}
      </button>
    </div>
  );
}
