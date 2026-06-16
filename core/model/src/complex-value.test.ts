import { describe, it, expect } from 'vitest';
import {
  complexValue,
  stringNode,
  numberNode,
  macroNode,
  isComplex,
  normalizeValue,
  hasMacro,
  expandComplexValue,
  complexValueToBibTeX,
  valuesEqual,
  type MacroLookup,
} from './complex-value.js';

const lookup = (defs: Record<string, string>): MacroLookup => ({
  definitionOf: (name) => defs[name.toLowerCase()],
});

describe('complex-value construction', () => {
  it('treats plain strings as simple values', () => {
    expect(isComplex('hello')).toBe(false);
    expect(isComplex(complexValue([macroNode('jan')]))).toBe(true);
  });

  it('rejects empty node lists', () => {
    expect(() => complexValue([])).toThrow();
  });

  it('freezes nodes', () => {
    const cv = complexValue([stringNode('a')]);
    expect(Object.isFrozen(cv.nodes)).toBe(true);
  });

  it('normalizeValue collapses a single literal node to a string', () => {
    expect(normalizeValue(complexValue([stringNode('plain')]))).toBe('plain');
    expect(normalizeValue(complexValue([numberNode('2024')]))).toBe('2024');
    // a single macro node stays complex
    expect(isComplex(normalizeValue(complexValue([macroNode('jan')])) )).toBe(true);
    // multi-node stays complex
    expect(
      isComplex(normalizeValue(complexValue([stringNode('a'), stringNode('b')]))),
    ).toBe(true);
  });

  it('hasMacro detects macro references', () => {
    expect(hasMacro('plain')).toBe(false);
    expect(hasMacro(complexValue([stringNode('a')]))).toBe(false);
    expect(hasMacro(complexValue([macroNode('jan')]))).toBe(true);
  });
});

describe('complex-value expansion', () => {
  it('expands a plain string to itself', () => {
    expect(expandComplexValue('plain', lookup({}))).toBe('plain');
  });

  it('expands a concatenation of literals and macros', () => {
    // jan # " and " # feb
    const cv = complexValue([
      macroNode('jan'),
      stringNode(' and '),
      macroNode('feb'),
    ]);
    const r = lookup({ jan: 'January', feb: 'February' });
    expect(expandComplexValue(cv, r)).toBe('January and February');
  });

  it('leaves undefined macros as their bare name', () => {
    const cv = complexValue([macroNode('unknownmacro')]);
    expect(expandComplexValue(cv, lookup({}))).toBe('unknownmacro');
  });

  it('expands nested macros (definition referencing another macro)', () => {
    const r: MacroLookup = {
      definitionOf: (name) => {
        const n = name.toLowerCase();
        if (n === 'a') return complexValue([macroNode('b'), stringNode('!')]);
        if (n === 'b') return 'BEE';
        return undefined;
      },
    };
    expect(expandComplexValue(complexValue([macroNode('a')]), r)).toBe('BEE!');
  });

  it('is cycle-safe (self-referential macro)', () => {
    const r: MacroLookup = {
      definitionOf: (name) =>
        name.toLowerCase() === 'a'
          ? complexValue([macroNode('a'), stringNode('x')])
          : undefined,
    };
    // should not hang; the recursive 'a' resolves to its bare name
    expect(expandComplexValue(complexValue([macroNode('a')]), r)).toBe('ax');
  });

  it('is cycle-safe (mutual recursion)', () => {
    const r: MacroLookup = {
      definitionOf: (name) => {
        const n = name.toLowerCase();
        if (n === 'a') return complexValue([macroNode('b')]);
        if (n === 'b') return complexValue([macroNode('a')]);
        return undefined;
      },
    };
    expect(() =>
      expandComplexValue(complexValue([macroNode('a')]), r),
    ).not.toThrow();
  });
});

describe('complexValueToBibTeX', () => {
  it('wraps simple strings in braces', () => {
    expect(complexValueToBibTeX('hello')).toBe('{hello}');
  });
  it('renders concatenation with # and bare macros/numbers', () => {
    const cv = complexValue([
      macroNode('jan'),
      stringNode(' and '),
      numberNode('2024'),
    ]);
    expect(complexValueToBibTeX(cv)).toBe('jan # { and } # 2024');
  });
});

describe('valuesEqual', () => {
  it('compares simple strings by value', () => {
    expect(valuesEqual('a', 'a')).toBe(true);
    expect(valuesEqual('a', 'b')).toBe(false);
  });
  it('compares complex values node-by-node', () => {
    expect(
      valuesEqual(
        complexValue([macroNode('jan'), stringNode('x')]),
        complexValue([macroNode('jan'), stringNode('x')]),
      ),
    ).toBe(true);
    expect(
      valuesEqual(
        complexValue([macroNode('jan')]),
        complexValue([macroNode('feb')]),
      ),
    ).toBe(false);
  });
  it('a simple and complex value never compare equal', () => {
    expect(valuesEqual('jan', complexValue([macroNode('jan')]))).toBe(false);
  });
});
