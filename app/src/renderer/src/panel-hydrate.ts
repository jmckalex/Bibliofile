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

function openExternal(target: string, kind: 'url' | 'file'): void {
  void window.bibdesk?.openExternal({ target, kind });
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
    b.innerHTML = '<span class="bd-file__icon" aria-hidden="true">📄</span>';
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

/** Wire a hydrated panel root; returns a cleanup function. */
export function hydratePanel(root: HTMLElement): () => void {
  const onClick = (e: MouseEvent): void => {
    const t = e.target as HTMLElement;
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
      void getStore().getState().selectByCiteKey(cite.dataset.cite);
      return;
    }
    const files = t.closest<HTMLElement>('[data-open-files]');
    if (files) {
      e.preventDefault();
      openFilesMenu(files);
      return;
    }
    const action = t.closest<HTMLElement>('[data-action]');
    if (action?.dataset.action === 'edit') {
      e.preventDefault();
      const id = getStore().getState().detail?.id;
      if (id) getStore().getState().openEditor(id);
    }
  };
  root.addEventListener('click', onClick);
  // Typeset static math (field values, notes, preview/abstract). bd-citation
  // typesets its own (async) content separately.
  if (hasMath(root.textContent ?? '')) void typesetMath(root);
  return () => root.removeEventListener('click', onClick);
}
