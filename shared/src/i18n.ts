/**
 * Lightweight, dependency-free i18n for the whole app (main + renderer).
 *
 * English ({@link en}) is the source-of-truth catalog; other locales provide
 * (possibly partial) overrides and fall back to English per-key. `t(key,
 * params?)` interpolates `{name}` placeholders. The current locale lives in
 * `Settings.locale` ('system' or a code).
 *
 * {@link LOCALES} is the list OFFERED in the picker (the top languages); a locale
 * with no catalog yet simply renders English until its `locales/<code>.ts` is
 * filled in — so adding/seeding a language is dropping a file, with no risk of a
 * broken UI in the meantime.
 */
import { en } from './locales/en.js';
import { fr } from './locales/fr.js';
import { es } from './locales/es.js';
import { de } from './locales/de.js';
import { it } from './locales/it.js';
import { pt } from './locales/pt.js';
import { nl } from './locales/nl.js';

/** A message catalog: message key → translated string. */
export type Catalog = Record<string, string>;

/** A bound translate function. */
export type TFunction = (key: string, params?: Record<string, string | number>) => string;

/**
 * Offered UI locales (the top ~30 by usage), code + native display name. A code
 * here without a catalog below renders English until translated.
 */
export const LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'zh-Hans', name: '简体中文' },
  { code: 'es', name: 'Español' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ar', name: 'العربية' },
  { code: 'fr', name: 'Français' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ja', name: '日本語' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ur', name: 'اردو' },
  { code: 'it', name: 'Italiano' },
  { code: 'ko', name: '한국어' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'pl', name: 'Polski' },
  { code: 'uk', name: 'Українська' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'fa', name: 'فارسی' },
  { code: 'th', name: 'ไทย' },
  { code: 'sv', name: 'Svenska' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'cs', name: 'Čeština' },
  { code: 'ro', name: 'Română' },
  { code: 'hu', name: 'Magyar' },
  { code: 'da', name: 'Dansk' },
  { code: 'fi', name: 'Suomi' },
  { code: 'he', name: 'עברית' },
] as const;

export type LocaleCode = (typeof LOCALES)[number]['code'];

/** Catalogs that actually have translations (others fall back to English).
 *  Seeded set so far; the remaining offered locales render English until their
 *  `locales/<code>.ts` is added and registered here. */
const CATALOGS: Record<string, Catalog> = { en, fr, es, de, it, pt, nl };

const OFFERED = new Set<string>(LOCALES.map((l) => l.code));

/** Resolve a `Settings.locale` value to an offered locale code (English-fallback). */
export function resolveLocale(setting: string | undefined, systemLocale?: string): string {
  if (setting && setting !== 'system' && OFFERED.has(setting)) return setting;
  const sys = systemLocale ?? 'en';
  if (OFFERED.has(sys)) return sys; // exact (e.g. 'zh-Hans')
  const base = sys.slice(0, 2).toLowerCase();
  return OFFERED.has(base) ? base : 'en';
}

/** Build a translate function bound to a locale (per-key English fallback). */
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
