/**
 * Renderer ambient types: Vite `?url` asset imports + the MathJax global the
 * tex-svg bundle attaches to `window`.
 */

declare module '*?url' {
  const url: string;
  export default url;
}

interface MathJaxApi {
  startup?: { promise?: Promise<unknown>; typeset?: boolean };
  typesetPromise?: (elements?: unknown[]) => Promise<void>;
  typesetClear?: (elements?: unknown[]) => void;
  tex?: unknown;
  svg?: unknown;
  [key: string]: unknown;
}

interface Window {
  MathJax?: MathJaxApi;
}
