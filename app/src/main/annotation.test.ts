/**
 * Annotation codec + end-to-end storage safety. The key guarantee: a markdown
 * annotation with unbalanced braces must survive serialize → reopen without
 * corrupting the `.bib`, in both storage modes.
 */
import { describe, it, expect } from 'vitest';
import {
  encodeCompressed,
  decodeCompressed,
  encodeReadable,
  decodeReadable,
} from './annotation.js';
import { DocumentStore } from './document-service.js';

// Markdown that breaks naive `{value}` wrapping: unbalanced braces, percent, etc.
const TRICKY = [
  'Plain note.',
  'Unbalanced: function f() { return 1; }} extra close brace',
  'A lone close brace } at the end',
  '50% done; see {braces} and a single open {',
  '# Heading\n\n- `code {x}`\n\n$E = mc^2$ and a stray }',
  'Unicode: café — naïve “quotes” 🎉 — emoji ✅',
  '',
];

describe('annotation codec — compressed (lz-string → base64)', () => {
  for (const md of TRICKY) {
    it(`round-trips ${JSON.stringify(md).slice(0, 36)}…`, () => {
      const enc = encodeCompressed(md);
      expect(enc).not.toMatch(/[{}%]/); // base64 alphabet is brace/percent-safe
      expect(decodeCompressed(enc)).toBe(md);
    });
  }
  it('emits a single line (like Bdsk-File-N) and still decodes if reflowed', () => {
    const enc = encodeCompressed('y'.repeat(4000));
    expect(enc).not.toContain('\n'); // one line, no awkward unindented wrapping
    // even if a parser inserts whitespace/newlines, decode strips it
    expect(decodeCompressed(`  ${enc.replace(/(.{40})/g, '$1\n  ')}\n`)).toBe('y'.repeat(4000));
  });
  it('decodes empty / garbage safely', () => {
    expect(decodeCompressed('')).toBe('');
    expect(decodeCompressed('   ')).toBe('');
  });
});

describe('annotation codec — readable (restricted %{} escape)', () => {
  for (const md of TRICKY) {
    it(`round-trips ${JSON.stringify(md).slice(0, 36)}…`, () => {
      const enc = encodeReadable(md);
      expect(enc).not.toMatch(/[{}]/); // no literal braces ⇒ the .bib value stays balanced
      expect(decodeReadable(enc)).toBe(md);
    });
  }
  it('decodeReadable is a no-op on plain / foreign text', () => {
    expect(decodeReadable('50% done, see http://x/y')).toBe('50% done, see http://x/y');
    expect(decodeReadable('plain BibDesk note')).toBe('plain BibDesk note');
  });
});

describe('annotation storage — end-to-end through DocumentStore', () => {
  const NOTE = 'Note with an unbalanced brace } plus 50% and {nested {braces}} and `code {}`.';

  function roundTrip(mode: 'compressed' | 'readable'): string {
    const store = new DocumentStore();
    store.setEditConfig({ annotationStorage: mode });
    const { documentId } = store.openText('@article{a, Title = {A}}', '/tmp/ann.bib');
    const id = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!.id;
    store.applyEdit({ documentId, command: { kind: 'setField', itemId: id, field: 'Annote', value: NOTE } });
    // The detail pane sees the decoded markdown, regardless of storage form.
    expect(store.getItemDetail({ documentId, itemId: id }).notesRaw).toBe(NOTE);

    // Serialize → reopen as a fresh store: the note must survive intact, which it
    // can only do if the .bib didn't get corrupted by the stray braces.
    const text = store.serializeDocument(documentId);
    const reopened = new DocumentStore();
    const { documentId: d2 } = reopened.openText(text, '/tmp/ann.bib');
    const id2 = reopened.listPublications({ documentId: d2, offset: 0, limit: -1 }).rows[0]!.id;
    expect(reopened.getItemDetail({ documentId: d2, itemId: id2 }).notesRaw).toBe(NOTE);
    return text;
  }

  it('compressed mode survives a stray-brace note; standard Annote stays clean', () => {
    const text = roundTrip('compressed').toLowerCase();
    expect(text).toContain('bdsk-annotation'); // stored in the private blob field
    expect(text).not.toMatch(/(^|[^-])annote\s*=/); // not in the standard Annote field
  });

  it('readable mode survives a stray-brace note, in the standard Annote field', () => {
    const text = roundTrip('readable').toLowerCase();
    expect(text).toMatch(/(^|[^-])annote\s*=/);
    expect(text).not.toContain('bdsk-annotation');
  });

  it('reads a plain foreign Annote (no special storage) as-is', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Annote = {Plain BibDesk note.}}', '/tmp/f.bib');
    const id = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!.id;
    expect(store.getItemDetail({ documentId, itemId: id }).notesRaw).toBe('Plain BibDesk note.');
  });

  it('clearing the note removes both annotation fields', () => {
    const store = new DocumentStore();
    const { documentId } = store.openText('@article{a, Title = {A}}', '/tmp/c.bib');
    const id = store.listPublications({ documentId, offset: 0, limit: -1 }).rows[0]!.id;
    store.applyEdit({ documentId, command: { kind: 'setField', itemId: id, field: 'Annote', value: 'temp }' } });
    store.applyEdit({ documentId, command: { kind: 'setField', itemId: id, field: 'Annote', value: '' } });
    const text = store.serializeDocument(documentId).toLowerCase();
    expect(text).not.toContain('bdsk-annotation');
    expect(text).not.toMatch(/(^|[^-])annote\s*=/);
  });
});
