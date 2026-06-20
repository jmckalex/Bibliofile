/**
 * Bottom-panel LaTeX preview.
 *
 * Part A (this version): a placeholder shell so the bottom pane can switch to it.
 * Part B wires the tex-preview engine — DVI→SVG for a small selection, PDF+PDF.js
 * for the whole library — and renders the artifact here.
 */
import { useT } from './i18n.js';

export function TexPreviewPane() {
  const t = useT();
  return (
    <div className="bd-bottompanel__body">
      <p className="bd-bottompanel__hint">{t('panel.texPreviewHint')}</p>
    </div>
  );
}
