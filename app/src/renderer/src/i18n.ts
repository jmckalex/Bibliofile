/**
 * Renderer translate hook. Reads the current locale from the store
 * (`settings.locale`), so any component using it re-renders when the language
 * changes. Untranslated keys fall back to English.
 */
import { useMemo } from 'react';
import { makeT, resolveLocale, type TFunction } from '@bibdesk/shared';
import { useStore } from './store.js';

/** A translate function bound to the current UI locale. */
export function useT(): TFunction {
  const locale = useStore((s) => s.settings.locale);
  return useMemo(() => makeT(resolveLocale(locale, navigator.language)), [locale]);
}
