/**
 * Custom elements ("web components") for the detail/panel rendering.
 *
 * These let a Handlebars-rendered HTML string (built in main, see Phase 3) carry
 * live, async widgets: when the renderer drops the string into the DOM the browser
 * upgrades these tags, and each element fetches + renders ITSELF via window.bibdesk.
 * Only the bits that need their own async lifecycle live here — the journal cover
 * and the CSL citation. Plain interactivity (open url/file, cite cross-refs, the
 * multi-file popup) is a single delegated click handler elsewhere (hydratePanel).
 *
 * Each element mirrors, markup-for-markup, the React primitive it replaces
 * (JournalCover/GeneratedCover and CitationBlock in DetailPane.tsx), so the
 * template-driven pane is visually identical to the legacy React pane.
 *
 * Importing this module for its side effect registers the elements once.
 */
import { CITATION_STYLES } from '@bibdesk/shared';
import { typesetMath, hasMath } from './mathjax.js';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Initials + a name-derived hue, mirroring DetailPane's GeneratedCover fallback. */
function generatedCover(journal: string): string {
  const hue = [...journal].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const abbr =
    journal
      .split(/\s+/)
      .filter((w) => /^[A-Za-z]/.test(w) && !/^(the|of|and|a|in|for)$/i.test(w))
      .map((w) => w[0])
      .join('')
      .slice(0, 4)
      .toUpperCase() || journal.slice(0, 3).toUpperCase();
  return `<div class="bd-jcover bd-jcover--gen" style="background: hsl(${hue} 42% 34%)" title="${escapeHtml(
    journal,
  )}"><span>${escapeHtml(abbr)}</span></div>`;
}

/**
 * Downsize a dropped image to a thumbnail (≤ maxPx on the long edge) and re-encode
 * as JPEG, so a multi-megabyte drop becomes a small cover. Returns null if the file
 * isn't a decodable image.
 */
async function downsizeImage(
  file: File,
  maxPx = 512,
  quality = 0.85,
): Promise<{ data: Uint8Array; ext: string } | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) return null;
  return { data: new Uint8Array(await blob.arrayBuffer()), ext: 'jpg' };
}

/** <bd-journal-cover doc-id item-id> — the entry's cover image, or a generated fallback.
 *  Also a drop target: dropping an image sets that journal's cover (downsized). */
class BdJournalCover extends HTMLElement {
  static readonly observedAttributes = ['doc-id', 'item-id'];
  private objectUrl?: string;
  // Bumped on every render(); a stale async result whose token no longer matches
  // is discarded, so overlapping renders can't fight or leak object URLs.
  private token = 0;

  connectedCallback(): void {
    this.addEventListener('dragenter', this.onDragEnter);
    this.addEventListener('dragover', this.onDragOver);
    this.addEventListener('dragleave', this.onDragLeave);
    this.addEventListener('drop', this.onDrop);
    void this.render();
  }
  attributeChangedCallback(): void {
    if (this.isConnected) void this.render();
  }
  disconnectedCallback(): void {
    this.removeEventListener('dragenter', this.onDragEnter);
    this.removeEventListener('dragover', this.onDragOver);
    this.removeEventListener('dragleave', this.onDragLeave);
    this.removeEventListener('drop', this.onDrop);
    this.revoke();
  }

