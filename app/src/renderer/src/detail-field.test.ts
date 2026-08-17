/**
 * Guards the field editor against the bug that shipped once: `FieldRow` renders a
 * plain <input> for a short value and a <textarea> for a long one, and it re-decides
 * that from the LIVE value — so committing a 60+ character Title (tab out of the
 * field, the edit lands, the row re-renders) swapped the input for a `rows={3}`
 * textarea and the box jumped from one line to three under the user's hands. A
 * 71-character title that fits on one line got a three-line box.
 *
 * The swap itself is wanted; the jump is not. `field-sizing: content` fixes it by
 * sizing the textarea to its text — measured in Electron 33 (Chromium 130) at a
 * 700px field: input 23px, `rows=3` textarea 63px, autosizing textarea 26px.
 *
 * Two files must agree for that to hold — the class in `DetailPane.tsx` and the rule
 * in `styles.css` — and nothing else ties them together, so assert on the sources
 * (as `editor-layout.test.ts` and `panes-layout.test.ts` do). There is no DOM test
 * infrastructure in the renderer.
 */
import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const detailPane = readFileSync(new URL('./DetailPane.tsx', import.meta.url), 'utf8');

/** The body of a single-class CSS rule. */
function rule(selector: string): string {
  return new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

describe('long-value field editor', () => {
  it('sizes the textarea to its content rather than a fixed row count', () => {
    expect(rule('.bd-input--autosize')).toMatch(/field-sizing:\s*content/);
  });

  it('caps how tall it can grow, so a pasted abstract cannot run away', () => {
    // Without a cap, content sizing means a multi-thousand-character Abstract pushes
    // Annotation/Attachments off-screen instead of scrolling inside its own box.
    const body = rule('.bd-input--autosize');
    expect(body).toMatch(/max-height:\s*[\d.]+/);
    expect(body).toMatch(/overflow-y:\s*auto/);
  });

  it('is the class the field row actually puts on its textarea', () => {
    const textareas = detailPane.match(/<textarea[\s\S]*?\/>/g) ?? [];
    expect(textareas).toHaveLength(1); // the long-value field editor
    // Read the className ATTRIBUTE, not the element text: the JSX comment beside it
    // names the class too, and matching that would let this pass with the class
    // removed from the markup (it did, until the assertion was tightened).
    const classes = (/className="([^"]*)"/.exec(textareas[0]!)?.[1] ?? '').split(/\s+/);
    expect(classes).toContain('bd-input--autosize');
    // Still an --area too: that is what carries resize/line-height.
    expect(classes).toContain('bd-input--area');
  });

  it('keeps `rows` as the fallback for engines without field-sizing', () => {
    expect(detailPane.match(/<textarea[\s\S]*?\/>/)?.[0]).toMatch(/rows=\{3\}/);
  });
});
