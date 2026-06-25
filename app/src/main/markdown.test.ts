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

  it('protects inline $…$ that spans soft line breaks (multi-line inline math)', () => {
    const h = renderMarkdown('the sum\n$\\sum_{n=1}^{\\infty}\n\\frac{1}{n^2}\n= \\frac{\\pi^2}{6}$\nconverges');
    // the whole expression (newlines and all) reaches the HTML intact for MathJax
    expect(h).toContain('$\\sum_{n=1}^{\\infty}\n\\frac{1}{n^2}\n= \\frac{\\pi^2}{6}$');
    // `_`/`{` inside never became emphasis/markup
    expect(h).not.toContain('<em>');
  });

  it('does NOT let inline $…$ run across a blank line (stray-$ safety)', () => {
    const h = renderMarkdown('it cost $5\n\nand also $10 later');
    // the two paragraphs survive as literal text — no span swallowed the gap
    expect(h).toContain('$5');
    expect(h).toContain('$10 later');
    // a single protected math span would have hidden one of these dollar signs
    expect((h.match(/\$/g) ?? []).length).toBe(2);
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

  it('renders \\cite{…} commands via the supplied formatter (trusted HTML past sanitize)', () => {
    const renderCite = (raw: string): string =>
      `<span class="bd-icite" data-cite="k">[${raw}]</span>`;
    const h = renderNotes('As **shown** by \\citep{k_2020}, this holds.', () => true, renderCite);
    // the whole command was tokenized (its `_` was NOT turned into emphasis)…
    expect(h).toContain('<span class="bd-icite" data-cite="k">[\\citep{k_2020}]</span>');
    expect(h).not.toContain('<em>');
    // …and the surrounding markdown still rendered
    expect(h).toContain('<strong>shown</strong>');
  });

  it('leaves \\cite{…} literal when no formatter is supplied (e.g. abstracts)', () => {
    expect(renderMarkdown('see \\citep{k}')).not.toContain('bd-icite');
    const h = renderNotes('see \\citep{k}', () => true); // notes, but no formatter
    expect(h).not.toContain('bd-icite');
  });

  it('expands @references to a bibliography of the cited keys (its own paragraph)', () => {
    const renderCite = (raw: string): string => `<cite>${raw}</cite>`;
    const renderBib = (keys: readonly string[]): string => `<div class="bd-references">[${keys.join('|')}]</div>`;
    const h = renderNotes('Cited \\citep{a} and \\citet{b}.\n\n@references', () => true, renderCite, renderBib);
    expect(h).toContain('<div class="bd-references">[a|b]</div>'); // both cited keys, in order
    expect(h).not.toContain('@references'); // marker consumed
    expect(h).not.toContain('@@REFS@@'); // placeholder restored
    expect(h).not.toMatch(/<p>\s*<div class="bd-references"/); // not nested inside a <p>
  });

  it('leaves @references literal when no bibliography renderer is supplied', () => {
    expect(renderNotes('text\n\n@references', () => true)).toContain('@references');
  });
});
