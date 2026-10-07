import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '@bibdesk/shared';

import { planStartupOpen } from './startup-files.js';

const A = resolve('/libs/a.bib');
const B = resolve('/libs/b.bib');
const C = resolve('/libs/c.bib');
const everything = (): boolean => true;

describe('planStartupOpen', () => {
  it('opens the startup list in its order', () => {
    expect(planStartupOpen([A, B], undefined, everything)).toEqual({ open: [A, B], missing: [] });
  });

  it('opens the launch file last, so its window ends up in front', () => {
    expect(planStartupOpen([A, B], C, everything).open).toEqual([A, B, C]);
  });

  it('a launch file that is also listed opens once, last', () => {
    expect(planStartupOpen([A, B, C], A, everything).open).toEqual([B, C, A]);
  });

  it('drops duplicates, compared as resolved paths', () => {
    expect(planStartupOpen([A, '/libs/./a.bib', B], undefined, everything).open).toEqual([A, B]);
  });

  it('reports listed files that no longer exist instead of opening them', () => {
    const plan = planStartupOpen([A, B, C], undefined, (p) => p !== B);
    expect(plan).toEqual({ open: [A, C], missing: [B] });
  });

  it('tolerates a hand-edited settings value', () => {
    expect(planStartupOpen(undefined, C, everything)).toEqual({ open: [C], missing: [] });
    expect(planStartupOpen('a.bib', undefined, everything)).toEqual({ open: [], missing: [] });
    expect(planStartupOpen([A, 3, null, '', '  '], undefined, everything).open).toEqual([A]);
  });

  it('opens nothing by default', () => {
    expect(DEFAULT_SETTINGS.startupFiles).toEqual([]);
    expect(planStartupOpen(DEFAULT_SETTINGS.startupFiles, undefined, everything).open).toEqual([]);
  });
});

describe('index.ts wiring', () => {
  const main = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

  it('opens the startup libraries at launch, into the first window, with the launch file', () => {
    expect(main).toMatch(/const first = createWindow\(\);[\s\S]{0,400}openStartupLibraries\(first, launchPath\);/);
  });

  it('reopens them when the Dock icon is clicked with no window open', () => {
    expect(main).toMatch(
      /app\.on\('activate', \(\) => \{\s*if \(BrowserWindow\.getAllWindows\(\)\.length === 0\) openStartupLibraries\(createWindow\(\)\);/,
    );
  });
});
