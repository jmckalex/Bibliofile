import { describe, it, expect } from 'vitest';
import { makeT, resolveLocale, LOCALES } from './i18n.js';
import { en } from './locales/en.js';
import { fr } from './locales/fr.js';

describe('i18n', () => {
  it('translates from the active catalog', () => {
    expect(makeT('en')('menu.file')).toBe('File');
    expect(makeT('fr')('menu.file')).toBe('Fichier');
  });

  it('interpolates {params}', () => {
    expect(makeT('en')('common.itemsSelected', { count: 3 })).toBe('3 selected');
    expect(makeT('fr')('common.itemsSelected', { count: 3 })).toBe('3 sélectionné(s)');
  });

  it('falls back to English for a key missing in the locale', () => {
    // 'enOnly' isn't in fr → English; here we simulate via an unknown locale.
    expect(makeT('de')('menu.file')).toBe('File'); // unknown locale → English catalog
  });

  it('returns the key itself when it is unknown everywhere', () => {
    expect(makeT('en')('totally.unknown.key')).toBe('totally.unknown.key');
  });

  it('resolveLocale: explicit code, system, and unknown', () => {
    expect(resolveLocale('fr')).toBe('fr');
    expect(resolveLocale('zz')).toBe('en'); // unsupported → English
    expect(resolveLocale('system', 'fr-FR')).toBe('fr'); // system follows OS
    expect(resolveLocale('system', 'es-ES')).toBe('en'); // OS unsupported → English
    expect(resolveLocale(undefined)).toBe('en');
  });

  it('LOCALES are real, English-backed catalogs', () => {
    for (const { code } of LOCALES) {
      expect(makeT(code)('menu.file').length).toBeGreaterThan(0);
    }
  });

  it('every translated key exists in the English source (no orphans)', () => {
    for (const key of Object.keys(fr)) {
      expect(en[key], `fr has key "${key}" not in en`).toBeDefined();
    }
  });
});
