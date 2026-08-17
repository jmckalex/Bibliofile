/**
 * Renderer translate hook. Reads the current locale from the store
 * (`settings.locale`), so any component using it re-renders when the language
 * changes. Untranslated keys fall back to English.
 */
import { useMemo } from 'react';
import { makeT, resolveLocale, type TFunction } from '@bibdesk/shared';
import { useStore, getStore } from './store.js';

/** A translate function bound to the current UI locale. */
export function useT(): TFunction {
  const locale = useStore((s) => s.settings.locale);
  return useMemo(() => makeT(resolveLocale(locale, navigator.language)), [locale]);
}

let cached: { locale: string; t: TFunction } | undefined;

/**
 * Translate from outside React — the `<bd-*>` custom elements and the imperative
 * DOM in `panel-hydrate`, which render into the template-driven detail pane and
 * so cannot use the `useT` hook (audit rpt-03 MED-7).
 *
 * Reads the store per call rather than binding once, so a language change is
 * picked up the next time the widget re-renders; the bound translator is cached
 * per locale so that costs a string compare, not a catalog rebuild.
 */
export function tNow(key: string, params?: Record<string, string | number>): string {
  const locale = getStore().getState().settings.locale;
  if (cached?.locale !== locale) {
    cached = { locale, t: makeT(resolveLocale(locale, navigator.language)) };
  }
  return cached.t(key, params);
}
