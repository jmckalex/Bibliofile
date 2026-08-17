/**
 * Guards the `.bib` file association, which is load-bearing for two features that
 * look nothing like packaging:
 *
 *  - **File → Open Recent.** `loadDocumentInto` calls `app.addRecentDocument(path)`
 *    on every open, and macOS does record it — but AppKit DISPLAYS only the entries
 *    whose type the bundle claims in `CFBundleDocumentTypes`. With no claim the menu
 *    holds nothing but "Clear Menu" however many bibliographies you open, and macOS
 *    prunes the recorded-but-unclaimed entries on its next write. Verified by A/B on
 *    the dev bundle: drop the document type and a working menu goes empty; add it
 *    back and the entries list and survive a relaunch.
 *  - **`app.on('open-file')`** — unreachable from a Finder double-click unless macOS
 *    knows Bibliofile opens `.bib` at all.
 *
 * Three files have to agree and nothing else ties them together: electron-builder's
 * `fileAssociations` (the packaged app), `scripts/dev-applescript.sh` (the dev
 * bundle `scripts/run-bibliophile.sh` actually launches — electron-builder never
 * touches it), and the extension the Open dialog accepts. So assert on the sources,
 * as `editor-layout.test.ts` does; the failure mode is invisible in a build log and
 * only shows up as an empty menu weeks later.
 */
import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

const builderYml = readFileSync(new URL('../../../electron-builder.yml', import.meta.url), 'utf8');
const devScript = readFileSync(
  new URL('../../../scripts/dev-applescript.sh', import.meta.url),
  'utf8',
);
const mainProcess = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

/** The `fileAssociations:` block, up to the next top-level key. */
function fileAssociationsBlock(): string {
  const m = /\nfileAssociations:\n((?:[ \t-].*\n|\n)*)/.exec(builderYml);
  return m?.[1] ?? '';
}

describe('.bib file association', () => {
  it('is declared for the packaged app', () => {
    const block = fileAssociationsBlock();
    expect(block, 'electron-builder.yml has no fileAssociations block').not.toBe('');
    expect(block).toMatch(/-\s*ext:\s*bib\b/);
  });

  it('pins the handler rank instead of taking .bib from BibDesk', () => {
    // electron-builder defaults LSHandlerRank to `Default` (electronMac.js), which
    // would make Bibliofile fight for ownership of every .bib on the machine. The
    // recents menu works fine at `Alternate`, so declaring support is enough.
    expect(fileAssociationsBlock()).toMatch(/rank:\s*Alternate\b/);
  });

  it('claims the same type in the dev bundle, so dev and packaged agree', () => {
    // run-bibliophile.sh launches the patched dev Electron.app, which electron-builder
    // never sees — without this patch the bug reappears in exactly the build used for
    // day-to-day testing, and only there.
    expect(devScript).toMatch(/CFBundleDocumentTypes/);
    // Anchored on the closing quote of the PlistBuddy command: a bare /string bib/
    // also matches `string bibtex`, which is a different (wrong) extension.
    expect(devScript).toMatch(/CFBundleTypeExtensions:0 string bib"/);
    // Re-runnable: PlistBuddy's Add would otherwise stack a second entry each time.
    expect(devScript).toMatch(/Delete :CFBundleDocumentTypes/);
  });

  it('claims the extension the Open dialog actually accepts', () => {
    // If the dialog ever gains .bibtex, the association has to gain it too, or those
    // files open fine and then silently never appear in Open Recent.
    const dialog = /function openDialogOptions\(\)[\s\S]*?\n}/.exec(mainProcess)?.[0] ?? '';
    expect(dialog, 'openDialogOptions() not found').not.toBe('');
    const dialogExts = [...dialog.matchAll(/extensions:\s*\[([^\]]*)\]/g)]
      .flatMap((m) => m[1]!.split(','))
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter((e) => e && e !== '*');
    expect(dialogExts).toEqual(['bib']);
    for (const ext of dialogExts) {
      expect(fileAssociationsBlock(), `dialog accepts .${ext}`).toContain(`ext: ${ext}`);
    }
  });
});
