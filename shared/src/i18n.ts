/**
 * Lightweight, dependency-free i18n for the whole app (main + renderer).
 *
 * English ({@link en}) is the source-of-truth catalog; other locales provide
 * partial overrides and fall back to English per-key, so a half-translated
 * locale degrades gracefully. A `t(key, params?)` interpolates `{name}`
 * placeholders. The current locale lives in `Settings.locale` ('system' or a
 * code); main and renderer each bind a `t` to it (see `app/src/main/i18n.ts`
 * and `app/src/renderer/src/i18n.ts`).
 */
import { en } from './locales/en.js';
import { fr } from './locales/fr.js';

/** A message catalog: message key → translated string. */
export type Catalog = Record<string, string>;

/** A bound translate function. */
export type TFunction = (key: string, params?: Record<string, string | number>) => string;

/** Available UI locales (code + native display name), for the picker. */
export const LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
] as const;

export type LocaleCode = (typeof LOCALES)[number]['code'];

const CATALOGS: Record<string, Catalog> = { en, fr };

/** Resolve a settings value (`'system'` or a code) to a concrete available locale. */
export function resolveLocale(setting: string | undefined, systemLocale?: string): LocaleCode {
  if (setting && setting !== 'system' && setting in CATALOGS) return setting as LocaleCode;
  const base = (systemLocale ?? 'en').slice(0, 2).toLowerCase();
  return (base in CATALOGS ? base : 'en') as LocaleCode;
}

/** Build a translate function bound to a concrete locale (English-fallback). */
export function makeT(locale: string): TFunction {
  const cat = CATALOGS[locale] ?? en;
  return (key, params) => {
    const s = cat[key] ?? en[key] ?? key;
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, (_m, k: string) =>
      params[k] !== undefined ? String(params[k]) : `{${k}}`,
    );
  };
}
