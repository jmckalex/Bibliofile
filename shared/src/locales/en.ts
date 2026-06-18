/**
 * English catalog — the source of truth. Every UI string the app shows should
 * have a key here; other locales override a subset and fall back to these. Keys
 * are dotted namespaces (menu.*, prefs.*, column.*, toolbar.*, …).
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
  'menu.about': 'About BibDesk',
  'menu.preferences': 'Preferences…',

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
  'menu.export.scope.library': 'Whole Library…',
  'menu.export.scope.shown': 'Shown Entries…',
  'menu.export.scope.selected': 'Selected Entries…',

  // --- Edit menu ---
  'menu.edit.selectIncomplete': 'Select Incomplete Publications',
  'menu.edit.pastePublication': 'Paste Publication',
  'menu.edit.find': 'Find…',
  'menu.edit.findReplace': 'Find & Replace…',
  'menu.edit.copyCiteKey': 'Copy Cite Key',
  'menu.edit.copyCitation': 'Copy Citation',
  'menu.edit.copyRtf': 'Copy Citation as RTF',
  'menu.edit.copyBibtex': 'Copy as BibTeX',
  'menu.edit.copyCite': 'Copy \\cite{…}',
  'menu.edit.copyAs': 'Copy As',
  'menu.edit.copyAs.ris': 'RIS',
  'menu.edit.copyAs.minimalBibtex': 'Minimal BibTeX',
  'menu.edit.copyAs.bibitem': 'LaTeX \\bibitem',

  // --- Publication menu ---
  'menu.publication.new': 'New Publication',
  'menu.publication.newCrossref': 'New Publication with Crossref',
  'menu.publication.edit': 'Edit Publication…',
  'menu.publication.duplicate': 'Duplicate',
  'menu.publication.delete': 'Delete Publication',
  'menu.publication.generateCiteKey': 'Generate Cite Key',
  'menu.publication.selectParent': 'Select Crossref Parent',
  'menu.publication.colorLabel': 'Color Label',
  'menu.publication.colorNone': 'None',
  'menu.publication.findDuplicates': 'Find Duplicates…',
  'menu.publication.addAttachment': 'Add File Attachment…',
  'menu.publication.autoFile': 'AutoFile Linked Files',
  'menu.publication.consolidate': 'Consolidate Linked Files…',
  'menu.publication.findBrokenLinks': 'Find Broken Links…',
  'menu.publication.macros': 'Macros (@string)…',

  // --- Tools / View / Help menus ---
  'menu.tools.assistant': 'Claude Assistant…',
  'menu.view.toggleSide': 'Toggle Side Panel',
  'menu.view.toggleBottom': 'Toggle Bottom Panel',
  'menu.view.columns': 'Columns',
  'menu.view.toggleTheme': 'Toggle Light / Dark Theme',
  'menu.help.bibdesk': 'BibDesk Help',

  // --- Table columns (translatable builtin names) ---
  'column.citeKey': 'Cite Key',
  'column.type': 'Type',
  'column.authors': 'Authors',
  'column.title': 'Title',
  'column.year': 'Year',
  'column.keywords': 'Keywords',
  'column.attachments': 'Attachments',
  'column.read': 'Read',
  'column.rating': 'Rating',

  // --- Preferences: language ---
  'prefs.language': 'Language',
  'prefs.language.system': 'System default',
  'prefs.language.hint': 'Changes apply immediately. Untranslated text falls back to English.',

  // --- Toolbar ---
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
