/**
 * Complex string values — the TypeScript replacement for BibDesk's
 * `BDSKComplexString` / `BDSKStringNode`.
 *
 * BibDesk made a complex value an `NSString` *subclass* so that macro
 * references and concatenations (`jan # " and " # feb`) flowed transparently
 * through all the same string APIs. That trick has no analogue in TypeScript,
 * so we use an explicit **tagged value type**:
 *
 *   - A *simple* value is just a plain `string` (the 95% case — no allocation,
 *     no wrapping).
 *   - A *complex* value is a {@link ComplexValue}: an ordered list of
 *     {@link StringNode}s that concatenate to produce the value, where a node
 *     may be a literal `string`, a bare `number`, or a `macro` reference.
 *
 * The expanded (display) form is computed on demand from a {@link MacroLookup}
 * (the {@link MacroResolver} satisfies this interface). Expansion is recursive
 * and cycle-safe.
 */

/** A node within a {@link ComplexValue}. */
export interface StringNode {
  /**
   * `string` — a brace/quote-delimited literal (`"..."` / `{...}`).
   * `number` — a bare BibTeX number token (e.g. `2024`).
   * `macro`  — a reference to a `@string` macro / built-in (e.g. `jan`).
   */
  readonly type: 'string' | 'number' | 'macro';
  /** The literal text, the number's digits, or the macro name. */
  readonly value: string;
}

/**
 * A field value that references macros and/or concatenates several pieces.
 * `nodes` is non-empty and read-only; build/transform via the helpers below.
 */
export interface ComplexValue {
  readonly nodes: readonly StringNode[];
}

/** A field value: a plain string (simple) or a {@link ComplexValue}. */
export type FieldValue = string | ComplexValue;

/**
 * Anything that can resolve a macro name to its (possibly still-complex)
 * definition. {@link MacroResolver} implements this; expansion only needs this
 * narrow surface, which keeps {@link expandComplexValue} decoupled from the
 * resolver implementation.
 */
export interface MacroLookup {
  /**
   * Return the raw definition for `name` (case-insensitive), or `undefined` if
   * undefined. The definition may itself be a {@link FieldValue} (simple or
   * complex), enabling nested macros.
   */
  definitionOf(name: string): FieldValue | undefined;
}

/** Type guard: is `value` a {@link ComplexValue} (vs a plain string)? */
export function isComplex(value: FieldValue): value is ComplexValue {
  return typeof value !== 'string';
}

/** Build a single-node literal-string complex value. */
export function stringNode(value: string): StringNode {
  return { type: 'string', value };
}

/** Build a single-node bare-number complex value. */
export function numberNode(value: string): StringNode {
  return { type: 'number', value };
}

/** Build a single-node macro-reference complex value. */
export function macroNode(name: string): StringNode {
  return { type: 'macro', value: name };
}

/**
 * Construct a {@link ComplexValue} from nodes. Throws on an empty list (a
 * complex value with no nodes is meaningless). The node array is frozen.
 */
export function complexValue(nodes: readonly StringNode[]): ComplexValue {
  if (nodes.length === 0) {
    throw new Error('complexValue requires at least one node');
  }
  return { nodes: Object.freeze([...nodes]) };
}

/**
 * Normalize a {@link FieldValue}: a complex value whose single node is a plain
 * `string`/`number` literal collapses to a bare string (matching BibDesk, where
 * such a value is not "complex"). Otherwise returns the value unchanged.
 */
export function normalizeValue(value: FieldValue): FieldValue {
  if (!isComplex(value)) return value;
  if (value.nodes.length === 1) {
    const only = value.nodes[0]!;
    if (only.type !== 'macro') return only.value;
  }
  return value;
}

/**
 * Does this value reference any macro? A plain string never does. Used to know
 * whether expansion depends on a resolver.
 */
export function hasMacro(value: FieldValue): boolean {
  if (!isComplex(value)) return false;
  return value.nodes.some((n) => n.type === 'macro');
}

