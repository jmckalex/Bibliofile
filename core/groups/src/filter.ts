/**
 * `BDSKFilter` — an ordered list of {@link Condition}s combined by a
 * {@link Conjunction}. Port of `-[BDSKFilter testItem:]` (BDSKFilter.m:138-149).
 *
 * Short-circuiting (verbatim):
 *   - empty conditions ⇒ match everything;
 *   - OR  ⇒ true on the first satisfied condition, else false;
 *   - AND ⇒ false on the first unsatisfied condition, else true.
 */
import { Conjunction } from './comparison.js';
import { Condition, type EvaluableItem, type EvaluateOptions } from './condition.js';

export class Filter {
  readonly conjunction: Conjunction;
  readonly conditions: readonly Condition[];

  constructor(conditions: readonly Condition[], conjunction: Conjunction = Conjunction.And) {
    this.conditions = conditions;
    this.conjunction = conjunction;
  }

  /** Pure membership test. Mirrors `-[BDSKFilter testItem:]`. */
  evaluate(item: EvaluableItem, opts: EvaluateOptions = {}): boolean {
    if (this.conditions.length === 0) return true;
    const isOr = this.conjunction === Conjunction.Or;
    for (const condition of this.conditions) {
      if (condition.evaluate(item, opts) === isOr) return isOr;
    }
    return !isOr;
  }
}

/** Functional form of {@link Filter.evaluate}. */
export function evaluateFilter(
  filter: Filter,
  item: EvaluableItem,
  opts: EvaluateOptions = {},
): boolean {
  return filter.evaluate(item, opts);
}
