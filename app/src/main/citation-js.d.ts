/**
 * Minimal ambient types for citation-js (ships no .d.ts). We only use the `Cite`
 * constructor + `.format(...)`; the CSL plugin is a side-effect import.
 */
declare module '@citation-js/core' {
  export class Cite {
    constructor(data: unknown);
    format(type: string, options?: Record<string, unknown>): string;
  }
  /** Plugin registry; `config.get('@csl').templates` is the CSL template store. */
  export const plugins: {
    config: {
      get(namespace: string): {
        templates: { add(id: string, xml: string): void; has(id: string): boolean };
      };
    };
  };
}

declare module '@citation-js/plugin-csl';
