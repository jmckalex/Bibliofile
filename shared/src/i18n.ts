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
import { zhHans } from './locales/zh-Hans.js';
import { es } from './locales/es.js';
import { hi } from './locales/hi.js';
import { ar } from './locales/ar.js';
import { fr } from './locales/fr.js';
import { pt } from './locales/pt.js';
import { ru } from './locales/ru.js';
import { de } from './locales/de.js';
import { ja } from './locales/ja.js';
import { bn } from './locales/bn.js';
import { id } from './locales/id.js';
import { ur } from './locales/ur.js';
import { it } from './locales/it.js';
import { ko } from './locales/ko.js';
import { tr } from './locales/tr.js';
import { vi } from './locales/vi.js';
import { pl } from './locales/pl.js';
import { uk } from './locales/uk.js';
import { nl } from './locales/nl.js';
import { fa } from './locales/fa.js';
import { th } from './locales/th.js';
import { sv } from './locales/sv.js';
import { el } from './locales/el.js';
import { cs } from './locales/cs.js';
import { ro } from './locales/ro.js';
import { hu } from './locales/hu.js';
import { da } from './locales/da.js';
import { fi } from './locales/fi.js';
import { he } from './locales/he.js';

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

/** Catalogs with translations (others fall back to English, per key). All 30
 *  offered locales are seeded; the non-English ones are machine-translated and
 *  flagged for native review (see locales/*.ts headers). Technical / proper-noun
 *  keys (BibTeX, RIS…, %-format codes, …) deliberately mirror English. */
const CATALOGS: Record<string, Catalog> = { en, 'zh-Hans': zhHans, es, hi, ar, fr, pt, ru, de, ja, bn, id, ur, it, ko, tr, vi, pl, uk, nl, fa, th, sv, el, cs, ro, hu, da, fi, he };

const OFFERED = new Set<string>(LOCALES.map((l) => l.code));

/** Locale codes with a registered (non-fallback) catalog. Exposed for tests/tools. */
export const REGISTERED_LOCALES: readonly string[] = Object.keys(CATALOGS);

/** The catalog for a code, or `undefined` if that locale falls back to English. */
export function getCatalog(code: string): Catalog | undefined {
  return CATALOGS[code];
}

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
