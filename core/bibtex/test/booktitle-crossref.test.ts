/**
 * Loading and saving must not invent a `Booktitle`.
 *
 * The model used to copy an entry's own `Title` into an empty `Booktitle` for
 * inbook/incollection/inproceedings/conference, at construction (i.e. on every
 * parse). Because save reserializes the whole document, that value reached disk
 * on the first open+save. For a crossref'd child it is actively wrong: the
 * child's Title is the *chapter* title, and its Booktitle should be inherited
 * from the parent, so BibTeX printed the chapter title as the volume title.
 * Without a crossref it is still wrong data (a paper title is not a venue).
 * BibDesk's workaround is off by default and targets the PARENT types.
 */

import { describe, it, expect } from 'vitest';

import { parse, serialize } from '../src/index';

const LIBRARY = `@book{Copeland/etal:2013,
\teditor = {B. Jack Copeland and Carl J. Posy and Oron Shagrir},
\ttitle = {Computability: Turing, G{\\"o}del, Church, and Beyond},
\tyear = {2013}}

@incollection{Aaronson:2013,
\tauthor = {Scott Aaronson},
\tcrossref = {Copeland/etal:2013},
\ttitle = {Why Philosophers Should Care about Computational Complexity}}

@inbook{Kripke:1976,
\tauthor = {Saul Kripke},
\ttitle = {Is There a Problem about Substitutional Quantification?}}

@inproceedings{Ng:2024,
\tauthor = {Alice Ng},
\ttitle = {A Calculus of Effect Handlers}}

@conference{Lee:2020,
\tauthor = {Lee, Kim},
\ttitle = {On Conferences}}
`;

describe('Booktitle is never written on load', () => {
  it('serializing a freshly parsed library writes no booktitle field', () => {
    expect(serialize(parse(LIBRARY))).not.toMatch(/^\s*booktitle\s*=/im);
  });

  it('no entry gains a local Booktitle', () => {
    const lib = parse(LIBRARY);
    for (const item of lib.items) {
      expect(item.rawValueOfField('Booktitle'), item.citeKey).toBeUndefined();
    }
  });
});
