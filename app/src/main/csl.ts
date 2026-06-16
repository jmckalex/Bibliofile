/**
 * CSL formatted-citation rendering via citation-js (citeproc-js engine + bundled
 * CSL styles + en-US locale, all offline). Runs in the MAIN process. The
 * BibItem→CSL-JSON mapping lives in document-service (pure/testable); this module
 * only turns CSL-JSON into a styled HTML string.
 *
 * NOTE: citation-js bundles citeproc-js, which is AGPL/CPAL — accepted by the
 * user as the single non-permissive dependency (see BUILD-LOG "Stage 7").
 */

import { Cite } from '@citation-js/core';
import '@citation-js/plugin-csl';

/** Format one CSL-JSON item as an HTML bibliography entry in the given style. */
export function formatCitation(cslItem: Record<string, unknown>, styleId: string): string {
  const cite = new Cite([cslItem]);
  return cite.format('bibliography', {
    format: 'html',
    template: styleId || 'apa',
    lang: 'en-US',
  }) as string;
}
