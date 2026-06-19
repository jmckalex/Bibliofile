// Canned-data harness for scripts/spike-bibliophile-model.sh: proves the native
// Cocoa-Scripting proxy model (application -> document -> publication) against
// the real Bibliophile.sdef, using a FAKE in-memory library so it needs no app
// build / deps. The real app wires the same `dispatch` protocol to the live
// ScriptingService (app/src/main/scripting.ts) instead of this fake.
const { app } = require('electron');
const path = require('path');
const scripting = require(path.join(__dirname, 'bibliophile_scripting.node'));

const DOCS = [
  {
    ref: { kind: 'document', documentId: 'doc1' },
    name: 'sample.bib',
    pubs: [
      { ref: { kind: 'publication', documentId: 'doc1', itemId: 'i1' },
        props: { id: 'i1', 'cite key': 'smith2020', title: 'Hello World', type: 'article', 'publication year': '2020', keywords: 'x, y' } },
      { ref: { kind: 'publication', documentId: 'doc1', itemId: 'i2' },
        props: { id: 'i2', 'cite key': 'jones2019', title: 'A Book', type: 'book', 'publication year': '2019', keywords: '' } },
    ],
  },
];

const ok = (value) => JSON.stringify({ ok: true, value });
const err = (error) => JSON.stringify({ ok: false, error });
const findDoc = (ref) => DOCS.find((d) => d.ref.documentId === ref.documentId);
const findPub = (ref) => (findDoc(ref)?.pubs ?? []).find((p) => p.ref.itemId === ref.itemId);

function dispatch(json) {
  try {
    const req = JSON.parse(json);
    const { op, ref } = req;
    if (op === 'elements') {
      if (ref.kind === 'application' && req.element === 'document') return ok(DOCS.map((d) => d.ref));
      if (ref.kind === 'document' && req.element === 'publication') return ok((findDoc(ref)?.pubs ?? []).map((p) => p.ref));
      return err(`no ${req.element} of ${ref.kind}`);
    }
    if (op === 'getProperty') {
      if (ref.kind === 'application') return ok(req.name === 'name' ? 'Bibliophile' : req.name === 'version' ? 'test' : null);
      if (ref.kind === 'document') return ok(req.name === 'name' ? (findDoc(ref)?.name ?? null) : null);
      if (ref.kind === 'publication') { const p = findPub(ref); return p ? ok(p.props[req.name] ?? null) : err('no publication'); }
    }
    if (op === 'setProperty') {
      const p = findPub(ref); if (p) { p.props[req.name] = req.value; return ok(null); }
      return err('no publication');
    }
    return err('unsupported op');
  } catch (e) {
    return err(String(e));
  }
}

scripting.setDispatch(dispatch);
app.whenReady().then(() => {});
app.on('window-all-closed', () => {});
