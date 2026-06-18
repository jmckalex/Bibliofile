/**
 * Color labels end-to-end through DocumentStore: setItemColor stores the
 * BibDesk-compatible `Bdsk-Color` index, surfaces a hex on the row, hides the
 * raw field from the editor, clears on null, and is one undo step.
 */
import { describe, it, expect } from 'vitest';
import { LABEL_COLORS } from '@bibdesk/model';
import { DocumentStore } from './document-service.js';

function open() {
  const store = new DocumentStore();
  const { documentId } = store.openText(
    '@article{a, Title={A}}\n@book{b, Title={B}}',
    '/tmp/colors.bib',
  );
  const rows = store.listPublications({ documentId, offset: 0, limit: -1 }).rows;
  return { store, documentId, rows };
}
const colorOf = (store: DocumentStore, documentId: string, citeKey: string): string | undefined =>
  store
    .listPublications({ documentId, offset: 0, limit: -1 })
    .rows.find((r) => r.citeKey === citeKey)?.color;

describe('setItemColor', () => {
  it('sets a palette color (BibDesk index) and exposes its hex on the row', () => {
    const { store, documentId, rows } = open();
    const res = store.setItemColor(documentId, rows.map((r) => r.id), 3); // 3 = Yellow
    expect(res.count).toBe(2);
    expect(colorOf(store, documentId, 'a')).toBe(LABEL_COLORS[2]!.hex);
    expect(colorOf(store, documentId, 'b')).toBe(LABEL_COLORS[2]!.hex);
  });

  it('does not surface Bdsk-Color as a raw editor field', () => {
    const { store, documentId, rows } = open();
    store.setItemColor(documentId, [rows[0]!.id], 5);
    const detail = store.getItemDetail({ documentId, itemId: rows[0]!.id });
    expect(detail.fields.some((f) => f.name.toLowerCase() === 'bdsk-color')).toBe(false);
  });

  it('clears the color when given null, and one undo restores the batch', () => {
    const { store, documentId, rows } = open();
    store.setItemColor(documentId, rows.map((r) => r.id), 1); // Red on both
    expect(colorOf(store, documentId, 'a')).toBe(LABEL_COLORS[0]!.hex);

    store.setItemColor(documentId, [rows[0]!.id], null); // clear 'a'
    expect(colorOf(store, documentId, 'a')).toBeUndefined();
    expect(colorOf(store, documentId, 'b')).toBe(LABEL_COLORS[0]!.hex); // untouched

    store.undo(documentId); // undo the clear
    expect(colorOf(store, documentId, 'a')).toBe(LABEL_COLORS[0]!.hex);
  });
});
