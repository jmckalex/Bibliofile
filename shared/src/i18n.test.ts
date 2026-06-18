import { describe, it, expect } from 'vitest';
import { makeT, resolveLocale, LOCALES } from './i18n.js';
import { en } from './locales/en.js';
import { fr } from './locales/fr.js';
import { es } from './locales/es.js';
import { de } from './locales/de.js';
import { it as itCat } from './locales/it.js';
import { pt } from './locales/pt.js';
import { nl } from './locales/nl.js';

const TRANSLATED = { fr, es, de, it: itCat, pt, nl };

describe('i18n', () => {
  it('translates from the active catalog', () => {
    expect(makeT('en')('menu.file')).toBe('File');
    expect(makeT('fr')('menu.file')).toBe('Fichier');
    expect(makeT('de')('menu.file')).toBe('Datei');
    expect(makeT('es')('menu.file')).toBe('Archivo');
  });

  it('interpolates {params}', () => {
    expect(makeT('en')('common.itemsSelected', { count: 3 })).toBe('3 selected');
    expect(makeT('de')('common.itemsSelected', { count: 3 })).toBe('3 ausgewählt');
  });

  it('falls back to English for an offered-but-untranslated locale', () => {
    expect(makeT('zh-Hans')('menu.file')).toBe('File'); // offered, no catalog yet
  });

  it('falls back to English per-key for partial catalogs (technical keys)', () => {
    // exportRis is intentionally omitted from non-English catalogs.
    expect(makeT('fr')('menu.file.exportRis')).toBe('RIS…');
  });

  it('returns the key itself when it is unknown everywhere', () => {
    expect(makeT('en')('totally.unknown.key')).toBe('totally.unknown.key');
  });

  it('resolveLocale: explicit, system (incl. region/script), and unknown', () => {
    expect(resolveLocale('fr')).toBe('fr');
    expect(resolveLocale('zz')).toBe('en'); // not offered → English
    expect(resolveLocale('system', 'fr-FR')).toBe('fr'); // region → base code
    expect(resolveLocale('system', 'zh-Hans')).toBe('zh-Hans'); // exact offered code
    expect(resolveLocale('system', 'xx-YY')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
  });

  it('offers ~30 locales, all selectable (English fallback if untranslated)', () => {
    expect(LOCALES.length).toBeGreaterThanOrEqual(28);
    for (const { code } of LOCALES) {
      expect(makeT(code)('menu.file').length).toBeGreaterThan(0);
    }
  });

  it('every translated key exists in the English source (no orphans)', () => {
    for (const [code, cat] of Object.entries(TRANSLATED)) {
      for (const key of Object.keys(cat)) {
        expect(en[key], `${code} has key "${key}" not in en`).toBeDefined();
      }
    }
  });
});
