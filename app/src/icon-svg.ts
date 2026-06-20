/**
 * Framework-agnostic inline-SVG builder for FontAwesome icons — used where a
 * React `<Icon>` can't reach: the Handlebars panel templates rendered in MAIN
 * (`main/panel.ts`) and the DOM strings built during hydration
 * (`renderer/panel-hydrate.ts`).
 *
 * The markup mirrors what react-fontawesome emits (a viewBox'd path filled with
 * `currentColor`) and is sized by the `.bd-fa` rule in styles.css (1em, so it
 * tracks the surrounding text like the emoji glyphs it replaces did).
 */
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faPen, faFile, faLink, faPaperclip, faPlus, faMinus } from '@fortawesome/free-solid-svg-icons';

/** Build an inline `<svg>` string for a FontAwesome icon definition. */
export function iconSvg(def: IconDefinition): string {
  const [width, height, , , path] = def.icon;
  const d = Array.isArray(path) ? path.join('') : path;
  return (
    `<svg class="bd-fa" aria-hidden="true" focusable="false" role="img" ` +
    `xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
    `<path fill="currentColor" d="${d}"></path></svg>`
  );
}

/** Icon vocabulary available to panel templates via the `{{icon "…"}}` helper. */
const PANEL_ICONS: Record<string, IconDefinition> = {
  edit: faPen,
  file: faFile,
  link: faLink,
  paperclip: faPaperclip,
  // Used by the multi-select panel's batch-keyword buttons (mirrors the renderer
  // `plus` / `removeMinus` glyphs).
  plus: faPlus,
  removeMinus: faMinus,
};

/** Inline SVG for a named panel icon; empty string if the name is unknown. */
export function panelIconSvg(name: string): string {
  const def = PANEL_ICONS[name];
  return def ? iconSvg(def) : '';
}
