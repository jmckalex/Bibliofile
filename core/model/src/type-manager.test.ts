import { describe, it, expect } from 'vitest';
import { TypeManager } from './type-manager.js';

describe('TypeManager — factory-default classification (case-insensitive)', () => {
  const tm = new TypeManager();

  it('classifies person fields', () => {
    expect(tm.isPersonField('Author')).toBe(true);
    expect(tm.isPersonField('editor')).toBe(true); // case-insensitive
    expect(tm.isPersonField('Title')).toBe(false);
  });

  it('classifies rating/boolean/citation fields', () => {
    expect(tm.isRatingField('rating')).toBe(true);
    expect(tm.isBooleanField('Read')).toBe(true);
    expect(tm.isCitationField('Cites')).toBe(true);
    expect(tm.isCitationField('cited-by')).toBe(true);
  });

  it('classifies URL fields (local + remote)', () => {
    expect(tm.isLocalFileField('Local-Url')).toBe(true);
    expect(tm.isRemoteURLField('Url')).toBe(true);
    expect(tm.isRemoteURLField('Doi')).toBe(true);
    expect(tm.isURLField('local-url')).toBe(true); // derived union
    expect(tm.isURLField('doi')).toBe(true);
    expect(tm.isURLField('Title')).toBe(false);
  });

  it('derives integer fields = rating ∪ triState ∪ boolean', () => {
    expect(tm.isIntegerField('Rating')).toBe(true);
    expect(tm.isIntegerField('Read')).toBe(true);
    expect(tm.isIntegerField('Author')).toBe(false);
  });
});

describe('TypeManager — hardcoded code-level sets', () => {
  const tm = new TypeManager();

  it('noteFieldsSet = Annote/Abstract/Rss-Description', () => {
    expect(tm.isNoteField('Annote')).toBe(true);
    expect(tm.isNoteField('Abstract')).toBe(true);
    expect(tm.isNoteField('Rss-Description')).toBe(true);
    expect(tm.isNoteField('Title')).toBe(false);
  });

  it('numericFieldsSet = Year/Volume/Number/Pages', () => {
    ['Year', 'Volume', 'Number', 'Pages'].forEach((f) =>
      expect(tm.isNumericField(f)).toBe(true),
    );
    expect(tm.isNumericField('Author')).toBe(false);
  });

  it('titleFieldsSet = Title/Chapter/Pages/BibTeX Type', () => {
    ['Title', 'Chapter', 'Pages', 'BibTeX Type'].forEach((f) =>
      expect(tm.isTitleField(f)).toBe(true),
    );
  });

  it('containerFieldsSet = Title/Booktitle/Journal/Volume/Series/BibTeX Type', () => {
    ['Title', 'Booktitle', 'Journal', 'Volume', 'Series', 'BibTeX Type'].forEach(
      (f) => expect(tm.isContainerField(f)).toBe(true),
    );
  });

  it('invalidGroupFieldsSet includes core list ∪ URL fields', () => {
    expect(tm.isInvalidGroupField('Date-Added')).toBe(true);
    expect(tm.isInvalidGroupField('Abstract')).toBe(true);
    expect(tm.isInvalidGroupField('Local-Url')).toBe(true); // from URL union
    expect(tm.isInvalidGroupField('Url')).toBe(true);
  });

  it('singleValuedGroupFieldsSet includes core list ∪ integer fields', () => {
    expect(tm.isSingleValuedGroupField('Journal')).toBe(true);
    expect(tm.isSingleValuedGroupField('Year')).toBe(true);
    expect(tm.isSingleValuedGroupField('Bdsk-Color')).toBe(true);
    expect(tm.isSingleValuedGroupField('Rating')).toBe(true); // integer union
    expect(tm.isSingleValuedGroupField('Read')).toBe(true);
  });
});

describe('TypeManager — shouldTeXifyField', () => {
  const tm = new TypeManager();
  it('does NOT TeXify URL/local-file/citation/note fields', () => {
    expect(tm.shouldTeXifyField('Url')).toBe(false);
    expect(tm.shouldTeXifyField('Local-Url')).toBe(false);
    expect(tm.shouldTeXifyField('Cites')).toBe(false);
    expect(tm.shouldTeXifyField('Annote')).toBe(false);
    expect(tm.shouldTeXifyField('Abstract')).toBe(false);
  });
  it('DOES TeXify normal fields', () => {
    expect(tm.shouldTeXifyField('Title')).toBe(true);
    expect(tm.shouldTeXifyField('Author')).toBe(true);
    expect(tm.shouldTeXifyField('Journal')).toBe(true);
  });
});

