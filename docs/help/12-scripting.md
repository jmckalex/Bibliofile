# Scripting with JavaScript

Bibliofile can be driven by **JavaScript** — a powerful, cross-platform
alternative to AppleScript. You write a short program against the open library
and run it: read and edit entries, import and export, touch files, make web
requests, and react to changes. This chapter is the complete reference: how to
run scripts, the execution model, every object and method in the API, and worked
examples.

> **Warning:** Scripts run with the **same access as the app itself** — they can
> read and change everything in this library and, with your permission, read and
> write files and make network requests. Only run scripts **you wrote or trust**,
> exactly as you would with AppleScript or a shell command.

## Running scripts

There are two ways to run JavaScript:

**The Script Console** — **Tools ▸ Script Console…** (**⌘⌥J** / **Ctrl+Alt+J**).
A JavaScript editor with a **Run** button (**⌘↵** / **Ctrl+↵**) and an output
pane. This is the place to experiment: type code, run it against the open
library, and see the output immediately. Because you typed it yourself, the
Console never asks for confirmation.

**Saved scripts** — files in your **Scripts folder** appear under **Tools ▸
Scripts**. Use **Tools ▸ Scripts ▸ New Script…** to create one (it opens in your
text editor) and **Open Scripts Folder** to reveal the folder. Selecting a saved
script runs it against the current library and shows a result/error summary. The
first time you run a given saved script — and again whenever you've edited it —
Bibliofile asks you to confirm, since folder scripts may not have been written by
you.

> **Tip:** Start in the Console to get a script working, then **Save** it into the
> Scripts folder (via *New Script…*) when you want it on the menu for repeated use.

## The execution model

A few rules shape how scripts behave:

- **Synchronous.** The whole API is synchronous — no `await`, no Promises, no
  timers. You write straight-line code:

  ```javascript
  const doc = bibliofile.activeDocument;
  for (const e of doc.entries()) e.setField('Reviewed', 'no');
  ```

- **Return a value or log.** The value you `return` from the script is shown in
  the Console's output pane (objects are shown as JSON). `console.log`,
  `console.warn`, etc. also print there.

  ```javascript
  console.log('Working…');
  return bibliofile.activeDocument.count(); // shown as the result
  ```

- **One run = one Undo.** However many entries a script changes, a single **⌘Z**
  (Edit ▸ Undo) reverts the entire run. A read-only run adds no undo step.

- **Time-limited.** A run has a wall-clock limit (about 10 seconds), so an
  accidental infinite loop can't hang the app — it's stopped and reported as an
  error.

- **Curated sandbox.** The global `bibliofile` is available, along with the
  standard JavaScript built-ins (`JSON`, `Math`, `Date`, `Array`, `Object`,
  `RegExp`, `Map`, `Set`, `String`, `Number`, `Boolean`, `parseInt`, …). Node
  globals like `require`, `process`, and `fs` are **not** exposed — use
  `bibliofile.io` and `bibliofile.fetch` for files and the network.

## API reference

Everything starts from the global **`bibliofile`**.

### `bibliofile`

