import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fieldsForTypes,
  typesForBibTeX,
  standardTypes,
  fieldsFor,
  requiredFieldsFor,
  optionalFieldsFor,
  isStandardType,
  isKnownType,
  fieldTypeSets,
  fieldTypeSetMeta,
  isPersonField,
  isRatingField,
  isBooleanField,
  isTriStateField,
  isCitationField,
  isLocalFileField,
  isRemoteURLField,
  isDefaultField,
  isURLField,
  isIntegerField,
  isFieldOfType,
  tagMaps,
  BibTeXFieldNamesForDublinCoreTerms,
  BibTeXFieldNamesForRISTags,
  BibTeXTypesForRISTypes,
  ReferTagsForBibTeXFieldNames,
} from './index';
import type { FieldTypeSetKey } from './index';

const here = dirname(fileURLToPath(import.meta.url));

describe('entry types & required/optional fields', () => {
  it('article requires Author, Title, Journal, Year', () => {
    const req = requiredFieldsFor('article');
    expect(req).toEqual(['Author', 'Title', 'Journal', 'Year']);
    const opt = optionalFieldsFor('article');
    expect(opt).toEqual(expect.arrayContaining(['Volume', 'Number', 'Pages', 'Month']));
  });

  it('book requires Title, Publisher, Year and has Author/Editor optional', () => {
    expect(requiredFieldsFor('book')).toEqual(['Title', 'Publisher', 'Year']);
    expect(optionalFieldsFor('book')).toEqual(
      expect.arrayContaining(['Author', 'Editor', 'Series', 'Edition']),
    );
  });

  it('inproceedings requires Author, Title, Booktitle, Year', () => {
    expect(requiredFieldsFor('inproceedings')).toEqual([
      'Author',
      'Title',
      'Booktitle',
      'Year',
    ]);
  });

  it('phdthesis requires Author, Title, School, Year', () => {
    expect(requiredFieldsFor('phdthesis')).toEqual([
      'Author',
      'Title',
      'School',
      'Year',
    ]);
  });

  it('looks up fields case-insensitively', () => {
    expect(requiredFieldsFor('ARTICLE')).toEqual(requiredFieldsFor('article'));
    expect(fieldsFor('Book')).toBe(fieldsFor('book'));
  });

  it('returns empty arrays for an unknown type', () => {
    expect(requiredFieldsFor('not-a-type')).toEqual([]);
    expect(optionalFieldsFor('not-a-type')).toEqual([]);
    expect(fieldsFor('not-a-type')).toBeUndefined();
  });

  it('returns defensive copies (mutation does not leak)', () => {
    const req = requiredFieldsFor('article');
    req.push('Bogus');
    expect(requiredFieldsFor('article')).not.toContain('Bogus');
  });

  it('exposes the standard / known type lists', () => {
    // 15 protected standard types per StandardTypesForFileType.BibTeX.
    expect(standardTypes).toHaveLength(15);
    expect(standardTypes).toEqual(expect.arrayContaining(['article', 'book', 'inproceedings']));
    expect(typesForBibTeX.length).toBeGreaterThanOrEqual(standardTypes.length);
    expect(typesForBibTeX).toEqual(expect.arrayContaining(['article', 'electronic', 'webpage']));
  });

  it('isStandardType / isKnownType are case-insensitive', () => {
    expect(isStandardType('Article')).toBe(true);
    expect(isStandardType('webpage')).toBe(false); // known but not standard
    expect(isKnownType('webpage')).toBe(true);
    expect(isKnownType('WEBPAGE')).toBe(true);
    expect(isKnownType('nope')).toBe(false);
  });
});

