/**
 * Guards the editor window's split layout against the exact bug that shipped
 * once: the CSS folds the two-column layout back to one stacked column below a
 * breakpoint, and the window's default width was BELOW that breakpoint — so the
 * split was silently disabled at the only size that actually matters, and the
 * editor looked completely unchanged.
 *
 * Asserting on the sources (rather than a rendered screenshot) is what makes this
 * checkable in CI: the two values live in different files, in different processes,
 * and nothing else ties them together.
 */
import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const mainProcess = readFileSync(new URL('../../main/index.ts', import.meta.url), 'utf8');

/** The `max-width` at which `.bd-detail--split` stops being a two-column grid. */
function collapseBreakpointPx(): number | undefined {
  // The block that re-columns `.bd-detail--split`, wherever that rule sits within
  // it (the `(?!@media)` guard stops the match running on into a later block).
  const m = /@media\s*\(max-width:\s*(\d+)px\)\s*\{(?:(?!@media)[\s\S])*?\.bd-detail--split\b/.exec(
    css,
  );
  return m ? Number(m[1]) : undefined;
}

/** The `width:` the standalone editor BrowserWindow opens at. */
function editorWindowWidthPx(): number | undefined {
  const body = /function createEditorWindow[\s\S]*?new BrowserWindow\(\{([\s\S]*?)\}\)/.exec(
    mainProcess,
  );
  if (!body) return undefined;
  const m = /(?:^|\n)\s*width:\s*(\d+),/.exec(body[1]!);
  return m ? Number(m[1]) : undefined;
}

describe('editor window split layout', () => {
  it('is a two-column grid', () => {
    const rule = /\.bd-detail--split\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/display:\s*grid/);
    expect(rule).toMatch(/grid-template-columns:[^;]*minmax/);
  });

  it('scrolls each column independently, so the fields cannot drag the preview', () => {
    // The window body must NOT be the scroller: if it is, scrolling the fields
    // moves the entire grid and the preview goes with it — which `position:
    // sticky` on the aside cannot prevent, because sticky only pins an element
    // within whatever is scrolling, and that was the body underneath it.
    const body = /\.bd-editorwin__body--split\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(body).toMatch(/overflow:\s*hidden/);

    // Instead the two columns each own a scrollbar, inside a full-height grid.
    const grid = /\.bd-detail--split\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(grid).toMatch(/height:\s*100%/);
    for (const sel of ['\\.bd-detail__aside', '\\.bd-detail__form']) {
      const rule = new RegExp(`${sel}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      expect(rule).toMatch(/overflow-y:\s*auto/);
      expect(rule).toMatch(/min-height:\s*0/); // or the column can't shrink to scroll
    }
  });

  it('opens WIDER than the breakpoint that collapses the split', () => {
    const breakpoint = collapseBreakpointPx();
    const width = editorWindowWidthPx();
    expect(breakpoint).toBeDefined();
    expect(width).toBeDefined();
    // The regression: width 560 vs breakpoint 620 meant every editor window
    // opened already collapsed, so the split layout was never once visible.
    expect(width!).toBeGreaterThan(breakpoint!);
  });

  it('leaves the form a usable column at the default width', () => {
    const width = editorWindowWidthPx()!;
    const sidebarRem = Number(
      /grid-template-columns:\s*minmax\(0,\s*([\d.]+)rem\)/.exec(css)?.[1] ?? '0',
    );
    expect(sidebarRem).toBeGreaterThan(0);
    // 16px/rem, plus the grid gap and the pane's own padding either side.
    const formPx = width - sidebarRem * 16 - 16 - 28;
    expect(formPx).toBeGreaterThan(360); // label + input still legible
  });
});
