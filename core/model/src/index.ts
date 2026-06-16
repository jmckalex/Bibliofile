/**
 * @bibdesk/model — the platform-agnostic BibDesk domain layer.
 *
 * Exports the core value model (complex strings / macros), the `BibItem` domain
 * object with field/person/typed accessors and crossref inheritance, the
 * data-driven `TypeManager`, the 3-tier `MacroResolver`, equality/equivalence/
 * hash for duplicate detection, item author sorting, and a pure-TS event layer.
 *
 * No Electron, DOM, or Node-only runtime APIs. Consumed by `core/bibtex`
 * (parser/serializer) and the Electron app.
 */

// --- Events ----------------------------------------------------------------
/** Pure-TS synchronous emitter/observer (replaces NSNotificationCenter/KVO). */
export { Emitter, type Listener, type Unsubscribe } from './events.js';

// --- Complex values / macros value model -----------------------------------
/** Tagged field-value type and complex-string node helpers. */
export {
  type FieldValue,
  type ComplexValue,
  type StringNode,
  type MacroLookup,
  isComplex,
  stringNode,
  numberNode,
  macroNode,
  complexValue,
  normalizeValue,
  hasMacro,
  expandComplexValue,
  complexValueToBibTeX,
  valuesEqual,
} from './complex-value.js';

// --- Macro resolver ---------------------------------------------------------
/** Case-insensitive, 3-tier macro resolver with topo ordering + change events. */
export {
  MacroResolver,
  type MacroTier,
  type MacroChangeType,
  type MacroChangeEvent,
  buildMonthMacros,
} from './macro-resolver.js';

// --- Type manager -----------------------------------------------------------
/** Data-driven field/type classification with user overrides + hardcoded sets. */
export {
  TypeManager,
  sharedTypeManager,
  type FieldTypeSetOverrides,
  type TypeFields,
  type TypeInfoOverlay,
} from './type-manager.js';

// --- Linked files -----------------------------------------------------------
/** Linked-file/URL value type and constructors. */
export {
  type LinkedFile,
  localFile,
  remoteURL,
} from './linked-file.js';

// --- BibItem ----------------------------------------------------------------
/** The central domain object + its change events, factory, and helpers. */
export {
  BibItem,
  createBibItem,
  generateId,
  isEmptyValue,
  fieldsNeverInherited,
  FieldNames,
  type BibItemInit,
  type PublicationStore,
  type ItemChangeType,
  type ItemChangeEvent,
  type CrossrefError,
} from './bib-item.js';

// --- Equality / equivalence / hash -----------------------------------------
/** Item equality, fuzzy-author duplicate detection, and stable hashing. */
export {
  itemsEqual,
  itemsEquivalent,
  equivalenceHash,
  equivalenceKey,
} from './equality.js';

// --- Sorting ----------------------------------------------------------------
/** Item-level author sorting (field-first, sortableName, empty-last). */
export {
  compareAuthorsWithEmptyLast,
  compareItemsByAuthor,
} from './sort.js';
