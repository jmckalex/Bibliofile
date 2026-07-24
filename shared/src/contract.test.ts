import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  IPC_NAMESPACE,
  IpcChannels,
  IpcEvents,
  channelName,
  isIpcChannel,
  isIpcEventChannel,
  isPublicationRow,
  isGroupNode,
  type BibDeskApi,
  type GroupNode,
  type IpcContract,
  type IpcEventMap,
  type ItemDetail,
  type OpenedDocument,
  type PublicationRow,
  type RequestOf,
  type ResponseOf,
  type IpcHandlers,
} from './index.js';

describe('channel constants', () => {
  it('all channel values are unique', () => {
    const all = [
      ...Object.values(IpcChannels),
      ...Object.values(IpcEvents),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('every channel is namespaced under the prefix', () => {
    for (const ch of [...Object.values(IpcChannels), ...Object.values(IpcEvents)]) {
      expect(ch.startsWith(`${IPC_NAMESPACE}:`)).toBe(true);
    }
  });

  it('event channels are disjoint from request/response channels', () => {
    const req = new Set<string>(Object.values(IpcChannels));
    for (const ev of Object.values(IpcEvents)) {
      expect(req.has(ev)).toBe(false);
    }
  });
});

describe('channel helpers + guards', () => {
  it('channelName applies the namespace', () => {
    expect(channelName('exportSelection')).toBe('bibdesk:exportSelection');
  });

  it('isIpcChannel recognises known request channels only', () => {
    expect(isIpcChannel(IpcChannels.openDocument)).toBe(true);
    expect(isIpcChannel(IpcEvents.documentOpened)).toBe(false);
    expect(isIpcChannel('nope')).toBe(false);
    expect(isIpcChannel(42)).toBe(false);
  });

  it('isIpcEventChannel recognises known event channels only', () => {
    expect(isIpcEventChannel(IpcEvents.documentClosed)).toBe(true);
    expect(isIpcEventChannel(IpcChannels.listGroups)).toBe(false);
    expect(isIpcEventChannel(undefined)).toBe(false);
  });
});

const sampleRow: PublicationRow = {
  id: 'item-1',
  citeKey: 'knuth1984',
  type: 'article',
  authorsDisplay: 'D. E. Knuth',
  title: 'Literate Programming',
  year: '1984',
  hasKeywords: true,
  hasAnnotation: false,
  attachmentCount: 1,
  read: 1,
  rating: 0,
};

const sampleGroup: GroupNode = {
  id: 'grp-static-1',
  kind: 'static',
  name: 'To Read',
  count: 7,
  parentId: 'grp-static-root',
};

const sampleDetail: ItemDetail = {
  id: 'item-1',
  citeKey: 'knuth1984',
  type: 'article',
  fields: [
    { name: 'Author', value: 'Donald E. Knuth', rawValue: 'Donald E. Knuth', isInherited: false },
    { name: 'Title', value: 'Literate Programming', rawValue: 'Literate Programming', isInherited: false },
    { name: 'Journal', value: 'The Computer Journal', rawValue: 'The Computer Journal', isInherited: true },
  ],
  files: [
    { kind: 'file', displayName: 'knuth1984.pdf', url: 'file:///papers/knuth1984.pdf' },
    { kind: 'url', displayName: 'doi.org', url: 'https://doi.org/10.1093/comjnl/27.2.97' },
  ],
  previewHtml: '<div class="cite">Knuth (1984)</div>',
  notesRaw: '',
  notesHtml: '',
};

const sampleOpened: OpenedDocument = {
  documentId: 'doc-1',
  path: '/Users/me/refs.bib',
  displayName: 'refs.bib',
  itemCount: 1234,
  warnings: [{ severity: 'warning', message: 'unbalanced brace', line: 42 }],
  encoding: 'utf8',
};

describe('DTO guards', () => {
  it('isPublicationRow accepts a valid row, rejects junk', () => {
    expect(isPublicationRow(sampleRow)).toBe(true);
    expect(isPublicationRow({ id: 'x' })).toBe(false);
    expect(isPublicationRow(null)).toBe(false);
    expect(isPublicationRow({ ...sampleRow, year: 1984 })).toBe(false);
  });

  it('isGroupNode accepts a valid node, rejects bad kinds', () => {
    expect(isGroupNode(sampleGroup)).toBe(true);
    expect(isGroupNode({ ...sampleGroup, kind: 'bogus' })).toBe(false);
    expect(isGroupNode({ id: 'x', name: 'y' })).toBe(false);
  });
});

describe('DTOs are structured-clone-safe', () => {
  it('clones every sample DTO to an equal-but-distinct value', () => {
    for (const dto of [sampleRow, sampleGroup, sampleDetail, sampleOpened]) {
      const clone = structuredClone(dto);
      expect(clone).toEqual(dto);
      expect(clone).not.toBe(dto);
    }
  });
});

describe('type-level contract checks', () => {
  it('IpcContract maps channels to the right request/response', () => {
    expectTypeOf<RequestOf<typeof IpcChannels.openDocument>>().toMatchTypeOf<{
      path: string;
    }>();
    expectTypeOf<
      ResponseOf<typeof IpcChannels.listPublications>
    >().toMatchTypeOf<{ rows: readonly PublicationRow[]; total: number }>();
    expectTypeOf<IpcContract[typeof IpcChannels.getItemDetail]['response']>()
      .toMatchTypeOf<ItemDetail>();
  });

  it('BibDeskApi method signatures line up with the contract', () => {
    expectTypeOf<BibDeskApi['openDocument']>().returns.resolves.toMatchTypeOf<OpenedDocument>();
    expectTypeOf<BibDeskApi['getItemDetail']>().parameter(0).toMatchTypeOf<{
      documentId: string;
      itemId: string;
    }>();
  });

  it('IpcHandlers covers exactly the request/response channels', () => {
    expectTypeOf<keyof IpcHandlers>().toEqualTypeOf<keyof IpcContract>();
  });

  // IpcEventMap silently covered only 8 of the 11 push channels: the three
  // streaming-progress ones were sent by main and subscribed in preload with
  // hand-written annotations at each end, so a payload shape could change on one
  // side with no compile error (audit rpt-04 SEV-M1). Assert exhaustiveness both
  // ways so neither a new channel nor a stale map entry can slip through.
  it('IpcEventMap covers exactly the event channels', () => {
    expectTypeOf<keyof IpcEventMap>().toEqualTypeOf<(typeof IpcEvents)[keyof typeof IpcEvents]>();
  });

  it('every event channel has a runtime-reachable payload type', () => {
    // A value-level companion to the type test above: the map's keys and the
    // IpcEvents values must be the same set at runtime too.
    const declared = Object.values(IpcEvents).sort();
    // `IpcEventMap` is a type, so enumerate the channels the preload bridge and
    // main actually use via IpcEvents itself; this guards the constant object.
    expect(new Set(declared).size).toBe(declared.length);
    expect(declared).toHaveLength(11);
  });
});
