# Scripting with JavaScript

Bibliofile can be driven by **JavaScript** — a powerful, cross-platform
alternative to AppleScript. You write a short program against the open library
and run it: read and edit entries, import and export, touch files, make web
requests, and react to changes. This chapter is the complete reference: how to
run scripts, the execution model, every object and method in the API, and worked
examples.

> **Warning:** Scripts run with the **same access as the app itself** — they can
> read and change everything in this library, and read and write any file you can,
> with no prompt. Only the **first network request** in a run asks your permission.
> Only run scripts **you wrote or trust**, exactly as you would with AppleScript or
> a shell command.

## Running scripts

There are two ways to run JavaScript:

**The Script Console** — **Tools ▸ Script Console…** (**⌥⌘J** / **Ctrl+Alt+J**).
A JavaScript editor with a **Run** button (**⌘↵** / **Ctrl+↵**) and an output
pane. This is the place to experiment: type code, run it against the open
library, and see the output immediately. Because you typed it yourself, the
Console never asks you to confirm the code — though a network request still
prompts once per run (see *Network*, below).

**Saved scripts** — the `.js` files in your **Scripts folder** appear under
**Tools ▸ Scripts** (the top level of the folder only — subfolders aren't
scanned). Use **Tools ▸ Scripts ▸ New Script…** to create one (it opens in your
text editor) and **Open Scripts Folder** to reveal the folder. Selecting a saved
script runs it against the current library and shows a result/error summary. The
first time you run a given saved script — and again whenever you've edited it —
Bibliofile asks you to confirm, since folder scripts may not have been written by
you.

> **Tip:** Start in the Console to get a script working, then put it on the menu
> for repeated use: **Tools ▸ Scripts ▸ New Script…** creates an `untitled.js`
> starter and opens it in your text editor — paste your code in and save it there.
> The Console itself has no Save button.

## The execution model

A few rules shape how scripts behave:

