/**
 * Builds the in-app Help window contents from the Markdown manual in
 * `docs/help/*.md`. Renders every chapter to sanitised HTML (tables, images,
 * headings, code), rewrites `../image.png` references to `file://` absolute URLs
 * and `NN-chapter.md` cross-links to in-page anchors, and assembles a single
 * self-contained page with a sticky table-of-contents sidebar. Loaded into a
 * dedicated BrowserWindow (see `index.ts`).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const HELP_SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'em', 'strong', 'b', 'i', 'code', 'pre', 'kbd', 'samp',
    'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a',
    'sup', 'sub', 'del', 'span', 'img', 'table', 'thead', 'tbody', 'tr', 'th',
    'td', 'section', 'figure', 'figcaption',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title'],
    th: ['align'],
    td: ['align'],
  },
  allowedSchemes: ['http', 'https', 'file', 'data', 'mailto'],
};

/** Locate the shipped help directory (repo `docs/help`), or undefined. */
export function findHelpDir(appPath: string): string | undefined {
  const candidates = [
    resolve(appPath, '..', 'docs', 'help'), // app/ -> repo/docs/help
    resolve(appPath, 'docs', 'help'),
    resolve(appPath, '..', '..', 'docs', 'help'),
  ];
  return candidates.find((c) => existsSync(c));
}

interface Chapter {
  id: string;
  title: string;
  html: string;
}

function renderChapter(helpDir: string, file: string): Chapter {
  const id = basename(file, '.md');
  const md = readFileSync(join(helpDir, file), 'utf8');
  const title = /^#\s+(.+)$/m.exec(md)?.[1]?.trim() ?? id;
  let html = marked.parse(md, { async: false }) as string;
  // ../image.png  ->  file:///abs/docs/image.png
  html = html.replace(/(\.\.\/)+([^"')\s]+\.(?:png|jpe?g|gif|svg|webp))/gi, (_m, _dots, p) =>
    `file://${join(helpDir, '..', p)}`,
  );
  // NN-chapter.md(#anchor) -> #NN-chapter (in-page navigation)
  html = html.replace(/href="(\d[0-9a-z-]*)\.md(#[^"]*)?"/gi, (_m, n, a) => `href="#${n}${a ?? ''}"`);
  return { id, title, html: sanitizeHtml(html, HELP_SANITIZE) };
}

const HELP_CSS = `
:root{color-scheme:light dark;--fg:#1c2230;--muted:#6b7280;--bg:#fff;--alt:#f5f7fa;--border:#e2e6ec;--accent:#2563eb}
@media(prefers-color-scheme:dark){:root{--fg:#e6e9ef;--muted:#9aa3b2;--bg:#161a20;--alt:#1e232b;--border:#2b313c;--accent:#6ea8fe}}
*{box-sizing:border-box}body{margin:0;display:grid;grid-template-columns:248px 1fr;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--fg);background:var(--bg)}
nav{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;background:var(--alt);border-right:1px solid var(--border);padding:16px 10px}
nav h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 8px 8px}
nav a{display:block;padding:5px 8px;border-radius:6px;color:var(--fg);text-decoration:none;font-size:13.5px}
nav a:hover{background:var(--bg)}
main{padding:28px 40px;max-width:52rem;overflow:auto;height:100vh}
section{padding-bottom:8px}
h1{font-size:1.7rem;margin:.2em 0 .6em;padding-top:8px}h2{font-size:1.3rem;margin:1.4em 0 .5em;border-bottom:1px solid var(--border);padding-bottom:.2em}h3{font-size:1.1rem;margin:1.2em 0 .4em}h4{margin:1em 0 .3em}
a{color:var(--accent)}code{background:var(--alt);padding:1px 5px;border-radius:4px;font-size:.9em}
pre{background:var(--alt);padding:12px 14px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
table{border-collapse:collapse;margin:1em 0;font-size:.94em}th,td{border:1px solid var(--border);padding:6px 10px;text-align:left}th{background:var(--alt)}
blockquote{margin:1em 0;padding:.4em 1em;border-left:3px solid var(--accent);background:var(--alt);border-radius:0 6px 6px 0}
img{max-width:100%;border:1px solid var(--border);border-radius:8px;margin:.5em 0}
hr{border:none;border-top:1px solid var(--border);margin:2.4em 0}
`;

/** Render the whole manual as one self-contained HTML page. */
export function buildHelpHtml(helpDir: string): string {
  const files = readdirSync(helpDir)
    .filter((f) => /^\d.*\.md$/.test(f))
    .sort();
  const chapters = files.map((f) => renderChapter(helpDir, f));
  const esc = (s: string): string => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const toc = chapters
    .map((c) => `<a href="#${c.id}">${esc(c.title)}</a>`)
    .join('\n');
  const body = chapters.map((c) => `<section id="${c.id}">${c.html}</section>`).join('\n<hr>\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Bibliophile Help</title><style>${HELP_CSS}</style></head><body><nav><h2>Bibliophile Help</h2>${toc}</nav><main>${body}</main></body></html>`;
}
