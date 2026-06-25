# Scripting with JavaScript

Bibliofile can be automated with **JavaScript** — a powerful, cross-platform
alternative to AppleScript. You write a short program against the open library
and run it; it can read entries, make edits, import/export, touch files, and
react to changes. This chapter covers the **Script Console**, the **`bibliofile`
API**, **saved scripts**, **file & network access**, **change hooks**, and a few
worked examples.

> **Warning:** Scripts run with the **same access as the app** — they can read and
> change everything in this library, and (with your permission) read/write files
> and make network requests. Only run scripts **you wrote or trust**, exactly as
> you would with AppleScript or a shell command.

## The Script Console

**Tools ▸ Script Console…** (**⌘⌥J** / **Ctrl+Alt+J**) opens a JavaScript editor
with a **Run** button (**⌘↵** / **Ctrl+↵**) and an output pane. The global
`bibliofile` object is your entry point; `console.log(…)` prints to the output
pane, and the value you `return` is shown too.

```javascript
const doc = bibliofile.activeDocument;
console.log(doc.count() + ' entries');
return doc.entries().slice(0, 5).map((e) => e.citeKey);
```

**One run = one Undo.** However many entries a script changes, a single **⌘Z**
reverts the whole run. A read-only run adds no undo step. Runs have a time limit
(so an accidental infinite loop can't hang the app).

## The `bibliofile` API

Everything hangs off the global `bibliofile`:

| | |
| --- | --- |
| `bibliofile.activeDocument` | the open library the script runs against |
| `bibliofile.documents()` | every open document |
| `bibliofile.version` | the app version |

### The document

```javascript
const doc = bibliofile.activeDocument;
```

| Method | What it does |
| --- | --- |
| `doc.count()` | number of entries |
| `doc.entries()` | every entry (an array of **Entry** objects) |
| `doc.get(citeKeyOrId)` | one entry by cite key (or id), or `undefined` |
| `doc.find(fn)` / `doc.filter(fn)` | first / all entries matching a predicate |
| `doc.search(text)` | case-insensitive search across cite key + common fields |
| `doc.findDuplicates()` | groups of duplicate entries |
| `doc.groups()` / `doc.groupEntries(id)` | the group list / a group's entries |
| `doc.macros()` / `doc.setMacro(n,v)` / `doc.removeMacro(n)` | `@string` macros |
| `doc.addEntry({type, fields, citeKey})` | create an entry → returns the new **Entry** |
| `doc.import(bibtex)` | parse + merge BibTeX text → returns the added entries |
| `doc.export(format, citeKeys?)` | serialize to `'bibtex'`/`'ris'`/`'csv'`/`'html'`/`'rtf'` |
| `doc.toBibTeX()` | the whole library as BibTeX |
| `doc.save(path?)` | save to disk (optionally a new path) |
| `doc.transaction(label, fn)` | run a batch as one named undo step |

### An entry

```javascript
const e = doc.get('einstein1905');
```

| Member | What it does |
| --- | --- |
| `e.id` / `e.citeKey` / `e.type` | identity |
| `e.field(name)` | raw stored value (macro-expanded) |
| `e.displayField(name)` | value de-TeXified to Unicode (`G{\"o}del` → `Gödel`) |
| `e.fields()` / `e.fieldNames()` | all fields as a map / the field names |
| `e.authors()` | parsed people: `{displayName, first, von, last, jr}` |
| `e.attachments()` | files/links on the entry |
| `e.toBibTeX()` / `e.toJSON()` | this entry as BibTeX / a plain object |
| `e.setField(name, value)` | set a field (returns `e`, so calls chain) |
| `e.removeField(name)` | remove a field |
| `e.setType(type)` / `e.setCiteKey(key)` | change type / cite key |
| `e.generateCiteKey()` | regenerate the cite key from your format |
| `e.attach(path)` / `e.autoFile()` | attach a file / AutoFile its attachments |
| `e.delete()` | delete the entry |

## Saved scripts (the Scripts menu)

Put `*.js` files in your **Scripts folder** and they appear under **Tools ▸
Scripts**. Use **Tools ▸ Scripts ▸ New Script…** to create one (it opens in your
editor) and **Open Scripts Folder** to reveal the folder. Selecting a saved
script runs it against the current library and shows a result/error summary.

The first time you run a given saved script (and again whenever you've edited it)
Bibliofile asks you to confirm — folder scripts may not have been written by you.
The Script Console, where you typed the code yourself, never prompts.

## Files & network

Scripts can read and write files and make HTTP requests:

```javascript
// export the bibliography next to the library
bibliofile.io.writeText('/Users/me/refs.bib', bibliofile.activeDocument.toBibTeX());

// read a list of cite keys to delete
const keys = bibliofile.io.readText('/tmp/remove.txt').split('\n').filter(Boolean);

// fetch metadata (you'll be asked once per run to allow network access)
const res = bibliofile.fetch('https://api.crossref.org/works/10.1037/0003-066X.59.1.29');
console.log(res.status);
```

- `bibliofile.io.readText(path)` / `writeText(path, text)` / `exists(path)` —
  synchronous file access.
- `bibliofile.fetch(url, {method, headers, body})` — a **synchronous** HTTP
  request returning `{status, headers, text}`. The first network call in a run
  asks for your permission (a script can read your whole library, so a request
  could send it somewhere).

## Reacting to changes — `onChange`

`bibliofile.onChange(fn)` registers a handler that runs after **later** edits to
the library — handy for validation or auto-tidying:

```javascript
// flag entries that are missing a year, whenever the library changes
bibliofile.onChange(() => {
  for (const e of bibliofile.activeDocument.filter((x) => !x.field('Year'))) {
    console.log('Missing year: ' + e.citeKey);
  }
});
```

A handler stays active until you **run another script** (which replaces it) or
**close the document**. Keep handlers quick — they run on the main thread.

## Worked examples

**Normalize every cite key** (one Undo reverts all of it):

```javascript
for (const e of bibliofile.activeDocument.entries()) e.generateCiteKey();
```

**Title-case the `Keywords` field across the library:**

```javascript
const title = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
for (const e of bibliofile.activeDocument.entries()) {
  const kw = e.field('Keywords');
  if (kw) e.setField('Keywords', title(kw));
}
```

**Find entries with no attachment:**

```javascript
return bibliofile.activeDocument
  .filter((e) => e.attachments().length === 0)
  .map((e) => e.citeKey);
```

**Tag everything published before 1950:**

```javascript
bibliofile.activeDocument.transaction('Tag pre-1950', (doc) => {
  for (const e of doc.entries()) {
    if (Number(e.field('Year')) < 1950) e.setField('Keywords', [e.field('Keywords'), 'historic'].filter(Boolean).join(', '));
  }
});
```

> **Tip:** Copy the bundled `bibliofile.d.ts` (in the app's resources) into a
> folder with your scripts and point your editor's `tsconfig`/JSConfig at it for
> autocomplete on the whole API.

## See also

- [Importing & Exporting](07-importing-and-exporting.md) — formats `doc.export`
  and `doc.import` use.
- [Editing Entries](03-editing-entries.md) — the same fields the API edits.
- [Customizing Panels & Outputs](11-customizing-panels.md) — Handlebars templates
  for display/export (a different kind of customization).