- **Synchronous.** Every call returns its value directly: no API call hands you a
  Promise, `await` isn't allowed at the top level of a script, and there are no
  timers (`setTimeout` and friends don't exist). `Promise` itself is present, but
  nothing waits for one — a promise callback runs only once the run has already
  finished, outside its undo step. So you write straight-line code:

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
  reverts the entire run — the Edit menu shows it as **Undo Run Script**. A
  read-only run adds no undo step.

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
| `bibliofile.citationStyles()` | `string[]` | Available CSL styles — see [Citations](#citations-csl--citationjs). |
| `bibliofile.io` | `object` | File access — see [Files](#files). |
| `bibliofile.fetch(url, opts?)` | `object` | A synchronous HTTP request — see [Network](#network). |
| `bibliofile.onChange(fn)` | `() => void` | React to later edits — see [onChange](#reacting-to-changes--onchange). |

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
| `doc.save(path?)` | `void` | Save to disk (optionally to a new path). Throws if the file changed on disk — see the note below. |

> **Note:** `doc.save()` is not quite ⌘S. Saving over the document's **own** file
> **throws an error** if that `.bib` has changed on disk since you opened it —
> where the UI offers *Overwrite / Reload from Disk / Cancel*, a script gets the
> error instead, so it can't silently clobber an edit made outside the app (see
> [Getting Started](01-getting-started.md)). Saving to a new `path` isn't guarded
> that way. A script save also skips the "these characters can't be written in
> this encoding" prompt: it writes in the document's current encoding, and
> anything that encoding can't hold is lost.

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
file) or `'url'` (a link). For a file, `url` is the absolute path (resolved
against the `.bib`'s folder) and `name` its basename. `field` is only present for
the app-managed `Bdsk-File-N` attachments — the ones synthesised from `Url`,
`Local-Url` or `Doi` don't carry it.

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
| `e.attach(absPath)` | `Entry` | Attach a file by absolute path. It is AutoFiled straight away only if you've set a Papers folder **and** ticked *AutoFile attachments when added* (Preferences ▸ Files). |
| `e.autoFile()` | `Entry` | AutoFile this entry's attachments into the Papers folder. Throws if no Papers folder is configured. |
| `e.delete()` | `void` | Delete the entry. |

> **Note:** **Notes** (`Annote`) and **Abstract** are the two fields that don't
> behave like the rest: they go through the storage codecs described in
> [Notes & Abstracts](05-notes-and-abstracts.md). With the default *compressed*
> **Annotation storage**, `e.setField('Annote', text)` really writes a compressed
> blob to a private `Bdsk-Annotation` field and clears `Annote`, so
> `e.field('Annote')` then reads back `''`; with *readable* storage the text stays
> in `Annote` with `%`, `{` and `}` percent-escaped. `Abstract` is plain text
> unless you switch **Abstract storage**. The script API has no decoder for those
> blobs, so notes are write-mostly unless you're on the readable/plain settings.

```javascript
bibliofile.activeDocument
  .get('einstein1905')
  .setField('Keywords', 'relativity, physics')
  .setField('Note', 'Annus mirabilis paper');
```

### Files

`bibliofile.io` provides synchronous file access — anywhere you can read or write,
with no confirmation prompt (unlike the network, below):

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
can read your whole library, so a request could send it elsewhere); answering
*Cancel* makes that call — and every later one in the same run — throw.

A request that takes longer than **8 seconds**, or fails outright, **throws**
rather than returning a result — so wrap `fetch` in `try`/`catch` if one failure
shouldn't abort the whole run. A response bigger than about 8 MB fails the same
way.

```javascript
// look up a DOI's title from CrossRef and store it
const doi = '10.1037/0003-066X.59.1.29';
const res = bibliofile.fetch('https://api.crossref.org/works/' + encodeURIComponent(doi));
if (res.status === 200) {
  const title = JSON.parse(res.text).message.title[0];
  console.log('Title: ' + title);
}
```

### Citations (CSL / citation.js)

Get **formatted citations** in any CSL style — the same engine that powers the
detail pane's Citation block and `\cite{…}` in notes. Output is clean text by
default (pass `{format: 'html'}` for HTML). The style defaults to the document's
**default citation style** (Preferences ▸ Citations); pass `{style: '…'}` to
override with any id from `bibliofile.citationStyles()`.

| Method | Returns | Description |
| --- | --- | --- |
| `bibliofile.citationStyles()` | `string[]` | Available style ids (bundled + installed). |
| `entry.citation(opts?)` | `string` | This entry as a formatted bibliography reference. |
| `entry.cslItem()` | `object` | The entry's raw CSL‑JSON (feed it to your own tooling). |
| `doc.bibliography(citeKeys?, opts?)` | `string` | A reference list for the given keys (or all entries). |
| `doc.cite(citeKeys, opts?)` | `string` | An inline citation (see below). |

`opts` is `{style?, format?}` for all of them. `entry.citation` and
`doc.bibliography` produce **reference list** entries; `doc.cite` produces an
**inline** citation and takes extra options that mirror natbib's `\cite` family:

| `doc.cite` option | Effect |
| --- | --- |
| *(default)* | parenthetical — `(Author, Year)` (`\citep`) |
| `{ textual: true }` or `{ mode: 'textual' }` | `Author (Year)` (`\citet`) |
| `{ mode: 'author' }` | author names only — `Einstein` (`\citeauthor`) |
| `{ mode: 'author', allAuthors: true }` | every author, no "et al." (`\citeauthor*`) |
| `{ prenote, postnote }` | inserted text — `(see Einstein, 1905, p. 4)` |

```javascript
const doc = bibliofile.activeDocument;

// one reference, APA
console.log(doc.get('einstein1905').citation());
// → "Einstein, A. (1905). On the electrodynamics of moving bodies. …"

// inline citations
console.log(doc.cite(['einstein1905']));                       // → "(Einstein, 1905)"
console.log(doc.cite(['einstein1905'], { textual: true }));    // → "Einstein (1905)"
console.log(doc.cite(['einstein1905'], { mode: 'author' }));   // → "Einstein"
console.log(doc.cite(['a', 'b'], { style: 'vancouver' }));     // → "(1,2)"

// pre/post-notes (natbib-style)
console.log(doc.cite(['einstein1905'], { prenote: 'see', postnote: 'p. 4' }));
// → "(see Einstein, 1905, p. 4)"
console.log(doc.cite(['darwin1859'], { textual: true, postnote: 'ch. 2' }));
// → "Darwin (1859, ch. 2)"

// a full bibliography of the 1905 papers, as HTML
return doc.bibliography(
  doc.filter((e) => e.field('Year') === '1905').map((e) => e.citeKey),
  { style: 'apa', format: 'html' },
);
```

```javascript
// build a Markdown reading list, each item formatted in the current style
const lines = bibliofile.activeDocument
  .entries()
  .map((e) => '- ' + e.citation());
bibliofile.io.writeText('/Users/me/reading-list.md', lines.join('\n'));
return lines.length + ' references written';
```

> **Tip:** `bibliofile.citationStyles()` lists every style id you can pass as
> `{style: …}` — the three bundled ones (`apa`, `vancouver`, `harvard1`) plus any
> `.csl` files you've installed with *Install CSL file…* in Preferences ▸
> Citations (installed styles get an id of the form `user-…`).

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

A handler stays active until you **run another script** (which replaces it — the
latest run's handlers win) or **close the document**. It fires on edits made
*after* the run, not on the run's own edits. Each handler runs in its own undo
step (labelled *Script hook*); a handler's own edits don't re-trigger handlers,
and one that throws doesn't stop the others or the app. Keep handlers quick —
they run on the main thread with no time limit, so an infinite loop in a handler
*will* hang the app.

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

**Report entries with no file attachment** (a link in `Url` doesn't count):

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

A TypeScript definitions file, **`bibliofile.d.ts`**, describes the whole API.
Copy it next to your scripts and point your editor's `tsconfig.json` (or
`jsconfig.json`) at it to get autocomplete and inline docs.

It is **not** bundled with the installed app yet: it lives in the project's
source tree at `app/resources/bibliofile.d.ts`, so you need a copy of the source
to get it.

## Gotchas

- **Nothing to `await`, no timers.** Everything is synchronous; `bibliofile.fetch`
  and `bibliofile.io` block until done.
- **Use `return` or `console.log`** for output — a bare final expression isn't
  shown automatically.
- **`require`, `process`, `fs` are unavailable** by design; use `bibliofile.io` /
  `bibliofile.fetch`.
- **`field()` returns `''`** for an absent field (not `undefined`), so
  `Number(e.field('Year'))` is `NaN` when there's no year.
- **`doc.save()` throws** rather than prompting when the `.bib` has changed on
  disk since it was opened.
- **Saved scripts prompt once** (and again after an edit); the Console doesn't.
- **`onChange` handlers** survive until the next run or document close, and have
  no time limit — keep them fast.

## See also

- [Importing & Exporting](07-importing-and-exporting.md) — the formats `doc.export`
  and `doc.import` use.
- [Editing Entries](03-editing-entries.md) — the same fields the API edits, in the UI.
- [Customizing Panels & Outputs](11-customizing-panels.md) — Handlebars templates
  for display and export (a different kind of customization).
