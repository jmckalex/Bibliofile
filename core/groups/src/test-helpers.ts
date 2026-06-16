/**
 * Test-only helpers: build real `@bibdesk/model` `BibItem`s as `EvaluableItem`s.
 * Not part of the public API (no `.test.ts` suffix so it isn't run as a suite,
 * but excluded from exports).
 */
import {
  createBibItem,
  localFile,
  remoteURL,
  sharedTypeManager,
  type BibItem,
} from '@bibdesk/model';
import type { EvaluableItem } from './condition.js';

export interface MakeItemInit {
  citeKey?: string;
  type?: string;
  fields?: Record<string, string>;
  localFiles?: string[];
  remoteURLs?: string[];
  dateAdded?: string;
  dateModified?: string;
}

/** Build a `BibItem` (which structurally satisfies {@link EvaluableItem}). */
export function makeItem(init: MakeItemInit = {}): BibItem & EvaluableItem {
  const files = [
    ...(init.localFiles ?? []).map((p) => localFile(p)),
    ...(init.remoteURLs ?? []).map((u) => remoteURL(u)),
  ];
  const item = createBibItem(
    {
      citeKey: init.citeKey ?? 'key1',
      type: init.type ?? 'article',
      fields: init.fields ?? {},
      files,
      dateAdded: init.dateAdded,
      dateModified: init.dateModified,
    },
    sharedTypeManager,
  );
  return item as BibItem & EvaluableItem;
}

export { localFile, remoteURL };
