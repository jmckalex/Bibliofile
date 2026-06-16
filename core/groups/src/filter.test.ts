import { describe, it, expect } from 'vitest';
import {
  Filter,
  Condition,
  Conjunction,
  StringComparison,
  evaluateFilter,
} from './index.js';
import { makeItem } from './test-helpers.js';

const c = (key: string, comparison: number, value: string): Condition =>
  new Condition({ key, comparison, value });

describe('Filter — conjunction semantics', () => {
  const item = makeItem({ fields: { Title: 'Gene', Author: 'Dawkins, Richard', Year: '1976' } });

  it('empty conditions match everything', () => {
    expect(new Filter([]).evaluate(item)).toBe(true);
    expect(new Filter([], Conjunction.Or).evaluate(item)).toBe(true);
  });

  it('AND: all conditions must hold', () => {
    const f = new Filter(
      [c('Title', StringComparison.Contain, 'gene'), c('Author', StringComparison.Contain, 'dawkins')],
      Conjunction.And,
    );
    expect(f.evaluate(item)).toBe(true);
    const f2 = new Filter(
      [c('Title', StringComparison.Contain, 'gene'), c('Author', StringComparison.Contain, 'darwin')],
      Conjunction.And,
    );
    expect(f2.evaluate(item)).toBe(false);
  });

  it('OR: any condition suffices', () => {
    const f = new Filter(
      [c('Title', StringComparison.Contain, 'absent'), c('Author', StringComparison.Contain, 'dawkins')],
      Conjunction.Or,
    );
    expect(f.evaluate(item)).toBe(true);
    const f2 = new Filter(
      [c('Title', StringComparison.Contain, 'absent'), c('Author', StringComparison.Contain, 'darwin')],
      Conjunction.Or,
    );
    expect(f2.evaluate(item)).toBe(false);
  });

  it('AND short-circuits to false; OR short-circuits to true', () => {
    let calls = 0;
    const spy = new Condition({ key: 'Title', comparison: StringComparison.Contain, value: 'gene' });
    const orig = spy.evaluate.bind(spy);
    (spy as unknown as { evaluate: typeof orig }).evaluate = (i, o) => {
      calls += 1;
      return orig(i, o);
    };
    const failing = c('Author', StringComparison.Contain, 'darwin');
    // AND: failing first -> spy never called
    calls = 0;
    new Filter([failing, spy], Conjunction.And).evaluate(item);
    expect(calls).toBe(0);
    // OR: a passing first -> spy never called
    calls = 0;
    new Filter([c('Title', StringComparison.Contain, 'gene'), spy], Conjunction.Or).evaluate(item);
    expect(calls).toBe(0);
  });

  it('evaluateFilter functional form matches the method', () => {
    const f = new Filter([c('Year', StringComparison.Equal, '1976')], Conjunction.And);
    expect(evaluateFilter(f, item)).toBe(f.evaluate(item));
    expect(evaluateFilter(f, item)).toBe(true);
  });
});
