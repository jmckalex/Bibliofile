/**
 * English catalog — the source of truth. Every UI string the app shows should
 * have a key here; other locales (e.g. `fr.ts`) override a subset and fall back
 * to these. Keys are dotted namespaces (menu.*, prefs.*, toolbar.*, …).
 *
 * Coverage is being filled in incrementally; the menu bar + File menu and a few
 * renderer surfaces are done first to prove the pipeline.
 */
import type { Catalog } from '../i18n.js';

export const en: Catalog = {
  // --- Application menu: top-level bar ---
  'menu.file': 'File',
  'menu.edit': 'Edit',
  'menu.view': 'View',
  'menu.publication': 'Publication',
  'menu.tools': 'Tools',
  'menu.window': 'Window',
  'menu.help': 'Help',

  // --- File menu ---
  'menu.file.newPublication': 'New Publication',
  'menu.file.open': 'Open…',
  'menu.file.save': 'Save',
  'menu.file.saveAs': 'Save As…',
  'menu.file.revert': 'Revert to Saved',
  'menu.file.showInFinder': 'Show in Finder',
  'menu.file.showInFileManager': 'Show in File Manager',
  'menu.file.import': 'Import',
  'menu.file.importFile': 'From File (BibTeX / RIS / EndNote)…',
  'menu.file.searchOnline': 'Search Online (CrossRef / arXiv)…',
  'menu.file.export': 'Export',
  'menu.file.exportBibtex': 'BibTeX…',
  'menu.file.exportRis': 'RIS…',
  'menu.file.exportCsv': 'CSV…',
  'menu.file.exportHtml': 'HTML…',
  'menu.file.exportRtf': 'RTF (formatted bibliography)…',
  'menu.file.exportSelected': 'Selected Entries (BibTeX)…',
  'menu.file.selectFromAux': 'Select Publications from .aux File…',
  'menu.file.print': 'Print…',

  // --- Preferences: language ---
  'prefs.language': 'Language',
  'prefs.language.system': 'System default',
  'prefs.language.hint': 'Changes apply immediately. Untranslated text falls back to English.',

  // --- Toolbar (renderer) ---
  'toolbar.new': '＋ New',
  'toolbar.duplicate': '⧉ Duplicate',
  'toolbar.delete': '🗑 Delete',
  'toolbar.online': '🌐 Online…',
  'toolbar.macros': '@string…',

  // --- Common (with interpolation) ---
  'common.itemsSelected': '{count} selected',

  // --- Empty / welcome states (renderer) ---
  'detail.empty.select': 'Select a publication to see its details.',
  'detail.loading': 'Loading…',
  'welcome.dropHint': 'Drop a .bib file to open',
};
