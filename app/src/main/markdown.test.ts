import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown.js';

describe('renderMarkdown', () => {
  it('renders basic markdown', () => {
    const h = renderMarkdown('**bold** and *italic* and `code`');
    expect(h).toContain('<strong>bold</strong>');
    expect(h).toContain('<em>italic</em>');
    expect(h).toContain('<code>code</code>');
  });

  it('renders lists', () => {
    const h = renderMarkdown('- a\n- b');
    expect(h).toContain('<ul>');
    expect(h).toContain('<li>a</li>');
  });

  it('protects math from markdown emphasis', () => {
    const h = renderMarkdown('the mass $m_{e}$ and the product $a_1 * b_2$');
    expect(h).toContain('$m_{e}$'); // underscores survive (not turned into <em>)
    expect(h).toContain('$a_1 * b_2$'); // asterisks inside math survive
    expect(h).not.toContain('<em>');
  });

  it('strips scripts and dangerous tags', () => {
    const h = renderMarkdown('hi <script>alert(1)</script> <img src=x onerror=y>');
    expect(h).not.toContain('<script');
    expect(h).not.toContain('onerror');
  });

  it('converts links to data-open-url spans (no in-window href)', () => {
    const h = renderMarkdown('see [the paper](https://example.org/p)');
    expect(h).toContain('data-open-url="https://example.org/p"');
    expect(h).not.toContain('href=');
  });

  it('returns empty for blank input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('   ')).toBe('');
  });
});
