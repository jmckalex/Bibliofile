import { describe, it, expect } from 'vitest';
import { renderMarkdown, renderNotes } from './markdown.js';

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

  it('protects LaTeX \\[…\\] / \\(…\\) delimiters (not eaten as escaped brackets)', () => {
    const display = renderMarkdown('Einstein: \\[ E = mc^2 \\] is famous.');
    expect(display).toContain('\\[ E = mc^2 \\]'); // delimiters reach the HTML for MathJax
    const inline = renderMarkdown('the value \\(x_1 * y_2\\) here');
    expect(inline).toContain('\\(x_1 * y_2\\)'); // `*` inside isn't emphasised
    expect(inline).not.toContain('<em>');
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

  it('does NOT allow iframes in abstracts (strict)', () => {
    expect(renderMarkdown('<iframe src="https://x.org"></iframe>')).not.toContain('<iframe');
  });
});

describe('renderNotes', () => {
  it('turns [[citeKey]] into data-cite links, flagging unknown keys', () => {
    const known = (k: string) => k === 'smith2020';
    const h = renderNotes('See [[smith2020]] and also [[ghost1999]].', known);
    expect(h).toContain('data-cite="smith2020"');
    expect(h).toContain('data-cite="ghost1999"');
    expect(h).toContain('bd-citelink--missing'); // ghost1999 is unknown
    // smith2020 link is not flagged missing
    expect(h).toMatch(/class="bd-citelink"[^>]*data-cite="smith2020"/);
  });

  it('allows inlined http/https iframes', () => {
    const h = renderNotes('<iframe src="https://example.org/embed" width="560"></iframe>', () => true);
    expect(h).toContain('<iframe');
    expect(h).toContain('src="https://example.org/embed"');
    expect(h).toContain('width="560"');
  });

  it('strips dangerous iframe src schemes', () => {
    const h = renderNotes('<iframe src="javascript:alert(1)"></iframe>', () => true);
    expect(h).not.toContain('javascript:');
  });

  it('still protects math + renders markdown in notes', () => {
    const h = renderNotes('**bold** with $x_1$ and [[k]]', () => true);
    expect(h).toContain('<strong>bold</strong>');
    expect(h).toContain('$x_1$');
    expect(h).toContain('data-cite="k"');
  });
});
