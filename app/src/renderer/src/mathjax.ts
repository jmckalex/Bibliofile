/**
 * Lazy MathJax (tex-svg) integration for the preview pane.
 *
 * Loads the **offline** MathJax v3 bundle (`mathjax/es5/tex-svg.js`, bundled by
 * Vite via `?url` so it works in dev and in the packaged app — no CDN). Math is
 * configured for `$…$` / `\(…\)` inline and `$$…$$` / `\[…\]` display, SVG
 * output with a local font cache. The script is fetched once on first use.
 */

import mathjaxUrl from 'mathjax/es5/tex-svg.js?url';

let loadPromise: Promise<void> | undefined;

function configure(): void {
  window.MathJax = {
    tex: {
      inlineMath: [
        ['$', '$'],
        ['\\(', '\\)'],
      ],
      displayMath: [
        ['$$', '$$'],
        ['\\[', '\\]'],
      ],
      processEscapes: true,
    },
    svg: { fontCache: 'local' },
    // We typeset specific nodes ourselves; don't auto-typeset the whole page.
    startup: { typeset: false },
  };
}

/** Load + initialise MathJax once. Resolves when the typeset API is ready. */
export function ensureMathJax(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<void>((resolve, reject) => {
    configure();
    const script = document.createElement('script');
    script.src = mathjaxUrl;
    script.async = true;
    script.onload = () => {
      const mj = window.MathJax;
      if (mj?.startup?.promise) {
        mj.startup.promise.then(() => resolve()).catch(reject);
      } else {
        resolve();
      }
    };
    script.onerror = () => reject(new Error('Failed to load MathJax bundle'));
    document.head.appendChild(script);
  });
  return loadPromise;
}

/**
 * Typeset any `$…$` / `$$…$$` math inside `el`. Best-effort: if MathJax fails to
 * load, the raw TeX text is left in place (non-fatal for the viewer).
 */
export async function typesetMath(el: HTMLElement): Promise<void> {
  try {
    await ensureMathJax();
    const mj = window.MathJax;
    if (mj?.typesetPromise) {
      mj.typesetClear?.([el]);
      await mj.typesetPromise([el]);
    }
  } catch {
    /* leave raw TeX; viewer remains usable */
  }
}
