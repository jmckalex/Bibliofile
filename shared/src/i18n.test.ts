import { describe, it, expect } from 'vitest';
import { makeT, resolveLocale, LOCALES, REGISTERED_LOCALES, getCatalog } from './i18n.js';
import { en } from './locales/en.js';

/** Placeholder tokens ({count}, {name}, …) present in a string, sorted. */
const placeholders = (s: string): string => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

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

  it('uses the seeded catalog, and falls back to English for an unknown locale', () => {
    expect(makeT('zh-Hans')('menu.file')).toBe('文件'); // seeded catalog
    expect(makeT('xx')('menu.file')).toBe('File'); // no catalog → English
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

  it('all 30 offered locales are registered with a catalog', () => {
    for (const { code } of LOCALES) {
      expect(REGISTERED_LOCALES, `${code} not registered`).toContain(code);
    }
  });

  it('every catalog: no orphan keys + placeholder parity with English', () => {
    for (const code of REGISTERED_LOCALES) {
      const cat = getCatalog(code)!;
      for (const [key, value] of Object.entries(cat)) {
        expect(en[key], `${code} has key "${key}" not in en`).toBeDefined();
        // A translated string must carry the same {placeholders} as its source,
        // or interpolation silently drops data at runtime.
        if (en[key] !== undefined) {
          expect(placeholders(value), `${code} "${key}" placeholder drift`).toBe(
            placeholders(en[key]),
          );
        }
      }
    }
  });
});
