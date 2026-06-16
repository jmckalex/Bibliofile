import { describe, it, expect } from 'vitest';
import { TypeManager } from '@bibdesk/model';
import { validateFormat, requiredFieldsForFormat } from './validate.js';
import { CITE_KEY_FIELD, LOCAL_FILE_FIELD } from './sanitize.js';

const tm = new TypeManager();

describe('validateFormat', () => {
  it('accepts a well-formed cite-key format', () => {
    const r = validateFormat('%a1:%Y%u2', CITE_KEY_FIELD, tm);
    expect(r.valid).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.sanitized).toBe('%a1:%Y%u2');
  });

  it('rejects an unknown specifier', () => {
    const r = validateFormat('%a%Q', CITE_KEY_FIELD, tm);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Invalid specifier %Q/);
  });

  it('rejects a duplicate unique specifier', () => {
    const r = validateFormat('%a%u%u', CITE_KEY_FIELD, tm);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/can appear only once/);
  });

  it('rejects %f without a {field}', () => {
    const r = validateFormat('%f', CITE_KEY_FIELD, tm);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/must be followed by a \{'field'\} name/);
  });

  it('accepts %f{Journal}', () => {
    const r = validateFormat('%f{Journal}', CITE_KEY_FIELD, tm);
    expect(r.valid).toBe(true);
  });

  it('rejects a trailing bare %', () => {
    const r = validateFormat('%a%', CITE_KEY_FIELD, tm);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Empty specifier/);
  });

  it('rejects an unclosed optional [ ... ]', () => {
    const r = validateFormat('%a[sep', CITE_KEY_FIELD, tm);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Missing "\]"/);
  });

  it('requires a unique specifier for a local-file format', () => {
    tm.setFieldTypeOverrides({ 'Local File Fields': [LOCAL_FILE_FIELD] });
    const bad = validateFormat('%a1%Y', LOCAL_FILE_FIELD, tm);
    expect(bad.valid).toBe(false);
    expect(bad.error).toMatch(/requires a unique specifier/);
    const good = validateFormat('%a1%Y%u', LOCAL_FILE_FIELD, tm);
    expect(good.valid).toBe(true);
    tm.resetFieldTypeOverrides();
  });

  it('rejects a local-file-only specifier in a cite-key format', () => {
    const r = validateFormat('%L', CITE_KEY_FIELD, tm);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/only valid in format for local file/);
  });
});

describe('requiredFieldsForFormat', () => {
  it('extracts the referenced field names', () => {
    expect(requiredFieldsForFormat('%a1:%Y%u2')).toEqual(['Author', 'Year']);
  });
  it('handles %f{...} and %i{...} and %b', () => {
    expect(requiredFieldsForFormat('%f{Journal}%b%i{Owner}')).toEqual([
      'Journal',
      'Document Filename',
      'Document: Owner',
    ]);
  });
  it('%p/%P yield Author and Editor', () => {
    expect(requiredFieldsForFormat('%p1')).toEqual(['Author', 'Editor']);
  });
});
