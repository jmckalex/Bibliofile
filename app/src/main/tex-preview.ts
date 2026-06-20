/**
 * LaTeX/BibTeX bibliography preview (opt-in, power-user). Spawns the user's
 * local `pdflatex` + `bibtex` to typeset the library's bibliography with a
 * chosen `.bst` style and produce a PDF — the parity feature for users who want
 * true BibTeX output rather than the CSL/HTML preview. Needs a TeX install
 * (MacTeX / TeX Live / MiKTeX); degrades with a clear message when absent.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Common TeX `bin` locations probed when the binaries aren't on `PATH`. */
const COMMON_TEX_DIRS = [
  '/Library/TeX/texbin', // MacTeX symlink dir
  '/usr/local/texlive/2025/bin/universal-darwin',
  '/usr/local/texlive/2024/bin/universal-darwin',
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/bin',
  'C:\\texlive\\2025\\bin\\windows',
  'C:\\texlive\\2024\\bin\\windows',
  'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64',
];

/** Resolve a TeX executable's full path: configured dir → common dirs → PATH. */
export function findTexBin(name: string, configuredDir?: string): string | undefined {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const dirs = [configuredDir, ...COMMON_TEX_DIRS].filter((d): d is string => !!d);
  for (const d of dirs) {
    const p = join(d, exe);
    if (existsSync(p)) return p;
  }
  for (const d of (process.env.PATH ?? '').split(delimiter)) {
    if (d && existsSync(join(d, exe))) return join(d, exe);
  }
  return undefined;
}

export interface TexRenderInput {
  /** The library serialized to BibTeX (written as `preview.bib`). */
  readonly bibText: string;
  /** Cite keys to include; empty/undefined ⇒ `\nocite{*}` (the whole library). */
  readonly citeKeys?: readonly string[];
  /** BibTeX `.bst` style name (e.g. `plain`, `abbrv`, `ieeetr`). */
  readonly bstStyle: string;
  /** Optional directory holding `pdflatex`/`bibtex` when not on PATH. */
  readonly binDir?: string;
}

export interface TexRenderResult {
  /** Absolute path to the produced PDF on success. */
  readonly pdfPath?: string;
  /** A readable failure message (missing TeX, or a compile error) on failure. */
  readonly error?: string;
}

/** Build the wrapper `.tex` that prints just the bibliography. */
function previewTex(nocite: string, bst: string): string {
  return [
    '\\documentclass[12pt]{article}',
    '\\usepackage[margin=1in]{geometry}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{url}',
    '\\begin{document}',
    '\\pagestyle{empty}',
    `\\nocite{${nocite}}`,
    `\\bibliographystyle{${bst}}`,
    '\\bibliography{preview}',
    '\\end{document}',
    '',
  ].join('\n');
}

/**
 * Render the bibliography to a PDF via the standard 4-pass
 * pdflatex → bibtex → pdflatex → pdflatex in a fresh temp directory. Tolerates
 * non-zero exits from intermediate passes (LaTeX returns non-zero on mere
 * warnings); success is "a PDF was produced".
 */
export async function renderTexPreview(input: TexRenderInput): Promise<TexRenderResult> {
  const pdflatex = findTexBin('pdflatex', input.binDir);
  const bibtex = findTexBin('bibtex', input.binDir);
  if (!pdflatex || !bibtex) {
    return {
      error:
        'No LaTeX installation found. Install MacTeX / TeX Live / MiKTeX, ' +
        'or set the TeX bin directory in Preferences → Citation.',
    };
  }

  const dir = mkdtempSync(join(tmpdir(), 'bibdesk-tex-'));
  const bst = (input.bstStyle || 'plain').replace(/[^A-Za-z0-9._-]/g, '') || 'plain';
  const nocite = input.citeKeys && input.citeKeys.length > 0 ? input.citeKeys.join(',') : '*';
  writeFileSync(join(dir, 'preview.bib'), input.bibText, 'utf8');
  writeFileSync(join(dir, 'preview.tex'), previewTex(nocite, bst), 'utf8');

  const env = { ...process.env };
  if (input.binDir) env.PATH = `${input.binDir}${delimiter}${env.PATH ?? ''}`;
  const run = (cmd: string, args: string[]): Promise<unknown> =>
    execFileP(cmd, args, { cwd: dir, env, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }).catch(
      () => undefined, // tolerate non-zero exits; we judge success by the PDF
    );

  const latexArgs = ['-interaction=nonstopmode', '-halt-on-error', 'preview.tex'];
  await run(pdflatex, latexArgs);
  await run(bibtex, ['preview']);
  await run(pdflatex, latexArgs);
  await run(pdflatex, latexArgs);

  const pdfPath = join(dir, 'preview.pdf');
  if (existsSync(pdfPath)) return { pdfPath };

  // No PDF → surface the first few LaTeX error lines from the log.
  let log = '';
  try {
    log = readFileSync(join(dir, 'preview.log'), 'utf8');
  } catch {
    /* no log */
  }
  const errs = log
    .split('\n')
    .filter((l) => l.startsWith('!'))
    .slice(0, 6)
    .join('\n');
  return {
    error: errs
      ? `LaTeX compile failed:\n${errs}`
      : 'LaTeX compile failed (no PDF produced). Check that the chosen .bst style exists.',
  };
}