const MAX_MACRO_DEPTH = 256;

/**
 * Expand a {@link FieldValue} to its display string, resolving macro nodes
 * through `resolver`.
 *
 * Mirrors `__BDStringCreateByCopyingExpandedValue`: literal/number nodes
 * contribute their text; a macro node contributes its resolved definition
 * (itself expanded recursively, so `a = b # c` works). An undefined macro
 * contributes its own name verbatim (BibDesk leaves the token as-is rather than
 * dropping it). Cycles are bounded by {@link MAX_MACRO_DEPTH} and by tracking
 * the active macro chain, so a self- or mutually-referential macro expands to
 * its literal name instead of looping forever.
 */
export function expandComplexValue(
  value: FieldValue,
  resolver: MacroLookup,
): string {
  if (!isComplex(value)) return value;
  return expandNodes(value.nodes, resolver, new Set<string>(), 0);
}

function expandNodes(
  nodes: readonly StringNode[],
  resolver: MacroLookup,
  active: Set<string>,
  depth: number,
): string {
  let out = '';
  for (const node of nodes) {
    if (node.type !== 'macro') {
      out += node.value;
      continue;
    }
    out += expandMacro(node.value, resolver, active, depth);
  }
  return out;
}

function expandMacro(
  name: string,
  resolver: MacroLookup,
  active: Set<string>,
  depth: number,
): string {
  const key = name.toLowerCase();
  // Cycle guard: a macro currently being expanded resolves to its own name.
  if (active.has(key) || depth >= MAX_MACRO_DEPTH) {
    return name;
  }
  const def = resolver.definitionOf(name);
  if (def === undefined) {
    // Undefined macro: leave the bare name (BibDesk keeps the token).
    return name;
  }
  if (!isComplex(def)) return def;
  active.add(key);
  try {
    return expandNodes(def.nodes, resolver, active, depth + 1);
  } finally {
    active.delete(key);
  }
}

/**
 * Serialize a {@link FieldValue} to its BibTeX representation (the raw form used
 * when editing-as-raw or for round-trip). This is a *model-level convenience*;
 * the canonical serializer lives in `core/bibtex`, but the rules are simple
 * enough to mirror here for the macro editor and tests:
 *
 *   - simple string  -> `{the value}`
 *   - number node    -> `1234` (bare)
 *   - macro node     -> `name` (bare)
 *   - string node    -> `{the value}`
 *   - concatenation  -> nodes joined by ` # `
 *
 * NOTE: this does not TeXify; the caller decides that (see TypeManager
 * `shouldTeXifyField`). Brace-balancing/escaping beyond wrapping is left to
 * `core/bibtex`.
 */
export function complexValueToBibTeX(value: FieldValue): string {
  if (!isComplex(value)) return `{${value}}`;
  return value.nodes.map(nodeToBibTeX).join(' # ');
}

function nodeToBibTeX(node: StringNode): string {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'macro':
      return node.value;
    case 'string':
      return `{${node.value}}`;
  }
}

/**
 * Structural equality of two {@link FieldValue}s (BibDesk's
 * `isEqualAsComplexString:`). Two simple strings compare by value; two complex
 * values compare node-by-node (type + value); a simple and a complex never
 * compare equal (even if they'd expand the same), matching BibDesk where the
 * node structure is part of identity.
 */
export function valuesEqual(a: FieldValue, b: FieldValue): boolean {
  const ca = isComplex(a);
  const cb = isComplex(b);
  if (ca !== cb) return false;
  if (!ca || !cb) return a === b;
  if (a.nodes.length !== b.nodes.length) return false;
  for (let i = 0; i < a.nodes.length; i++) {
    const na = a.nodes[i]!;
    const nb = b.nodes[i]!;
    if (na.type !== nb.type || na.value !== nb.value) return false;
  }
  return true;
}
