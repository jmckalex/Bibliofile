/**
 * Build a self-contained, print-ready HTML document from already-formatted
 * citation HTML fragments (each produced by the CSL formatter). Kept pure and
 * dependency-free so it can be unit-tested; the main process supplies the
 * per-entry HTML and loads the result into a hidden window to print.
 */

/** Escape text destined for an HTML text node / attribute. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Wrap CSL-formatted entry HTML fragments in a paginated bibliography document.
 * `entries` are trusted HTML (italic/bold runs from the CSL formatter); `title`
 * is plain text and is escaped. Uses a hanging indent and print-friendly CSS.
 */
export function buildPrintHtml(entries: readonly string[], title: string): string {
  const heading = title.trim() ? `<h1>${escapeHtml(title.trim())}</h1>` : '';
  const list = entries.length
    ? entries.map((e) => `<div class="ref">${e}</div>`).join('\n')
    : '<p class="empty">No publications to print.</p>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title.trim() || 'Bibliography')}</title>
<style>
  @page { margin: 2cm; }
  html { -webkit-print-color-adjust: exact; }
  body {
    font: 12pt/1.5 "Times New Roman", Georgia, serif;
    color: #000; margin: 0; padding: 1.5em;
  }
  h1 { font-size: 16pt; margin: 0 0 1em; font-family: -apple-system, Helvetica, Arial, sans-serif; }
  .ref {
    margin: 0 0 0.7em; padding-left: 2.2em; text-indent: -2.2em;
    orphans: 3; widows: 3; break-inside: avoid;
  }
  .ref i, .ref em { font-style: italic; }
  .ref b, .ref strong { font-weight: bold; }
  .empty { color: #666; font-style: italic; }
</style>
</head>
<body>
${heading}
${list}
</body>
</html>`;
}
