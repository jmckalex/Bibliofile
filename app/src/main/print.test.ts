import { describe, expect, it } from 'vitest';

import { buildPrintHtml } from './print';

describe('buildPrintHtml', () => {
  it('wraps each formatted entry in a .ref block and includes an escaped title', () => {
    const html = buildPrintHtml(
      ['Smith, J. (2020). <i>A Title</i>.', 'Doe, J. (2019). Another.'],
      'My Library <draft>',
    );
    expect(html).toContain('<h1>My Library &lt;draft&gt;</h1>');
    expect(html).toContain('<div class="ref">Smith, J. (2020). <i>A Title</i>.</div>');
    expect(html).toContain('<div class="ref">Doe, J. (2019). Another.</div>');
    // The CSL italic/bold runs are passed through untouched (trusted HTML).
    expect(html).toContain('<i>A Title</i>');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('renders a hanging-indent print stylesheet', () => {
    const html = buildPrintHtml(['x'], 'T');
    expect(html).toContain('@page');
    expect(html).toContain('text-indent: -2.2em');
    expect(html).toContain('break-inside: avoid');
  });

  it('shows a placeholder and a default <title> when there are no entries', () => {
    const html = buildPrintHtml([], '');
    expect(html).toContain('No publications to print.');
    expect(html).toContain('<title>Bibliography</title>');
    // An empty heading is omitted entirely.
    expect(html).not.toContain('<h1>');
  });
});