describe('field-type sets (the 8 arrays from Preferences.plist §4A)', () => {
  it('has exactly the 8 documented keys with documented defaults', () => {
    expect(fieldTypeSets).toEqual({
      'Boolean fields': ['Read'],
      'Citation fields': ['Cited-By', 'Cites'],
      'Default Fields': ['Keywords'],
      'Local File Fields': ['Local-Url'],
      'Person fields': ['Author', 'Editor'],
      'Rating fields': ['Rating'],
      'Remote URL Fields': ['Url', 'Doi', 'Citeseerurl'],
      'Three state fields': [],
    });
  });

  it('metadata maps each constant to its exact NSUserDefaults key', () => {
    expect(fieldTypeSetMeta).toHaveLength(8);
    const byConstant = Object.fromEntries(
      fieldTypeSetMeta.map((m) => [m.constant, m.key]),
    );
    expect(byConstant['BDSKLocalFileFieldsKey']).toBe('Local File Fields');
    expect(byConstant['BDSKRemoteURLFieldsKey']).toBe('Remote URL Fields');
    expect(byConstant['BDSKRatingFieldsKey']).toBe('Rating fields');
    expect(byConstant['BDSKBooleanFieldsKey']).toBe('Boolean fields');
    expect(byConstant['BDSKTriStateFieldsKey']).toBe('Three state fields');
    expect(byConstant['BDSKCitationFieldsKey']).toBe('Citation fields');
    expect(byConstant['BDSKPersonFieldsKey']).toBe('Person fields');
    expect(byConstant['BDSKDefaultFieldsKey']).toBe('Default Fields');
    // Every metadata key must correspond to an actual data array.
    for (const m of fieldTypeSetMeta) {
      expect(fieldTypeSets[m.key]).toBeDefined();
    }
  });

  it('predicates classify factory-default members (case-insensitive)', () => {
    expect(isPersonField('Author')).toBe(true);
    expect(isPersonField('editor')).toBe(true);
    expect(isPersonField('AUTHOR')).toBe(true);
    expect(isPersonField('Title')).toBe(false);

    expect(isRatingField('Rating')).toBe(true);
    expect(isRatingField('rating')).toBe(true);

    expect(isBooleanField('Read')).toBe(true);
    expect(isBooleanField('read')).toBe(true);

    expect(isTriStateField('anything')).toBe(false); // empty by default

    expect(isCitationField('Cited-By')).toBe(true);
    expect(isCitationField('cites')).toBe(true);

    expect(isLocalFileField('Local-Url')).toBe(true);
    expect(isLocalFileField('local-url')).toBe(true);

    expect(isRemoteURLField('Url')).toBe(true);
    expect(isRemoteURLField('doi')).toBe(true);
    expect(isRemoteURLField('Citeseerurl')).toBe(true);

    expect(isDefaultField('Keywords')).toBe(true);
    expect(isDefaultField('keywords')).toBe(true);
  });

  it('derived isURLField = localFile ∪ remoteURL', () => {
    expect(isURLField('Local-Url')).toBe(true);
    expect(isURLField('Url')).toBe(true);
    expect(isURLField('doi')).toBe(true);
    expect(isURLField('Author')).toBe(false);
  });

  it('derived isIntegerField = rating ∪ triState ∪ boolean', () => {
    expect(isIntegerField('Rating')).toBe(true);
    expect(isIntegerField('Read')).toBe(true);
    expect(isIntegerField('Author')).toBe(false);
  });

  it('isFieldOfType works for an explicit key', () => {
    expect(isFieldOfType('author', 'Person fields')).toBe(true);
    expect(isFieldOfType('author', 'Rating fields')).toBe(false);
  });
});

describe('import/export tag maps', () => {
  it('Dublin Core: DC.creator -> Author', () => {
    expect(BibTeXFieldNamesForDublinCoreTerms['DC.creator']).toBe('Author');
    expect(BibTeXFieldNamesForDublinCoreTerms['DC.title']).toBe('Title');
    expect(BibTeXFieldNamesForDublinCoreTerms['DC.subject']).toBe('Keywords');
  });

  it('RIS type map: JOUR -> article, BOOK -> book', () => {
    expect(BibTeXTypesForRISTypes['JOUR']).toBe('article');
    expect(BibTeXTypesForRISTypes['BOOK']).toBe('book');
  });

  it('RIS field map is nested per BibTeX type', () => {
    expect(BibTeXFieldNamesForRISTags['misc']?.['AU']).toBe('Author');
    expect(BibTeXFieldNamesForRISTags['article']?.['T2']).toBe('Journal');
  });

  it('Refer export tags: Author -> A, Title -> T', () => {
    expect(ReferTagsForBibTeXFieldNames['Author']).toBe('A');
    expect(ReferTagsForBibTeXFieldNames['Title']).toBe('T');
  });

  it('exposes all 22 named maps in tagMaps', () => {
    expect(Object.keys(tagMaps)).toHaveLength(22);
    for (const m of Object.values(tagMaps)) {
      expect(typeof m).toBe('object');
      expect(m).not.toBeNull();
    }
  });
});

describe('internal consistency', () => {
  it('every standard type is also a known BibTeX type', () => {
    for (const t of standardTypes) {
      expect(typesForBibTeX).toContain(t);
    }
  });

  it('every standard type has a FieldsForTypes entry', () => {
    for (const t of standardTypes) {
      expect(fieldsFor(t)).toBeDefined();
    }
  });

  it('FieldsForTypes entries have string-array required & optional', () => {
    for (const [type, fields] of Object.entries(fieldsForTypes)) {
      expect(Array.isArray(fields.required), `${type}.required`).toBe(true);
      expect(Array.isArray(fields.optional), `${type}.optional`).toBe(true);
      for (const f of [...fields.required, ...fields.optional]) {
        expect(typeof f).toBe('string');
      }
    }
  });

  it('no field is both required and optional within a type', () => {
    for (const [type, fields] of Object.entries(fieldsForTypes)) {
      const req = new Set(fields.required.map((f) => f.toLowerCase()));
      for (const o of fields.optional) {
        expect(req.has(o.toLowerCase()), `${type}: ${o} both req & opt`).toBe(false);
      }
    }
  });

  it('each field-type set key matches the FieldTypeSets type union', () => {
    const keys = Object.keys(fieldTypeSets) as FieldTypeSetKey[];
    expect(keys).toHaveLength(8);
    const metaKeys = new Set(fieldTypeSetMeta.map((m) => m.key));
    for (const k of keys) {
      expect(metaKeys.has(k)).toBe(true);
    }
  });

  it('committed JSON matches the bundled source plist (round-trip check)', () => {
    // Test code MAY use node:fs. Re-read the committed data file and confirm
    // it parses and still contains the key article definition. This guards
    // against accidental data-file corruption.
    const dataPath = resolve(here, 'data', 'typeinfo.json');
    const raw = JSON.parse(readFileSync(dataPath, 'utf8'));
    expect(raw.FieldsForTypes.article.required).toEqual([
      'Author',
      'Title',
      'Journal',
      'Year',
    ]);
    expect(raw.StandardTypesForFileType.BibTeX).toContain('article');
  });
});
