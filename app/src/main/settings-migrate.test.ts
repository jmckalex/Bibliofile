import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@bibdesk/shared';
import { migrateSettings } from './settings-migrate.js';

const base = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

describe('migrateSettings', () => {
  it('is a no-op for current defaults (returns the same reference)', () => {
    const s = base();
    expect(migrateSettings(s)).toBe(s);
  });

  it('upgrades the stale %u2 cite-key default to the current default', () => {
    const out = migrateSettings(base({ citeKeyFormat: '%a1:%Y%u2' }));
    expect(out.citeKeyFormat).toBe(DEFAULT_SETTINGS.citeKeyFormat);
  });

  it('keeps a user-chosen (non-default) cite-key format untouched', () => {
    const out = migrateSettings(base({ citeKeyFormat: '%a1:%Y' }));
    expect(out.citeKeyFormat).toBe('%a1:%Y');
  });

  it('folds a legacy detailsTemplate into a "Custom" fork + selects it', () => {
    const out = migrateSettings(base({ detailsTemplate: 'D:{{citeKey}}' }));
    expect(out.detailsForks).toEqual([{ name: 'Custom', body: 'D:{{citeKey}}' }]);
    expect(out.activeDetailsFork).toBe('Custom');
    expect(out.detailsTemplate).toBeUndefined();
  });

  it('folds a legacy bottomPanelTemplate independently of the detail pane', () => {
    const out = migrateSettings(base({ bottomPanelTemplate: 'B:{{type}}' }));
    expect(out.bottomForks).toEqual([{ name: 'Custom', body: 'B:{{type}}' }]);
    expect(out.activeBottomFork).toBe('Custom');
    expect(out.bottomPanelTemplate).toBeUndefined();
    expect(out.detailsForks).toEqual([]);
    expect(out.activeDetailsFork).toBeUndefined();
  });

  it('avoids a name clash with an existing fork named "Custom"', () => {
    const out = migrateSettings(
      base({ detailsTemplate: 'legacy', detailsForks: [{ name: 'Custom', body: 'mine' }] }),
    );
    expect(out.detailsForks).toEqual([
      { name: 'Custom', body: 'mine' },
      { name: 'Custom 2', body: 'legacy' },
    ]);
    expect(out.activeDetailsFork).toBe('Custom 2');
  });

  it('does not override an existing active selection when folding', () => {
    const out = migrateSettings(
      base({
        detailsTemplate: 'legacy',
        detailsForks: [{ name: 'Keep', body: 'k' }],
        activeDetailsFork: 'Keep',
      }),
    );
    expect(out.detailsForks).toEqual([
      { name: 'Keep', body: 'k' },
      { name: 'Custom', body: 'legacy' },
    ]);
    expect(out.activeDetailsFork).toBe('Keep');
  });

  it('ignores empty legacy template strings', () => {
    const out = migrateSettings(base({ detailsTemplate: '', bottomPanelTemplate: '' }));
    expect(out.detailsForks).toEqual([]);
    expect(out.bottomForks).toEqual([]);
  });

  it('is idempotent (re-running on migrated output changes nothing)', () => {
    const once = migrateSettings(base({ detailsTemplate: 'x', citeKeyFormat: '%a1:%Y%u2' }));
    const twice = migrateSettings(once);
    expect(twice).toEqual(once);
  });
});
