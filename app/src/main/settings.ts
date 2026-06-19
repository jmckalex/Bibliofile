/**
 * Application preferences: a small JSON store under the OS user-data directory
 * (replaces NSUserDefaults), plus the logic to APPLY settings — most importantly
 * the user-overridable field-type sets, which feed the shared TypeManager and so
 * change how every document classifies person/URL/rating/boolean/etc. fields.
 */

import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sharedTypeManager } from '@bibdesk/model';
import { DEFAULT_SETTINGS, type Settings } from '@bibdesk/shared';
import { migrateSettings } from './settings-migrate.js';

let current: Settings = DEFAULT_SETTINGS;

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function merge(base: Settings, patch: Partial<Settings>): Settings {
  return {
    ...base,
    ...patch,
    fieldTypes: { ...base.fieldTypes, ...(patch.fieldTypes ?? {}) },
  };
}

/** Write settings to disk (best-effort; non-fatal on failure). */
function persist(s: Settings): void {
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
  } catch {
    /* non-fatal: settings just won't persist */
  }
}

/** Apply settings that affect the core model (the field-type classification). */
function apply(s: Settings): void {
  const ft = s.fieldTypes;
  // Map our setting names to the TypeManager's NSUserDefaults-key field-type sets.
  sharedTypeManager.setFieldTypeOverrides({
    'Person fields': [...ft.person],
    'Local File Fields': [...ft.localFile],
    'Remote URL Fields': [...ft.remoteURL],
    'Rating fields': [...ft.rating],
    'Boolean fields': [...ft.boolean],
    'Three state fields': [...ft.triState],
    'Citation fields': [...ft.citation],
  });
  // User-defined entry types overlay (standard types are protected in the manager).
  sharedTypeManager.setTypeInfoOverlay(
    Object.fromEntries(
      Object.entries(s.customTypes).map(([name, t]) => [
        name,
        { required: [...t.required], optional: [...t.optional] },
      ]),
    ),
  );
}

/** Load settings from disk (merged over defaults) and apply them. */
export function loadSettings(): Settings {
  try {
    if (existsSync(settingsPath())) {
      const loaded = merge(DEFAULT_SETTINGS, JSON.parse(readFileSync(settingsPath(), 'utf8')));
      current = migrateSettings(loaded);
      if (current !== loaded) persist(current); // write the upgrade back
    }
  } catch {
    current = DEFAULT_SETTINGS;
  }
  apply(current);
  return current;
}

/** The current in-memory settings. */
export function getSettings(): Settings {
  return current;
}

/** Merge a patch into the current settings, apply, persist, and return them. */
export function updateSettings(patch: Partial<Settings>): Settings {
  current = merge(current, patch);
  apply(current);
  persist(current);
  return current;
}
