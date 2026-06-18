/**
 * French catalog (seed). A partial override of {@link en}; any key not present
 * here falls back to English. Demonstrates the pipeline + graceful fallback.
 */
import type { Catalog } from '../i18n.js';

export const fr: Catalog = {
  // Menu bar
  'menu.file': 'Fichier',
  'menu.edit': 'Édition',
  'menu.view': 'Présentation',
  'menu.publication': 'Publication',
  'menu.tools': 'Outils',
  'menu.window': 'Fenêtre',
  'menu.help': 'Aide',

  // File menu
  'menu.file.newPublication': 'Nouvelle publication',
  'menu.file.open': 'Ouvrir…',
  'menu.file.save': 'Enregistrer',
  'menu.file.saveAs': 'Enregistrer sous…',
  'menu.file.revert': 'Revenir à la version enregistrée',
  'menu.file.showInFinder': 'Afficher dans le Finder',
  'menu.file.showInFileManager': 'Afficher dans le gestionnaire de fichiers',
  'menu.file.import': 'Importer',
  'menu.file.importFile': 'Depuis un fichier (BibTeX / RIS / EndNote)…',
  'menu.file.searchOnline': 'Rechercher en ligne (CrossRef / arXiv)…',
  'menu.file.export': 'Exporter',
  'menu.file.exportBibtex': 'BibTeX…',
  'menu.file.exportRis': 'RIS…',
  'menu.file.exportCsv': 'CSV…',
  'menu.file.exportHtml': 'HTML…',
  'menu.file.exportRtf': 'RTF (bibliographie formatée)…',
  'menu.file.exportSelected': 'Entrées sélectionnées (BibTeX)…',
  'menu.file.selectFromAux': 'Sélectionner les publications depuis un fichier .aux…',
  'menu.file.print': 'Imprimer…',

  // Preferences: language
  'prefs.language': 'Langue',
  'prefs.language.system': 'Réglage du système',
  'prefs.language.hint':
    "Les changements s'appliquent immédiatement. Le texte non traduit revient à l'anglais.",

  // Toolbar
  'toolbar.new': '＋ Nouveau',
  'toolbar.duplicate': '⧉ Dupliquer',
  'toolbar.delete': '🗑 Supprimer',
  'toolbar.online': '🌐 En ligne…',
  'toolbar.macros': '@string…',

  // Common (with interpolation)
  'common.itemsSelected': '{count} sélectionné(s)',

  // Empty / welcome states
  'detail.empty.select': 'Sélectionnez une publication pour afficher ses détails.',
  'detail.loading': 'Chargement…',
  'welcome.dropHint': "Déposez un fichier .bib pour l'ouvrir",
};