describe('TypeManager — user field-type overlay', () => {
  it('adds a custom person field and recomputes', () => {
    const tm = new TypeManager();
    expect(tm.isPersonField('Translator')).toBe(false);
    tm.setFieldTypeOverrides({ 'Person fields': ['Author', 'Editor', 'Translator'] });
    expect(tm.isPersonField('Translator')).toBe(true);
    expect(tm.isPersonField('Author')).toBe(true);
  });

  it('recomputes derived URL set after override', () => {
    const tm = new TypeManager();
    tm.setFieldTypeOverrides({ 'Remote URL Fields': ['Url', 'Doi', 'Eprint'] });
    expect(tm.isURLField('Eprint')).toBe(true);
    expect(tm.shouldTeXifyField('Eprint')).toBe(false);
    expect(tm.isInvalidGroupField('Eprint')).toBe(true); // derived set updated
  });

  it('recomputes derived integer set after override', () => {
    const tm = new TypeManager();
    tm.setFieldTypeOverrides({ 'Three state fields': ['Verified'] });
    expect(tm.isTriStateField('Verified')).toBe(true);
    expect(tm.isIntegerField('Verified')).toBe(true);
    expect(tm.isSingleValuedGroupField('Verified')).toBe(true);
  });

  it('resetFieldTypeOverrides restores factory defaults', () => {
    const tm = new TypeManager();
    tm.setFieldTypeOverrides({ 'Person fields': ['Foo'] });
    expect(tm.isPersonField('Author')).toBe(false);
    tm.resetFieldTypeOverrides();
    expect(tm.isPersonField('Author')).toBe(true);
    expect(tm.isPersonField('Foo')).toBe(false);
  });

  it('does not mutate config defaults across instances', () => {
    const a = new TypeManager();
    a.setFieldTypeOverrides({ 'Person fields': ['Only'] });
    const b = new TypeManager();
    expect(b.isPersonField('Author')).toBe(true);
    expect(b.isPersonField('Only')).toBe(false);
  });
});

describe('TypeManager — required/optional fields & TypeInfo overlay', () => {
  const tm = new TypeManager();

  it('returns required/optional from config', () => {
    expect(tm.requiredFieldsForType('article')).toEqual([
      'Author',
      'Title',
      'Journal',
      'Year',
    ]);
    expect(tm.optionalFieldsForType('Article')).toContain('Volume'); // case-insensitive
  });

  it('regularFieldsForType = required ∪ optional (deduped)', () => {
    const reg = tm.regularFieldsForType('article');
    expect(reg).toContain('Author');
    expect(reg).toContain('Volume');
  });

  it('protects standard types from overlay', () => {
    const tm2 = new TypeManager();
    tm2.setTypeInfoOverlay({
      article: { required: ['Foo'], optional: [] }, // attempt to override standard type
    });
    // standard type unchanged
    expect(tm2.requiredFieldsForType('article')).toEqual([
      'Author',
      'Title',
      'Journal',
      'Year',
    ]);
  });

  it('applies overlay for a custom (non-standard) type', () => {
    const tm2 = new TypeManager();
    tm2.setTypeInfoOverlay({
      dataset: { required: ['Author', 'Title'], optional: ['Year'] },
    });
    expect(tm2.isKnownType('dataset')).toBe(true);
    expect(tm2.requiredFieldsForType('dataset')).toEqual(['Author', 'Title']);
    expect(tm2.optionalFieldsForType('DATASET')).toEqual(['Year']);
  });

  it('isStandardType identifies the 15 protected types', () => {
    expect(tm.isStandardType('article')).toBe(true);
    expect(tm.isStandardType('ARTICLE')).toBe(true);
    expect(tm.isStandardType('dataset')).toBe(false);
  });

  it('clearTypeInfoOverlay reverts', () => {
    const tm2 = new TypeManager();
    tm2.setTypeInfoOverlay({ dataset: { required: ['X'], optional: [] } });
    expect(tm2.isKnownType('dataset')).toBe(true);
    tm2.clearTypeInfoOverlay();
    expect(tm2.isKnownType('dataset')).toBe(false);
  });
});
