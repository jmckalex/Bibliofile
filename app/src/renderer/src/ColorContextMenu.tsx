/**
 * A Finder-style color-label picker shown on right-click in the publications
 * table: a horizontal row of label-color dots plus a "clear" (✕). Picking a dot
 * applies that color to the current selection; ✕ removes it. Dismissed by
 * Escape or any click outside.
 */
import { useEffect } from 'react';
import { LABEL_COLORS } from '@bibdesk/model';
import { useT } from './i18n.js';

export function ColorContextMenu({
  x,
  y,
  current,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  /** Hex of the right-clicked row's current color, to mark the active dot. */
  current?: string;
  /** 1-based palette index, or null to clear. */
  onPick: (colorIndex: number | null) => void;
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
        ✕
      </button>
    </div>
  );
}
