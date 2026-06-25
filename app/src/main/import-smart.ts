/**
 * Drop-a-PDF → entry orchestration (the testable core of `importFilesSmart`).
 *
 * For each dropped PDF we read its first pages and look for an identifier — a DOI
 * first, then an arXiv id — and decide one of three outcomes:
 *   - `linked`:  the library already has that paper → attach the PDF to the
 *                existing entry (deduped by basename), don't duplicate it;
 *   - `created`: look the identifier up (CrossRef for a DOI, arXiv for an arXiv id),
 *                import the real metadata, and attach the PDF;
 *   - `stub`:    no identifier, or the lookup missed → fall back to a filename stub.
 *
 * All electron / network / store coupling is injected via {@link SmartPdfDeps}, so
 * the branch logic + the `summary` counts can be unit-tested with fakes. The thin
 * electron wiring lives in `index.ts`.
 */

import type { OnlineResult } from '@bibdesk/shared';

export interface SmartPdfDeps {
  /** Extract text from the first `pages` pages of a PDF (for identifier sniffing). */
  extractText(pdf: string, pages: number): Promise<string>;
  /** Find a DOI in the extracted text, or null. */
  extractDoi(text: string): string | null;
  /** Find an arXiv id in the extracted text, or null. */
  extractArxivId(text: string): string | null;
  /** Existing item whose DOI / arXiv id matches, or null (dedup). */
  findExisting(ids: { doi: string | null; arxivId: string | null }): string | null;
  /** Lower-cased basenames of an item's attachments (skip a re-dropped PDF). */
  attachmentNames(itemId: string): string[];
  /** Attach `pdf` to `itemId` (AutoFiled by the store when enabled). */
  addAttachment(itemId: string, pdf: string): void;
  /** Look up a DOI (CrossRef). Rejection is treated as "no result". */
  lookupDoi(doi: string): Promise<OnlineResult[]>;
  /** Look up an arXiv id. Rejection is treated as "no result". */
  lookupArxiv(id: string): Promise<OnlineResult[]>;
  /** Create an entry from looked-up metadata; returns the new item id, or null. */
  importEntry(entryType: string, fields: Record<string, string>): string | null;
  /** Fallback: import `pdf` as a filename-stub entry. */
  importStub(pdf: string): { addedIds: string[]; warnings: string[] };
}

export interface SmartPdfResult {
  /** Newly added / linked item ids (for selection). */
  addedIds: string[];
  /** Non-fatal messages from stub fallbacks. */
  warnings: string[];
  /** Per-PDF outcome counts, for the renderer's result notice. */
  summary: { created: number; linked: number; stub: number };
}

/** Lower-cased basename of a path (handles `/` and `\`). */
function baseOf(p: string): string {
  return (p.replace(/\\/g, '/').split('/').pop() ?? p).toLowerCase();
}

/** Run the drop-a-PDF pipeline over `pdfs`. See the module doc for the outcomes. */
export async function importPdfsSmart(
  pdfs: readonly string[],
  deps: SmartPdfDeps,
): Promise<SmartPdfResult> {
  const addedIds: string[] = [];
  const warnings: string[] = [];
  let created = 0;
  let linked = 0;
  let stub = 0;

  for (const pdf of pdfs) {
    let handled = false;
    try {
      const text = await deps.extractText(pdf, 3); // first pages (incl. the arXiv watermark)
      const doi = deps.extractDoi(text);
      const arxivId = doi ? null : deps.extractArxivId(text);
      if (doi || arxivId) {
        const existing = deps.findExisting({ doi, arxivId });
        if (existing) {
          if (!deps.attachmentNames(existing).includes(baseOf(pdf))) deps.addAttachment(existing, pdf);
          addedIds.push(existing);
          linked++;
          handled = true;
        } else {
          const results = doi
            ? await deps.lookupDoi(doi).catch(() => [])
            : await deps.lookupArxiv(arxivId!).catch(() => []);
          const r = results[0];
          if (r) {
            const id = deps.importEntry(r.entryType, r.fields);
            if (id) {
              deps.addAttachment(id, pdf);
              addedIds.push(id);
              created++;
              handled = true;
            }
          }
        }
      }
    } catch {
      /* fall through to the stub import below */
    }
    if (!handled) {
      const r = deps.importStub(pdf);
      addedIds.push(...r.addedIds);
      warnings.push(...r.warnings);
      if (r.addedIds.length) stub++;
    }
  }

  return { addedIds, warnings, summary: { created, linked, stub } };
}
