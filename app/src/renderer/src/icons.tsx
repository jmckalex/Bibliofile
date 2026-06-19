/**
 * Central FontAwesome icon registry + a thin <Icon> wrapper.
 *
 * Every icon used in the renderer is named here once, so the vocabulary is
 * discoverable in a single place and call sites stay free of deep `@fortawesome`
 * import paths. Use `<Icon name="close" />` in JSX and forward `className` /
 * `style` / `aria-label` / `title` exactly as FontAwesomeIcon accepts them.
 *
 * Sizing follows the surrounding `font-size` (FontAwesome SVGs are 1em wide) and
 * colour follows `currentColor`, so the existing `.bd-icon*` / `.bd-group__*`
 * CSS continues to drive appearance — we only swapped the glyph source from
 * Unicode/emoji to vector icons.
 */
import { FontAwesomeIcon, type FontAwesomeIconProps } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faSun,
  faMoon,
  faFilePdf,
  faXmark,
  faBook,
  faFolder,
  faGear,
  faTags,
  faUser,
  faLink,
  faScroll,
  faFolderOpen,
  faChevronDown,
  faChevronRight,
  faPen,
  faFileExport,
  faMinus,
  faPlus,
  faClone,
  faTrash,
  faGlobe,
  faTriangleExclamation,
  faCaretUp,
  faCaretDown,
  faKey,
  faPaperclip,
  faSquareCheck,
  faStar as faStarSolid,
  faFile,
  faSliders,
  faTableColumns,
  faQuoteRight,
  faFileCode,
  faWindowMaximize,
  faRobot,
} from '@fortawesome/free-solid-svg-icons';
import { faSquare, faStar as faStarRegular } from '@fortawesome/free-regular-svg-icons';

/**
 * Named icon vocabulary. Several semantic names intentionally map to the same
 * glyph (e.g. `folder` and `prefFiles` are both an open folder) — the name
 * documents intent at the call site.
 */
export const ICONS = {
  // App chrome
  themeLight: faSun,
  themeDark: faMoon,
  pdf: faFilePdf,
  close: faXmark,

  // Group-kind glyphs (GroupsSidebar)
  library: faBook,
  staticGroup: faFolder,
  smartGroup: faGear,
  categoryGroup: faTags,
  authorGroup: faUser,
  urlGroup: faLink,
  scriptGroup: faScroll,
  folder: faFolderOpen,

  // Tree disclosure
  chevronDown: faChevronDown,
  chevronRight: faChevronRight,

  // Inline actions
  edit: faPen,
  exportFolder: faFileExport,
  removeMinus: faMinus,
  plus: faPlus,
  duplicate: faClone,
  trash: faTrash,
  online: faGlobe,
  warning: faTriangleExclamation,
  assistant: faRobot,
  sortAsc: faCaretUp,
  sortDesc: faCaretDown,

  // Table / detail indicators
  keywords: faKey,
  attachment: faPaperclip,
  read: faSquareCheck,
  unread: faSquare,
  starOn: faStarSolid,
  starOff: faStarRegular,
  file: faFile,
  link: faLink,

  // Preferences section nav (left sidebar)
  prefGeneral: faSliders,
  prefDisplay: faTableColumns,
  prefCitation: faQuoteRight,
  prefCiteKeys: faKey,
  prefFiles: faFolderOpen,
  prefFields: faTags,
  prefTemplates: faFileCode,
  prefPanels: faWindowMaximize,
  prefAssistant: faRobot,
} satisfies Record<string, IconDefinition>;

export type IconName = keyof typeof ICONS;

/** Render a registered icon by name. All other FontAwesomeIcon props pass through. */
export function Icon({ name, ...rest }: { name: IconName } & Omit<FontAwesomeIconProps, 'icon'>) {
  return <FontAwesomeIcon icon={ICONS[name]} {...rest} />;
}
