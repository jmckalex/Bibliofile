/**
 * Minimal ambient types for citation-js (ships no .d.ts). We only use the `Cite`
 * constructor + `.format(...)`; the CSL plugin is a side-effect import.
 */
declare module '@citation-js/core' {
  export class Cite {
    constructor(data: unknown);
    format(type: string, options?: Record<string, unknown>): string;
  }
}

declare module '@citation-js/plugin-csl';
