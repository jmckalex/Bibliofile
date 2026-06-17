/**
 * Minimal HTML→RTF conversion for "Copy Citation as RTF" and RTF export. CSL
 * citations are small HTML fragments (`<i>`, `<b>`, `<span>`, entities); we map
 * those to RTF runs and escape the rest. Not a general HTML→RTF engine — just
 * enough for formatted citations/bibliographies to paste cleanly into Word/Pages.
 */

/** Escape a plain-text run for RTF: backslash/braces + non-ASCII → `\uN?`. */
function escapeRtfText(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '{') out += '\\{';
    else if (ch === '}') out += '\\}';
    else if (ch === '\n') out += '\\line ';
    else if (code < 128) out += ch;
    else out += `\\u${code > 32767 ? code - 65536 : code}?`; // RTF signed 16-bit
  }
  return out;
}

/** Convert a small HTML citation fragment to an RTF body (runs only, no header). */
export function htmlToRtf(html: string): string {
  let out = '';
  let i = 0;
  // Stack-free: italic/bold are well-nested in CSL output; toggle on open/close.
  while (i < html.length) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) break;
      const tag = html.slice(i + 1, close).trim().toLowerCase();
      const name = tag.replace(/^\//, '').split(/[\s>]/)[0];
      const isClose = tag.startsWith('/');
      if (name === 'i' || name === 'em') out += isClose ? '\\i0 ' : '\\i ';
      else if (name === 'b' || name === 'strong') out += isClose ? '\\b0 ' : '\\b ';
      else if (name === 'br') out += '\\line ';
      else if ((name === 'p' || name === 'div') && isClose) out += '\\par ';
      // other tags (span, a, sup, sub…) drop to plain text
      i = close + 1;
    } else {
      const next = html.indexOf('<', i);
      const chunk = html.slice(i, next === -1 ? html.length : next);
      out += escapeRtfText(decodeEntities(chunk));
      i = next === -1 ? html.length : next;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Decode the handful of HTML entities CSL output uses. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)));
}

/** Wrap one or more RTF bodies (already converted) into a complete RTF document. */
export function wrapRtf(paragraphs: readonly string[]): string {
  const body = paragraphs.join('\\par\n');
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}\\fs24\n${body}\n}`;
}
