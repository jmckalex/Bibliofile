/**
 * Tiny pure runtime type guards for DTOs that cross the IPC boundary. Useful for
 * defensive validation in the preload/renderer (where payloads arrive as `unknown`
 * after structured clone). Intentionally shallow — they check the discriminating
 * shape, not every field.
 */

import type { GroupNode, PublicationRow } from './dto.js';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const GROUP_KINDS = [
  'library',
  'static',
  'smart',
  'category',
  'author',
  'url',
  'script',
] as const;

/** Shallow guard: does `v` look like a {@link PublicationRow}? */
export function isPublicationRow(v: unknown): v is PublicationRow {
  return (
    isObject(v) &&
    typeof v['id'] === 'string' &&
    typeof v['citeKey'] === 'string' &&
    typeof v['type'] === 'string' &&
    typeof v['authorsDisplay'] === 'string' &&
    typeof v['title'] === 'string' &&
    typeof v['year'] === 'string'
  );
}

/** Shallow guard: does `v` look like a {@link GroupNode}? */
export function isGroupNode(v: unknown): v is GroupNode {
  return (
    isObject(v) &&
    typeof v['id'] === 'string' &&
    typeof v['name'] === 'string' &&
    typeof v['count'] === 'number' &&
    typeof v['kind'] === 'string' &&
    (GROUP_KINDS as readonly string[]).includes(v['kind'] as string)
  );
}