  // stopPropagation on every drag event keeps the cover's drag interaction out of
  // the window-level import-overlay handler in App.tsx — otherwise the library
  // "drop a .bib" overlay shows over the cover and, because our drop stops the
  // event, the window never resets its dragging state (the overlay sticks).
  private readonly onDragEnter = (e: DragEvent): void => {
    e.stopPropagation();
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      this.classList.add('bd-jcover-drop');
    }
  };
  private readonly onDragOver = (e: DragEvent): void => {
    e.stopPropagation();
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this.classList.add('bd-jcover-drop');
    }
  };
  private readonly onDragLeave = (e: DragEvent): void => {
    e.stopPropagation();
    this.classList.remove('bd-jcover-drop');
  };
  private readonly onDrop = (e: DragEvent): void => {
    e.stopPropagation();
    this.classList.remove('bd-jcover-drop');
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    void this.applyDroppedCover(file);
  };

  private async applyDroppedCover(file: File): Promise<void> {
    const documentId = this.getAttribute('doc-id');
    const itemId = this.getAttribute('item-id');
    if (!documentId || !itemId) return;
    const img = await downsizeImage(file);
    if (!img) return;
    const res = await window.bibdesk?.setJournalCover({ documentId, itemId, data: img.data, ext: img.ext });
    // The originating window isn't notified by the cross-window broadcast, so
    // re-render this element directly to pick up the new cover.
    if (res?.ok) void this.render();
  }

  private revoke(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = undefined;
    }
  }

  private async render(): Promise<void> {
    const documentId = this.getAttribute('doc-id');
    const itemId = this.getAttribute('item-id');
    const token = ++this.token;
    this.revoke();
    if (!documentId || !itemId) {
      this.innerHTML = '';
      return;
    }
    const res = await window.bibdesk?.journalCover({ documentId, itemId });
    if (token !== this.token) return; // a newer render superseded this one
    if (!res) return;
    if (res.data) {
      this.objectUrl = URL.createObjectURL(new Blob([res.data as BlobPart]));
      const title = res.journal ?? '';
      this.innerHTML = `<div class="bd-jcover" title="${escapeHtml(title)}"><img src="${
        this.objectUrl
      }" alt="${escapeHtml(title ? `${title} cover` : 'journal cover')}" /></div>`;
    } else if (res.journal) {
      this.innerHTML = generatedCover(res.journal);
    } else {
      this.innerHTML = '';
    }
  }
}

/** <bd-citation doc-id item-id cite-style> — the CSL-formatted citation (async), with MathJax.
 *  Uses `cite-style` (not `style`, which is the reserved HTML attribute). */
class BdCitation extends HTMLElement {
  static readonly observedAttributes = ['doc-id', 'item-id', 'cite-style'];
  // Bumped on every render(); only the latest render's async result is applied,
  // so overlapping formatCitation calls can't each append a body (the duplicate-
  // citation bug). `lastKey` skips redundant work when nothing relevant changed —
  // React + StrictMode can connect/re-render this element several times per
  // selection, and without this each one fires a fresh (identical) IPC call.
  private token = 0;
  private lastKey: string | null = null;

  connectedCallback(): void {
    void this.render();
  }
  attributeChangedCallback(): void {
    if (this.isConnected) void this.render();
  }

  private async render(): Promise<void> {
    const documentId = this.getAttribute('doc-id');
    const itemId = this.getAttribute('item-id');
    const styleId = this.getAttribute('cite-style') || 'apa';
    const key = `${documentId} ${itemId} ${styleId}`;
    if (key === this.lastKey) return; // same entry/style already rendered — nothing to do
    this.lastKey = key;
    const token = ++this.token;
    const styleLabel = CITATION_STYLES.find((s) => s.id === styleId)?.label ?? styleId;
    // Header renders immediately; the body fills in after the async format.
    this.innerHTML = `<div class="bd-cite"><div class="bd-cite__head"><span class="bd-detail__section bd-detail__section--inline">Citation</span><span class="bd-cite__stylename" title="Set the citation style in Preferences">${escapeHtml(
      styleLabel,
    )}</span></div></div>`;
    if (!documentId || !itemId) return;
    const res = await window.bibdesk?.formatCitation({ documentId, itemId, styleId });
    if (token !== this.token) return; // a newer render superseded this one
    if (!res?.html) return;
    const cite = this.querySelector('.bd-cite');
    if (!cite) return;
    cite.querySelector('.bd-cite__body')?.remove(); // replace, never stack
    const body = document.createElement('div');
    body.className = 'bd-cite__body';
    body.innerHTML = res.html;
    cite.appendChild(body);
    if (hasMath(res.html)) void typesetMath(body);
  }
}

let registered = false;
/** Register the custom elements once (idempotent). */
export function registerBdElements(): void {
  if (registered || typeof customElements === 'undefined') return;
  registered = true;
  if (!customElements.get('bd-journal-cover')) customElements.define('bd-journal-cover', BdJournalCover);
  if (!customElements.get('bd-citation')) customElements.define('bd-citation', BdCitation);
}
