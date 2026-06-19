/**
 * One-time upgrades of stale persisted {@link Settings} to the current shape.
 *
 * Kept pure (no electron/fs imports) so it is unit-testable and so `settings.ts`
 * stays focused on load/persist/apply. Always run AFTER merging the loaded JSON
 * over {@link DEFAULT_SETTINGS}, so every field (including the fork arrays) is
 * present. Idempotent: re-running on already-migrated settings is a no-op.
 */
import { DEFAULT_SETTINGS, type PanelTemplate, type Settings } from '@bibdesk/shared';

/** The previous factory default for {@link Settings.citeKeyFormat}. */
const OLD_DEFAULT_CITE_KEY_FORMAT = '%a1:%Y%u2';

/** A fork name not already taken in `taken` (`base`, then `base 2`, `base 3`, …). */
function uniqueForkName(base: string, taken: readonly PanelTemplate[]): string {
  const names = new Set(taken.map((f) => f.name));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!names.has(candidate)) return candidate;
  }
}

/**
 * Apply the migrations:
 *  1. Cite-key default: `%u2` (always two letters) → `%u0` (a letter only on
 *     collision). A user who set a different format keeps it.
 *  2. Pre-fork panel overrides (`detailsTemplate` / `bottomPanelTemplate`) →
 *     a named "Custom" fork, selected as active, with the legacy field cleared.
 *     This preserves a customized template across the upgrade to named forks.
 */
export function migrateSettings(s: Settings): Settings {
  let next: Settings = s;

  if (next.citeKeyFormat === OLD_DEFAULT_CITE_KEY_FORMAT) {
    next = { ...next, citeKeyFormat: DEFAULT_SETTINGS.citeKeyFormat };
  }

  if (next.detailsTemplate) {
    const name = uniqueForkName('Custom', next.detailsForks);
    next = {
      ...next,
      detailsForks: [...next.detailsForks, { name, body: next.detailsTemplate }],
      activeDetailsFork: next.activeDetailsFork ?? name,
      detailsTemplate: undefined,
    };
  }

  if (next.bottomPanelTemplate) {
    const name = uniqueForkName('Custom', next.bottomForks);
    next = {
      ...next,
      bottomForks: [...next.bottomForks, { name, body: next.bottomPanelTemplate }],
      activeBottomFork: next.activeBottomFork ?? name,
      bottomPanelTemplate: undefined,
    };
  }

  return next;
}
