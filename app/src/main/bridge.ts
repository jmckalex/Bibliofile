/**
 * Local automation **bridge** — a loopback (127.0.0.1), token-authed JSON command
 * surface that external scripting can call. AppleScript/shell can hit it directly
 * (`curl`), and the planned native helper apps (macOS `.sdef`, Windows, Linux)
 * are thin translators that forward system scripting to it. Unlike the one-way
 * `x-bibdesk://` URL scheme, the bridge returns DATA, so it supports queries.
 *
 * This module is the pure request DISPATCHER (unit-tested); `index.ts` owns the
 * HTTP server, the token, and the `bridge.json` discovery file under userData.
 */

import type { DocumentStore } from './document-service.js';

/** A parsed bridge request: a method name + string params (from the query). */
export interface BridgeRequest {
  readonly method: string;
  readonly params: Readonly<Record<string, string>>;
}

/** A bridge response. `mutated` tells the host to refresh the renderer. */
export interface BridgeResponse {
  readonly ok: boolean;
  readonly mutated?: boolean;
  readonly error?: string;
  readonly [key: string]: unknown;
}

/** The methods the bridge exposes (for discovery / docs). */
export const BRIDGE_METHODS = ['ping', 'list', 'get', 'search', 'export', 'add', 'set'] as const;

/**
 * Dispatch one bridge request against the open document. Pure except for the
 * `store` mutations in `add`/`set` (which set `mutated` so the caller refreshes).
 */
export function dispatchBridge(
  store: DocumentStore,
  documentId: string | null,
  req: BridgeRequest,
): BridgeResponse {
  if (req.method === 'ping') return { ok: true, methods: [...BRIDGE_METHODS] };
  if (!documentId) return { ok: false, error: 'No document is open.' };

  switch (req.method) {
    case 'list': {
      const rows = store.listPublications({ documentId, offset: 0, limit: -1 }).rows;
      return {
        ok: true,
        entries: rows.map((r) => ({ citeKey: r.citeKey, title: r.title, type: r.type, year: r.year })),
      };
    }
    case 'get': {
      const id = store.itemIdForCiteKey(documentId, req.params.citeKey ?? '');
      if (!id) return { ok: false, error: `No entry with cite key "${req.params.citeKey ?? ''}".` };
      const d = store.getItemDetail({ documentId, itemId: id });
      return {
        ok: true,
        entry: {
          citeKey: d.citeKey,
          type: d.type,
          fields: Object.fromEntries(d.fields.map((f) => [f.name, f.rawValue])),
        },
      };
    }
    case 'search': {
      const q = (req.params.q ?? '').toLowerCase();
      const rows = store.listPublications({ documentId, offset: 0, limit: -1 }).rows.filter((r) =>
        [r.citeKey, r.title, r.authorsDisplay, r.year].some((v) => v.toLowerCase().includes(q)),
      );
      return { ok: true, entries: rows.map((r) => ({ citeKey: r.citeKey, title: r.title })) };
    }
    case 'export': {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { ok: true, text: store.exportText(documentId, (req.params.format ?? 'bibtex') as any) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    case 'add': {
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.params)) if (k.toLowerCase() !== 'type') fields[k] = v;
      const res = store.importEntry(documentId, req.params.type || 'misc', fields);
      const citeKey = res.affectedItemId
        ? store.getItemDetail({ documentId, itemId: res.affectedItemId }).citeKey
        : undefined;
      return { ok: true, mutated: true, ...(citeKey ? { citeKey } : {}) };
    }
    case 'set': {
      const id = store.itemIdForCiteKey(documentId, req.params.citeKey ?? '');
      if (!id) return { ok: false, error: `No entry with cite key "${req.params.citeKey ?? ''}".` };
      store.applyEdit({
        documentId,
        command: { kind: 'setField', itemId: id, field: req.params.field ?? '', value: req.params.value ?? '' },
      });
      return { ok: true, mutated: true };
    }
    default:
      return { ok: false, error: `Unknown method "${req.method}".` };
  }
}
