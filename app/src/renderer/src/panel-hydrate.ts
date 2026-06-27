/**
 * Hydrate a template-rendered detail/panel HTML string: wire the `data-*` click
 * actions (open url/file, cite cross-ref, Edit, the multi-file popup) with one
 * delegated listener, and run a MathJax pass over the static math. The async
 * `bd-*` custom elements (cover, citation) hydrate themselves.
 *
 * This is the renderer counterpart to `app/src/main/panel.ts`.
 */
import { getStore } from './store.js';
import { typesetMath, hasMath } from './mathjax.js';
import { renderPdfThumbnail } from './pdfjs.js';
import { panelIconSvg } from '../../icon-svg.js';

function openExternal(target: string, kind: 'url' | 'file'): void {
  void window.bibdesk?.openExternal({ target, kind });
}

// --- Tabs (generic template engine support) --------------------------------
// A template emits `<div class="bd-tabs">` with `.bd-tab[data-tab="key"]` buttons
// and matching `[data-tabpanel="key"]` panels. Clicking a tab shows its panel.

/** Show the panel/button keyed `key` within one `.bd-tabs` group, hide the rest. */
function activateTab(tabs: HTMLElement, key: string): void {
  for (const b of tabs.querySelectorAll<HTMLElement>('.bd-tab[data-tab]'))
    b.classList.toggle('bd-tab--active', b.dataset.tab === key);
  for (const p of tabs.querySelectorAll<HTMLElement>('[data-tabpanel]'))
    p.classList.toggle('bd-tab__panel--active', p.dataset.tabpanel === key);
}

/** Ensure each tab group starts with exactly one active tab (the marked one, or
 *  the first). Scoped queries so nested groups don't clobber each other. */
function initTabs(root: HTMLElement): void {
  for (const tabs of root.querySelectorAll<HTMLElement>('.bd-tabs')) {
    const buttons = tabs.querySelectorAll<HTMLElement>('.bd-tab[data-tab]');
    if (buttons.length === 0) continue;
    const marked = tabs.querySelector<HTMLElement>('.bd-tab--active[data-tab]');
    activateTab(tabs, (marked ?? buttons[0]!).dataset.tab ?? '');
  }
}

// --- Attachment thumbnails -------------------------------------------------
// A template emits `<figure class="bd-thumb" data-thumb data-file="<url>">` with
// a `.bd-thumb__img` slot (icon fallback). We replace the slot with a real image
// (PDF first page or picture file) read via the readAttachment IPC.

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

