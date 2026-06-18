/**
 * Main-process translator for menus + native dialogs. Bound to the current
 * settings locale (or the OS locale when 'system'); `setMainLocale` re-binds it
 * when the preference changes, after which the caller should `buildMenu()` so
 * the menu re-localizes.
 */
import { app } from 'electron';
import { makeT, resolveLocale, type TFunction } from '@bibdesk/shared';

let current: TFunction = makeT('en');

/** (Re)bind the main-process translator from a `Settings.locale` value. */
export function setMainLocale(setting: string | undefined): void {
  current = makeT(resolveLocale(setting, app.getLocale()));
}

/** Translate a key in the main process. */
export const t: TFunction = (key, params) => current(key, params);