| Member | Type | Description |
| --- | --- | --- |
| `bibliofile.name` | `string` | `"Bibliofile"`. |
| `bibliofile.version` | `string` | The running app version. |
| `bibliofile.activeDocument` | `Document` | The library the script runs against. |
| `bibliofile.documents()` | `Document[]` | Every open document. |
| `bibliofile.document(id)` | `Document` | A document by its id. |
| `bibliofile.io` | `object` | File access — see [Files](#files). |
| `bibliofile.fetch(url, opts?)` | `object` | A synchronous HTTP request — see [Network](#network). |
| `bibliofile.onChange(fn)` | `() => void` | React to later edits — see [onChange](#reacting-to-changes-onchange). |

```javascript
console.log(bibliofile.name + ' ' + bibliofile.version);
return bibliofile.documents().map((d) => d.name);
```

### `Document`

The library. Get it from `bibliofile.activeDocument`.

#### Properties

| Property | Type | Description |
| --- | --- | --- |
| `doc.id` | `string` | Internal document id. |
| `doc.name` | `string` | The file's display name. |
| `doc.path` | `string` | Absolute path of the `.bib`, or `''`. |
| `doc.modified` | `boolean` | Whether there are unsaved changes. |

#### Reading entries

| Method | Returns | Description |
| --- | --- | --- |
| `doc.count()` | `number` | Number of entries. |
| `doc.entries()` | `Entry[]` | Every entry, in file order. |
| `doc.get(citeKeyOrId)` | `Entry \| undefined` | One entry by cite key (or id). |
| `doc.getByCiteKey(key)` | `Entry \| undefined` | One entry by cite key (case-insensitive). |
| `doc.getById(id)` | `Entry \| undefined` | One entry by its stable id. |
| `doc.find(fn)` | `Entry \| undefined` | First entry for which `fn(entry)` is true. |
| `doc.filter(fn)` | `Entry[]` | All entries for which `fn(entry)` is true. |
| `doc.search(text)` | `Entry[]` | Case-insensitive substring search over cite key, type, and common fields (Title, Author, Editor, Journal, Booktitle, Year, Keywords, Abstract, Note). |
| `doc.findDuplicates()` | `Entry[][]` | Groups of two-or-more duplicate entries. |

```javascript
const doc = bibliofile.activeDocument;

// entries from 2020 onward, newest first
const recent = doc
  .filter((e) => Number(e.field('Year')) >= 2020)
  .sort((a, b) => Number(b.field('Year')) - Number(a.field('Year')));
return recent.map((e) => `${e.citeKey} (${e.field('Year')})`);
```

#### Creating, importing, exporting

| Method | Returns | Description |
| --- | --- | --- |
| `doc.addEntry({type, fields, citeKey})` | `Entry` | Create an entry. `type` defaults to `misc`; `fields` is a `{Name: value}` map; `citeKey` is optional (one is generated if omitted). |
| `doc.import(bibtexText)` | `Entry[]` | Parse + merge BibTeX text; returns the added entries. |
| `doc.export(format, citeKeys?)` | `string` | Serialize to a string. `format` is `'bibtex'`, `'bibtex-minimal'`, `'ris'`, `'csv'`, `'html'`, or `'rtf'`. Pass `citeKeys` to export a subset. |
| `doc.toBibTeX()` | `string` | The whole library as BibTeX. |
| `doc.save(path?)` | `void` | Save to disk (optionally to a new path). |

```javascript
const e = bibliofile.activeDocument.addEntry({
  type: 'article',
  citeKey: 'turing1950',
  fields: {
    Author: 'Turing, Alan M.',
    Title: 'Computing Machinery and Intelligence',
    Journal: 'Mind',
    Year: '1950',
  },
});
return e.citeKey;
```

```javascript
// import a couple of entries from text
const added = bibliofile.activeDocument.import(`
  @book{knuth1997, author = {Knuth, Donald E.}, title = {The Art of Computer Programming}, year = {1997} }
`);
return added.map((e) => e.citeKey);
```

#### Groups and macros

| Method | Returns | Description |
| --- | --- | --- |
| `doc.groups()` | `{id, kind, name, count}[]` | The sidebar groups. |
| `doc.groupEntries(groupId)` | `Entry[]` | The entries in a group. |
| `doc.macros()` | `Record<string, string>` | The `@string` macros as a `{name: value}` map. |
| `doc.setMacro(name, value)` | `void` | Define or replace a macro. |
| `doc.removeMacro(name)` | `void` | Remove a macro. |

```javascript
const doc = bibliofile.activeDocument;
doc.setMacro('pnas', 'Proceedings of the National Academy of Sciences');
return doc.macros();
```

#### `doc.transaction(label, fn)`

Run a batch of edits as **one** named undo step. (Every script run is already a
single undo step, so you only need this if you're nesting named sub-groups.)

```javascript
bibliofile.activeDocument.transaction('Tag historic works', (doc) => {
  for (const e of doc.entries()) {
    if (Number(e.field('Year')) < 1950) e.setField('Keywords', 'historic');
  }
});
```

### `Entry`

A single bibliography entry, from `doc.get(...)`, `doc.entries()`, etc.

#### Reading

| Member | Returns | Description |
| --- | --- | --- |
| `e.id` | `string` | Stable internal id (survives cite-key changes). |
| `e.citeKey` | `string` | The BibTeX cite key. |
| `e.type` | `string` | Entry type (`article`, `book`, …). |
| `e.field(name, inherit?)` | `string` | Raw stored value (macros expanded), `''` if absent. `inherit` (default `false`) pulls a `crossref` parent's value. |
| `e.displayField(name, inherit?)` | `string` | Like `field`, de‑TeXified to Unicode (`G{\"o}del` → `Gödel`). |
| `e.fields()` | `Record<string,string>` | All fields as a `{Name: value}` map. |
| `e.fieldNames()` | `string[]` | The field names present. |
| `e.authors(field?, inherit?)` | `Author[]` | Parsed people from `field` (default `Author`). |
| `e.attachments()` | `Attachment[]` | Files and links on the entry. |
| `e.toBibTeX()` | `string` | This entry serialized as BibTeX. |
| `e.toJSON()` | `object` | `{id, citeKey, type, fields}` — a plain object. |

An **`Author`** is `{displayName, first, von, last, jr}` (all strings). An
**`Attachment`** is `{field, kind, name, url}`, where `kind` is `'file'` (a local
file) or `'url'` (a link).

```javascript
const e = bibliofile.activeDocument.get('godel1931');
return {
  title: e.displayField('Title'),
  firstAuthorLast: e.authors()[0]?.last,
  files: e.attachments().filter((a) => a.kind === 'file').map((a) => a.name),
};
```

#### Editing

All mutators route through the library (so undo, search re-indexing, and
crossref handling stay correct). The field setters return the entry, so calls
chain.

| Method | Returns | Description |
| --- | --- | --- |
| `e.setField(name, value)` | `Entry` | Set a field (empty string clears it). |
| `e.removeField(name)` | `Entry` | Remove a field. |
| `e.setType(type)` | `Entry` | Change the entry type. |
| `e.setCiteKey(key)` | `Entry` | Change the cite key. |
| `e.generateCiteKey()` | `string` | Regenerate the cite key from your configured format; returns the new key. |
| `e.attach(absPath)` | `Entry` | Attach a file by absolute path (AutoFiled if a Papers folder is set). |
| `e.autoFile()` | `Entry` | AutoFile this entry's attachments into the Papers folder. |
| `e.delete()` | `void` | Delete the entry. |

```javascript
bibliofile.activeDocument
  .get('einstein1905')
  .setField('Keywords', 'relativity, physics')
  .setField('Note', 'Annus mirabilis paper');
```

### Files

`bibliofile.io` provides synchronous file access (the same access level as the
rest of the run):

| Method | Returns | Description |
| --- | --- | --- |
| `bibliofile.io.readText(path)` | `string` | Read a UTF‑8 text file. |
| `bibliofile.io.writeText(path, text)` | `void` | Write a UTF‑8 text file. |
| `bibliofile.io.exists(path)` | `boolean` | Whether a path exists. |

```javascript
// dump the whole library next to it as plain text
const doc = bibliofile.activeDocument;
bibliofile.io.writeText('/Users/me/library-backup.bib', doc.toBibTeX());
return 'wrote ' + doc.count() + ' entries';
```

### Network

`bibliofile.fetch(url, opts?)` performs a **synchronous** HTTP request and
returns `{status, headers, text}`. `opts` may include `method`, `headers`, and
`body`. The **first** network call in a run prompts you to allow access (a script
can read your whole library, so a request could send it elsewhere).

```javascript
// look up a DOI's title from CrossRef and store it
const doi = '10.1037/0003-066X.59.1.29';
const res = bibliofile.fetch('https://api.crossref.org/works/' + encodeURIComponent(doi));
if (res.status === 200) {
  const title = JSON.parse(res.text).message.title[0];
  console.log('Title: ' + title);
}
```

### Reacting to changes — `onChange`

`bibliofile.onChange(fn)` registers a handler that runs **after later edits** to
the active document — useful for validation or auto‑tidying. It returns an
unsubscribe function.

```javascript
// warn (in the console) whenever an entry is missing a year
bibliofile.onChange(() => {
  const missing = bibliofile.activeDocument.filter((e) => !e.field('Year'));
  if (missing.length) console.warn(missing.length + ' entries have no Year');
});
```

A handler stays active until you **run another script** (which replaces it) or
**close the document**. Keep handlers quick — they run on the main thread with no
time limit, so an infinite loop in a handler *will* hang the app.

## Recipes

**Normalize every cite key** to your configured format (one Undo reverts all):

```javascript
for (const e of bibliofile.activeDocument.entries()) e.generateCiteKey();
```

**Title‑case the `Keywords` field across the library:**

```javascript
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
for (const e of bibliofile.activeDocument.entries()) {
  const kw = e.field('Keywords');
  if (kw) e.setField('Keywords', titleCase(kw));
}
```

**Report entries that have no PDF attached:**

```javascript
return bibliofile.activeDocument
  .filter((e) => e.attachments().every((a) => a.kind !== 'file'))
  .map((e) => e.citeKey);
```

**Export a BibTeX subset to a file:**

```javascript
const doc = bibliofile.activeDocument;
const phil = doc.filter((e) => /philosoph/i.test(e.field('Journal')));
bibliofile.io.writeText('/Users/me/philosophy.bib', doc.export('bibtex', phil.map((e) => e.citeKey)));
return phil.length + ' entries exported';
```

**Promote `Booktitle` to `Journal` for mislabeled articles:**

```javascript
bibliofile.activeDocument.transaction('Fix venues', (doc) => {
  for (const e of doc.entries()) {
    if (e.type === 'article' && !e.field('Journal') && e.field('Booktitle')) {
      e.setField('Journal', e.field('Booktitle')).removeField('Booktitle');
    }
  }
});
```

## Editor autocomplete

A TypeScript definitions file, **`bibliofile.d.ts`**, ships in the app's
resources. Copy it next to your scripts and point your editor's `tsconfig.json`
(or `jsconfig.json`) at it to get autocomplete and inline docs for the whole API.

## Gotchas

- **No `await` / Promises / timers.** Everything is synchronous; `bibliofile.fetch`
  and `bibliofile.io` block until done.
- **Use `return` or `console.log`** for output — a bare final expression isn't
  shown automatically.
- **`require`, `process`, `fs` are unavailable** by design; use `bibliofile.io` /
  `bibliofile.fetch`.
- **`field()` returns `''`** for an absent field (not `undefined`), so
  `Number(e.field('Year'))` is `NaN` when there's no year.
- **Saved scripts prompt once** (and again after an edit); the Console doesn't.
- **`onChange` handlers** survive until the next run or document close, and have
  no time limit — keep them fast.

## See also

- [Importing & Exporting](07-importing-and-exporting.md) — the formats `doc.export`
  and `doc.import` use.
- [Editing Entries](03-editing-entries.md) — the same fields the API edits, in the UI.
- [Customizing Panels & Outputs](11-customizing-panels.md) — Handlebars templates
  for display and export (a different kind of customization).
