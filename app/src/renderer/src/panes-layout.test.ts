/**
 * Guards the main window's three-pane grid against the bug that shipped once:
 * the groups sidebar's width was a hardcoded `220px` in the grid template with
 * no splitter beside it, so — unlike the right pane and the bottom panel — it
 * could not be resized at all, and nothing persisted.
 *
 * The grid is driven by an inline `gridTemplateColumns` whose column COUNT has
 * to match the number of children `.bd-panes` renders. Get that wrong and the
 * panes silently slide into the wrong columns. Nothing but this test ties the
 * template, the children, and the CSS fallback together, so (as with
 * `editor-layout.test.ts`) we assert on the sources rather than a screenshot.
 */
import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { DEFAULT_SETTINGS } from '@bibdesk/shared';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/**
 * The two branches of the inline `gridTemplateColumns` ternary: right pane
 * visible, and right pane hidden.
 */
function gridTemplates(): { withRight: string; withoutRight: string } {
  const block = /gridTemplateColumns:[\s\S]{0,400}?,\n/.exec(app)?.[0] ?? '';
  const templates = [...block.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  expect(templates).toHaveLength(2);
  return { withRight: templates[0]!, withoutRight: templates[1]! };
}

/** Count grid columns, treating `${…}` and `minmax(0, 1fr)` as single tokens. */
function columnCount(template: string): number {
  return template
    .replace(/\$\{[^}]+\}/g, 'X') // interpolations -> one token
    .replace(/\(([^)]*)\)/g, (m) => m.replace(/\s+/g, '')) // minmax(0, 1fr) -> minmax(0,1fr)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

describe('main window pane grid', () => {
  it('sizes the groups sidebar from the persisted layout, not a constant', () => {
    const { withRight, withoutRight } = gridTemplates();
    // Both branches must take the sidebar width from settings — a literal px
    // value here is exactly the bug this file exists to prevent.
    expect(withRight).toContain('layout.leftPaneWidth');
    expect(withoutRight).toContain('layout.leftPaneWidth');
    expect(withRight.startsWith('${layout.leftPaneWidth}px')).toBe(true);
    expect(withoutRight.startsWith('${layout.leftPaneWidth}px')).toBe(true);
  });

  it('declares one column per pane child, in both branches', () => {
    const { withRight, withoutRight } = gridTemplates();
    // sidebar | splitter | centre
    expect(columnCount(withoutRight)).toBe(3);
    // sidebar | splitter | centre | splitter | right pane
    expect(columnCount(withRight)).toBe(5);
  });

  it('gives the sidebar a splitter that resizes it in the natural direction', () => {
    // The sidebar is on the LEFT, so a rightward drag must WIDEN it (+dx).
    // Copying the right pane's `cur - dx` would invert the handle.
    expect(app).toMatch(/leftPaneWidth:\s*Math\.max\([^)]*Math\.min\([^)]*cur \+ dx\)/);
    expect(app).toContain("t('splitter.groups')");
  });

  it('has a default sidebar width inside the splitter clamp', () => {
    const clamp = /leftPaneWidth:\s*Math\.max\((\d+),\s*Math\.min\((\d+),/.exec(app);
    expect(clamp).not.toBeNull();
    const [min, max] = [Number(clamp![1]), Number(clamp![2])];
    expect(min).toBeLessThan(max);
    // Otherwise the pane jumps the first time the user grabs the handle.
    expect(DEFAULT_SETTINGS.layout.leftPaneWidth).toBeGreaterThanOrEqual(min);
    expect(DEFAULT_SETTINGS.layout.leftPaneWidth).toBeLessThanOrEqual(max);
  });

  it('keeps the pre-hydration CSS fallback in step with the collapsed branch', () => {
    const fallback = /\.bd-panes\s*\{[^}]*grid-template-columns:\s*([^;]+);/.exec(css)?.[1];
    expect(fallback).toBeDefined();
    expect(columnCount(fallback!)).toBe(columnCount(gridTemplates().withoutRight));
  });
});
