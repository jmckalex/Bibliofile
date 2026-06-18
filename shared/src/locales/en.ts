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

  // --- Publications table (tooltips / empty state) ---
  'table.hasKeywords': 'Has keywords',
  'table.attachmentTooltip': '{count} attachment',
  'table.attachmentTooltipPlural': '{count} attachments',
  'table.unread': 'Unread',
  'table.sortHint': 'Click to sort · Shift-click to add a secondary sort · drag to reorder',
  'table.resizeColumn': 'Resize column',
  'table.empty': 'No publications',

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

  // --- Header / footer / search / theme ---
  'header.saving': 'Saving…',
  'header.unsaved': 'Unsaved changes — press ⌘S to save',
  'header.savingInline': ' (saving…)',
  'header.publication': '{count} publication',
  'header.publications': '{count} publications',
  'header.parseWarning': '⚠ {count} parse warning',
  'header.parseWarnings': '⚠ {count} parse warnings',
  'footer.row': '{count} row',
  'footer.rows': '{count} rows',
  'footer.rowsOf': '{filtered} of {total} rows',
  'footer.error': 'Error: {error}',
  'common.loading': 'Loading…',
  'theme.switchLight': 'Switch to light theme',
  'theme.switchDark': 'Switch to dark theme',
  'theme.toggle': 'Toggle colour theme',
  'search.pdfToggle': 'Search PDF contents (full-text)',
  'search.pdfOn': 'Full-text search ON — also matching PDF contents. Click to search fields only.',
  'search.pdfOff': 'Full-text search OFF — matching fields only. Click to also search PDF contents.',
  'search.placeholder': 'Filter publications…',
  'search.placeholderFull': 'Search (incl. PDF text)…',
  'search.filter': 'Filter publications',

  // --- Welcome ---
  'welcome.tagline': 'A bibliography manager for BibTeX libraries.',
  'welcome.open': 'Open a Bibliography…',
  'welcome.new': 'New Bibliography',
  'welcome.hint': 'or drag a .bib file onto the window (⌘O also opens one).',

  // --- Batch bar ---
  'batch.actions': 'Batch actions',
  'batch.field': 'Field',
  'batch.value': 'value',
  'batch.keyword': 'Keyword',
  'batch.set': 'Set',
  'batch.addKeyword': '+ Keyword',
  'batch.removeKeyword': '− Keyword',
  'batch.delete': '🗑 Delete {count}',

  // --- Find Duplicates ---
  'dup.ariaLabel': 'Find duplicates',
  'dup.title': 'Find Duplicates',
  'dup.summary': '— {groups} groups, {total} entries',
  'dup.scanning': 'Scanning…',
  'dup.none': 'No duplicates found. 🎉',
  'dup.identicalKey': 'Identical cite key',
  'dup.equivalent': 'Equivalent content',
  'dup.entriesCount': '{count} entries',
  'dup.merge': 'Merge',
  'dup.mergeTitle': 'Merge into the first entry (fills missing fields, unions keywords + attachments, deletes the rest)',

  // --- Common (shared) ---
  'common.close': 'Close',
  'common.untitled': '(untitled)',

  // --- Panels / detail view ---
  'panel.details': 'Details',
  'panel.claude': '🤖 Claude',
  'panel.hide': 'Hide panel',
  'panel.annotation': 'Annotation',
  'panel.hideBottom': 'Hide bottom panel',
  'panel.selectAnnotation': 'Select a publication to read its annotation.',
  'view.fields': 'Fields',
  'view.inherited': '(inherited)',
  'view.editTitle': 'Edit this publication in a separate window',

  // --- Detail / edit pane ---
  'detail.starCount': '{count} star',
  'detail.starCountPlural': '{count} stars',
  'detail.removeField': 'Remove {name}',
  'detail.requiredTitle': 'Required for this entry type',
  'detail.req': 'req',
  'detail.fieldNamePlaceholder': 'Field name',
  'detail.valuePlaceholder': 'value',
  'detail.discardField': 'Discard this field',
  'detail.citation': 'Citation',
  'detail.citationStyleTitle': 'Set the citation style in Preferences',
  'detail.done': 'Done',
  'detail.edit': 'Edit',
  'detail.notesPlaceholder':
    'Markdown notes. Link entries with [[citeKey]]. Inline <iframe> embeds allowed.',
  'detail.noAnnotation': 'No annotation.',
  'detail.noAnnotationHint': 'No annotation. Click Edit to add markdown notes.',
  'detail.generateTitle': 'Generate cite key from author + year',
  'detail.generate': 'Generate',
  'detail.addField': 'Add a field',
  'detail.openFile': 'Open {name}',
  'detail.removeAttachment': 'Remove attachment',
  'detail.attachTitle': 'Attach file(s)',
  'detail.add': '＋ Add',
  'detail.noAttachments': 'No attachments.',
  'detail.links': 'Links',
  'detail.journalCover': '{name} cover',
  'detail.journalCoverGeneric': 'journal cover',
  'detail.emptyEdit': 'Select a publication to see and edit its details.',

  // --- Online search ---
  'online.ariaLabel': 'Online search',
  'online.title': 'Online search',
  'online.placeholder': 'Search title, author, DOI…',
  'online.searching': 'Searching…',
  'online.search': 'Search',
  'online.prompt': 'Enter a query and press Search.',
  'online.imported': 'Imported',
  'online.import': 'Import',

  // --- @string macros ---
  'macro.ariaLabel': 'String macros',
  'macro.title': '@string macros',
  'macro.none': 'No macros defined yet.',
  'macro.remove': 'Remove {name}',
  'macro.namePlaceholder': 'name',
  'macro.valuePlaceholder': 'value',
  'macro.add': 'Add macro',

  // --- Groups sidebar ---
  'sidebar.groups': 'Groups',
  'sidebar.collapse': 'Collapse',
  'sidebar.expand': 'Expand',
  'sidebar.group': '＋ Group',
  'sidebar.smart': '⚙ Smart',
  'sidebar.folder': '🗂 Folder',
  'sidebar.newStaticGroup': 'New static group',
  'sidebar.newSmartGroup': 'New smart group',
  'sidebar.newFolder': 'New folder',
  'sidebar.rename': 'Rename',
  'sidebar.delete': 'Delete',
  'sidebar.newGroupName': 'New Group',
  'sidebar.newFolderName': 'New Folder',
  'sidebar.editConditions': 'Edit conditions for “{name}”',
  'sidebar.exportFolder': 'Export “{name}” to a PDF folder tree',
  'sidebar.deleteGroup': 'Delete “{name}”',

  // --- Common buttons / labels (shared across dialogs) ---
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.create': 'Create',
  'common.remove': 'Remove',
  'common.name': 'Name',
  'common.scanning': 'Scanning…',

  // --- Color context menu ---
  'color.none': 'No color',

  // --- Editor window ---
  'editor.docTitle': 'Edit · {key} — BibDesk',
  'editor.docTitleEmpty': 'Edit Publication — BibDesk',
  'editor.editing': 'Editing',

  // --- Broken links ---
  'broken.ariaLabel': 'Find broken links',
  'broken.title': 'Broken Links',
  'broken.summary': '— {count} missing file',
  'broken.summaryPlural': '— {count} missing files',
  'broken.none': 'No broken links — every attachment resolves. 🎉',
  'broken.selectEntry': 'Select this entry in the list',
  'broken.locateTitle': 'Pick a replacement file for this attachment',
  'broken.locate': 'Locate…',
  'broken.removeTitle': 'Remove this attachment from the entry',
  'broken.fieldLinkTitle': 'Edit the field on the entry to fix this link',
  'broken.fieldLink': 'field link',

  // --- Claude Assistant ---
  'assistant.aria': 'Claude Assistant',
  'assistant.titleBar': '🤖 Claude Assistant',
  'assistant.newChatTitle': 'New conversation',
  'assistant.newChat': 'New chat',
  'assistant.connectKey':
    'Connect your Anthropic API key to use the assistant. It is stored encrypted on this device{suffix}.',
  'assistant.encryptionUnavailable':
    ' — but OS encryption is unavailable, so it cannot be saved here',
  'assistant.saveKey': 'Save key',
  'assistant.hint':
    'Ask me to find duplicates, tidy fields, generate cite keys, summarize the library, or export a subset. I’ll ask before changing anything.',
  'assistant.thinking': 'Thinking…',
  'assistant.composePlaceholder': 'Message the assistant…',
  'assistant.send': 'Send',
  'assistant.noReply': '(no reply)',

  // --- Smart group dialog ---
  'smart.editTitle': 'Edit Smart Group',
  'smart.newTitle': 'New Smart Group',
  'smart.defaultName': 'Smart Group',
  'smart.match': 'Match',
  'smart.matchAll': 'all of the following (AND)',
  'smart.matchAny': 'any of the following (OR)',
  'smart.valuePlaceholder': 'value',
  'smart.removeCondition': 'Remove condition',
  'smart.addCondition': '＋ Condition',
  'smart.cmp.contains': 'contains',
  'smart.cmp.notContains': 'does not contain',
  'smart.cmp.is': 'is',
  'smart.cmp.isNot': 'is not',
  'smart.cmp.startsWith': 'starts with',
  'smart.cmp.endsWith': 'ends with',

  // --- Find & Replace ---
  'fr.aria': 'Find and replace',
  'fr.title': 'Find & Replace',
  'fr.inGroup': ' — in {name}',
  'fr.field': 'Field',
  'fr.allFields': 'All fields',
  'fr.find': 'Find',
  'fr.replace': 'Replace',
  'fr.regex': 'Regular expression',
  'fr.caseSensitive': 'Case sensitive',
  'fr.invalidPattern': 'Invalid pattern: {error}',
  'fr.replaced': 'Replaced',
  'fr.occurrence': 'occurrence',
  'fr.occurrences': 'occurrences',
  'fr.inWord': 'in',
  'fr.fieldWord': 'field',
  'fr.fieldsWord': 'fields',
  'fr.andMore': '… and {count} more',
  'fr.replaceAll': 'Replace All',

  // --- Empty / welcome states (renderer) ---
  'detail.empty.select': 'Select a publication to see its details.',
  'detail.loading': 'Loading…',
  'welcome.dropHint': 'Drop a .bib file to open',
};