/** Lower-cased file extension of a path/url (no leading dot), or ''. */
function extOf(pathOrUrl: string): string {
  const base = pathOrUrl.split(/[?#]/)[0]!.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Fill any `[data-thumb]` tiles with real previews. Object URLs created here are
 *  pushed onto `revoke` so the caller can release them on cleanup. */
async function fillThumbnails(root: HTMLElement, revoke: string[]): Promise<void> {
  const thumbs = [...root.querySelectorAll<HTMLElement>('[data-thumb][data-file]')];
  if (thumbs.length === 0 || !window.bibdesk) return;
  const { documentId, detail } = getStore().getState();
  const itemId = detail?.id;
  if (!documentId || !itemId) return;
  for (const el of thumbs) {
    const url = el.dataset.file;
    if (!url) continue;
    const ext = extOf(url);
    const mime = IMAGE_MIME[ext];
    if (!mime && ext !== 'pdf') continue; // unknown type → keep the icon fallback
    try {
      const res = await window.bibdesk.readAttachment({ documentId, itemId, url });
      if (!res.data || !el.isConnected) continue;
      const slot = el.querySelector<HTMLElement>('.bd-thumb__img') ?? el;
      if (mime) {
        // Copy into a fresh Uint8Array (a BlobPart over a plain ArrayBuffer); the
        // IPC's bytes may be backed by a shared buffer that Blob() won't accept.
        const blobUrl = URL.createObjectURL(new Blob([new Uint8Array(res.data)], { type: mime }));
        revoke.push(blobUrl);
        const img = document.createElement('img');
        img.className = 'bd-thumb__pic';
        img.alt = '';
        img.src = blobUrl;
        slot.replaceChildren(img);
      } else {
        const canvas = await renderPdfThumbnail(res.data, 320);
        if (canvas && el.isConnected) {
          canvas.classList.add('bd-thumb__pic');
          // Drop the renderer's inline CSS size so the tile's `.bd-thumb__pic`
          // (width:100% + object-fit) scales the hi-res buffer to fit, not 320px.
          canvas.style.width = '';
          canvas.style.height = '';
          slot.replaceChildren(canvas);
        }
      }
    } catch {
      /* leave the icon fallback in place */
    }
  }
}

/** A small popup of the entry's file attachments, mirroring PreviewCard's menu. */
function openFilesMenu(anchor: HTMLElement): void {
  const files = (getStore().getState().detail?.files ?? []).filter((f) => f.kind === 'file');
  if (files.length === 0) return;
  if (files.length === 1) {
    openExternal(files[0]!.url, 'file');
    return;
  }
  const menu = document.createElement('div');
  menu.className = 'bd-filemenu';
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${r.left}px`;
  menu.style.top = `${r.bottom + 2}px`;
  const close = (): void => {
    menu.remove();
    window.removeEventListener('mousedown', onOutside);
    window.removeEventListener('keydown', onKey);
  };
  const onOutside = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  for (const f of files) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bd-filemenu__item';
    b.innerHTML = `<span class="bd-file__icon" aria-hidden="true">${panelIconSvg('file')}</span>`;
    b.appendChild(document.createTextNode(f.displayName));
    b.addEventListener('click', () => {
      openExternal(f.url, 'file');
      close();
    });
    menu.appendChild(b);
  }
  menu.addEventListener('mousedown', (e) => e.stopPropagation());
  document.body.appendChild(menu);
  // Defer wiring the dismiss listeners so the opening click doesn't close it.
  setTimeout(() => {
    window.addEventListener('mousedown', onOutside);
    window.addEventListener('keydown', onKey);
  }, 0);
}

/**
 * Overlay a delete (✕) button on each attachment thumbnail whose `Bdsk-File-N`
 * field we can resolve from the open detail (matching the figure's `data-file`
 * against the attachment URLs). Lets the bottom panel remove an attachment in
 * place. Skips thumbnails with no resolvable field (e.g. a custom template).
 */
function addThumbDeleteButtons(root: HTMLElement): void {
  const detail = getStore().getState().detail;
  if (!detail) return;
  const fieldByUrl = new Map(
    detail.files
      .filter((f) => f.kind === 'file' && f.field)
      .map((f) => [f.url, f.field as string]),
  );
  if (fieldByUrl.size === 0) return;
  for (const fig of root.querySelectorAll<HTMLElement>('[data-thumb][data-file]')) {
    if (fig.querySelector('.bd-thumb__del')) continue; // already added
    const field = fig.dataset.file ? fieldByUrl.get(fig.dataset.file) : undefined;
    if (!field) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bd-thumb__del';
    btn.dataset.removeThumb = field;
    btn.title = 'Remove attachment';
    btn.setAttribute('aria-label', 'Remove attachment');
    btn.textContent = '×'; // ×
    fig.appendChild(btn);
  }
}

/** Wire a hydrated panel root; returns a cleanup function. */
export function hydratePanel(root: HTMLElement): () => void {
  const onClick = (e: MouseEvent): void => {
    const t = e.target as HTMLElement;
    // Delete an attachment from its thumbnail (the red ✕ overlay).
    const del = t.closest<HTMLElement>('[data-remove-thumb]');
    if (del?.dataset.removeThumb) {
      e.preventDefault();
      e.stopPropagation();
      const id = getStore().getState().detail?.id;
      if (id) void getStore().getState().removeAttachment(id, del.dataset.removeThumb);
      return;
    }
    const url = t.closest<HTMLElement>('[data-open-url]');
    if (url?.dataset.openUrl) {
      e.preventDefault();
      openExternal(url.dataset.openUrl, 'url');
      return;
    }
    const file = t.closest<HTMLElement>('[data-open-file]');
    if (file?.dataset.openFile) {
      e.preventDefault();
      openExternal(file.dataset.openFile, 'file');
      return;
    }
    const cite = t.closest<HTMLElement>('[data-cite]');
    if (cite?.dataset.cite) {
      e.preventDefault();
      // data-cite may carry several keys (a `\cite{a,b}`): select them all.
      const keys = cite.dataset.cite.split(',').map((k) => k.trim()).filter(Boolean);
      void getStore().getState().selectByCiteKeys(keys);
      return;
    }
    const files = t.closest<HTMLElement>('[data-open-files]');
    if (files) {
      e.preventDefault();
      openFilesMenu(files);
      return;
    }
    const tab = t.closest<HTMLElement>('.bd-tab[data-tab]');
    if (tab?.dataset.tab) {
      const tabs = tab.closest<HTMLElement>('.bd-tabs');
      if (tabs) {
        e.preventDefault();
        activateTab(tabs, tab.dataset.tab);
        return;
      }
    }
    const action = t.closest<HTMLElement>('[data-action]');
    if (action?.dataset.action === 'edit') {
      e.preventDefault();
      const id = getStore().getState().detail?.id;
      if (id) getStore().getState().openEditor(id);
    }
  };
  // Attachment thumbnails open in the native app on double-click.
  const onDblClick = (e: MouseEvent): void => {
    const thumb = (e.target as HTMLElement).closest<HTMLElement>('[data-thumb][data-file]');
    if (thumb?.dataset.file) {
      e.preventDefault();
      openExternal(thumb.dataset.file, 'file');
    }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('dblclick', onDblClick);
  initTabs(root);
  addThumbDeleteButtons(root);
  const revoke: string[] = [];
  void fillThumbnails(root, revoke);
  // Typeset static math (field values, notes, preview/abstract). bd-citation
  // typesets its own (async) content separately.
  if (hasMath(root.textContent ?? '')) void typesetMath(root);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('dblclick', onDblClick);
    for (const u of revoke) URL.revokeObjectURL(u);
  };
}
