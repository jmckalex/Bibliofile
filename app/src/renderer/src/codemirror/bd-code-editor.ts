/**
 * <bd-code-editor> — a CodeMirror 6 source editor as a framework-agnostic custom
 * element, used for editing Markdown (entry annotations) and HTML/Handlebars
 * (export + panel templates) with syntax highlighting.
 *
 * Adapted from the `<folio-editor>` web component in the author's Folio app
 * (themes, highlight styles, and the GFM pipe-table + LaTeX-math view plugins
 * are ported from there). The key difference: CodeMirror is imported from the
 * `@codemirror/*` npm packages and bundled by Vite, rather than from a prebuilt
 * blob — BibDesk has a real bundler, so one shared dependency tree comes for
 * free. Theme colours map onto BibDesk's `--bd-*` CSS custom properties (which
 * pierce the shadow boundary), so the editor tracks the app's light/dark theme.
 *
 * Attributes:
 *   value        initial content (also a property)
 *   language     "markdown" (default) | "html"
 *   theme        "light" | "dark" (default follows the document theme)
 *   placeholder  placeholder text when empty
 *   readonly     present → not editable
 *   min-height   CSS min-height (default "180px")
 *
 * Properties:  .value (get/set), .editorView (escape hatch)
 * Methods:     .getValue(), .setValue(str), .insertAtCursor(text), .focus()
 * Events:      "bd-input" (detail = full doc string), "bd-focus", "bd-blur",
 *              "bd-drop" (detail = { files: FileList })
 */
import {
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  highlightSpecialChars,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { EditorState, Compartment, RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  HighlightStyle,
  syntaxHighlighting,
  indentOnInput,
  bracketMatching,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { oneDarkTheme } from '@codemirror/theme-one-dark';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';

// ---------------------------------------------------------------------------
//  Syntax highlight styles — Atom One Light / Dark palettes (theme-independent
//  syntax colours; the chrome themes below pick which one is active).
// ---------------------------------------------------------------------------

const lightHighlight = HighlightStyle.define([
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.url, tags.processingInstruction],
    color: '#4078f2',
  },
  { tag: [tags.tagName, tags.heading], color: '#e45649' },
  { tag: tags.comment, color: '#a0a1a7', fontStyle: 'italic' },
  { tag: [tags.propertyName], color: '#383a42' },
  { tag: [tags.attributeName, tags.number], color: '#986801' },
  { tag: tags.className, color: '#c18401' },
  { tag: tags.keyword, color: '#a626a4' },
  { tag: [tags.string, tags.regexp, tags.special(tags.propertyName)], color: '#50a14f' },
  { tag: tags.operator, color: '#0184bb' },
  { tag: tags.bool, color: '#986801' },
  { tag: tags.null, color: '#986801' },
  { tag: tags.atom, color: '#0184bb' },
  { tag: tags.variableName, color: '#383a42' },
  { tag: tags.definition(tags.variableName), color: '#e45649' },
  { tag: tags.separator, color: '#383a42' },
  { tag: tags.inserted, color: '#50a14f' },
  { tag: tags.invalid, color: '#c91243' },
  // Markdown inline formatting
  { tag: tags.heading1, color: '#e45649', fontWeight: 'bold', fontSize: '1.2em' },
  { tag: tags.heading2, color: '#e45649', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: '#4078f2' },
  { tag: tags.monospace, color: '#e45649', fontFamily: 'var(--bd-mono, monospace)' },
  { tag: tags.quote, color: '#a0a1a7', fontStyle: 'italic' },
  { tag: tags.meta, color: '#a0a1a7' },
  { tag: tags.contentSeparator, color: '#d5d0c8' },
]);

const darkHighlight = HighlightStyle.define([
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.url, tags.processingInstruction],
    color: 'hsl(207, 82%, 66%)',
  },
  { tag: [tags.tagName, tags.heading], color: '#e06c75' },
  { tag: tags.comment, color: '#54636D', fontStyle: 'italic' },
  { tag: [tags.propertyName], color: 'hsl(220, 14%, 71%)' },
  { tag: [tags.attributeName, tags.number], color: 'hsl(29, 54%, 61%)' },
  { tag: tags.className, color: 'hsl(39, 67%, 69%)' },
  { tag: tags.keyword, color: 'hsl(286, 60%, 67%)' },
  { tag: [tags.string, tags.regexp, tags.special(tags.propertyName)], color: '#98c379' },
  { tag: tags.operator, color: '#56b6c2' },
  { tag: tags.bool, color: '#d19a66' },
  { tag: tags.null, color: '#d19a66' },
  { tag: tags.atom, color: '#d19a66' },
  { tag: tags.variableName, color: '#abb2bf' },
  { tag: tags.definition(tags.variableName), color: '#e06c75' },
  { tag: tags.separator, color: '#abb2bf' },
  { tag: tags.inserted, color: '#98c379' },
  { tag: tags.invalid, color: '#ffffff' },
  { tag: tags.heading1, fontWeight: 'bold', fontSize: '1.2em' },
  { tag: tags.heading2, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'hsl(207, 82%, 66%)' },
  { tag: tags.monospace, fontFamily: 'var(--bd-mono, monospace)' },
  { tag: tags.quote, fontStyle: 'italic' },
  { tag: tags.contentSeparator, color: '#5c6370' },
]);

// ---------------------------------------------------------------------------
//  Chrome themes — wired to BibDesk's --bd-* variables (with fallbacks). Custom
//  properties inherit through the shadow boundary, so these follow app theme.
// ---------------------------------------------------------------------------

const lightTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--bd-surface, #ffffff)', color: 'var(--bd-text, #1c2230)' },
    '.cm-content': { caretColor: 'var(--bd-accent, #2563eb)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--bd-accent, #2563eb)' },
    // Selection = the drawn layer (drawSelection). We MUST match CM's own
    // selectors — including its high-specificity *focused* rule — or our colour
    // loses to CM's stock lavender (#d7d4f0) exactly while the editor is focused.
    // (drawSelection forces the native ::selection transparent, so styling that is moot.)
    '& .cm-selectionBackground': { backgroundColor: 'var(--bd-selected, #d9e7ff)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: 'var(--bd-selected, #d9e7ff)',
    },
    '.cm-activeLine': { backgroundColor: 'var(--bd-hover, rgba(37,99,235,0.06))' },
    '.cm-gutters': {
      backgroundColor: 'var(--bd-surface-alt, #f2f4f7)',
      color: 'var(--bd-text-faint, #9aa3b2)',
      borderRight: '1px solid var(--bd-border, #e2e6ec)',
    },
  },
  { dark: false },
);

const darkTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--bd-surface, #1b1f27)', color: 'var(--bd-text, #e6e9ef)' },
    '.cm-content': { caretColor: 'var(--bd-accent, #6ea8fe)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--bd-accent, #6ea8fe)' },
    // See the light theme above: match CM's focused-selection selector so our
    // colour wins (it also overrides oneDarkTheme's lower-specificity rule).
    '& .cm-selectionBackground': { backgroundColor: 'var(--bd-selected, #2a3a57)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: 'var(--bd-selected, #2a3a57)',
    },
    '.cm-activeLine': { backgroundColor: 'var(--bd-hover, rgba(110,168,254,0.08))' },
    '.cm-gutters': {
      backgroundColor: 'var(--bd-surface-alt, #232833)',
      color: 'var(--bd-text-faint, #6b7280)',
      borderRight: '1px solid var(--bd-border, #2b313c)',
    },
  },
  { dark: true },
);

const baseTheme = EditorView.theme({
  '&': {
    fontSize: 'var(--bd-fs-sm, 12.5px)',
    fontFamily: 'var(--bd-mono, ui-monospace, monospace)',
    border: '1px solid var(--bd-border, #d5d0c8)',
    borderRadius: 'var(--bd-radius, 6px)',
    overflow: 'hidden',
  },
  '&.cm-focused': { outline: 'none', borderColor: 'var(--bd-accent, #2563eb)' },
  '.cm-scroller': { lineHeight: '1.6', fontFamily: 'inherit', overflow: 'auto' },
  '.cm-content': { padding: '10px', fontFamily: 'inherit' },
  '.cm-line': { padding: '0 2px' },
  '.cm-placeholder': { color: 'var(--bd-text-faint, #9aa3b2)', fontStyle: 'italic' },
  '.cm-selectionMatch': { backgroundColor: 'var(--bd-accent-soft, rgba(37,99,235,0.15))' },
});

const dropHighlightTheme = EditorView.theme({
  '&.bd-drop-hover': {
    borderColor: 'var(--bd-accent, #2563eb) !important',
    backgroundColor: 'var(--bd-accent-soft, rgba(37,99,235,0.12)) !important',
    boxShadow: '0 0 0 2px var(--bd-accent-soft, rgba(37,99,235,0.18))',
  },
});

// ---------------------------------------------------------------------------
//  Markdown-only view plugins (ported from Folio): GFM-style pipe-table
//  highlighting + LaTeX-math ($…$ / $$…$$) source decoration.
// ---------------------------------------------------------------------------

const pipeTableTheme = EditorView.theme({
  '.cm-pipeTableLine': { backgroundColor: 'var(--bd-accent-soft, rgba(37,99,235,0.05))', borderRadius: '2px' },
  '.cm-pipeTablePipe': { color: 'var(--bd-text-faint, #707078)', fontWeight: '600' },
});

const PIPE_LINE_RE = /^\s*\|.+\|\s*$/;
const PIPE_CHAR_RE = /\|/g;
const pipeTableLineDeco = Decoration.line({ class: 'cm-pipeTableLine' });
const pipeTablePipeDeco = Decoration.mark({ class: 'cm-pipeTablePipe' });

const pipeTablePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const { from, to } = view.viewport;
      for (let pos = from; pos <= to; ) {
        const line = view.state.doc.lineAt(pos);
        if (PIPE_LINE_RE.test(line.text)) {
          builder.add(line.from, line.from, pipeTableLineDeco);
          let m: RegExpExecArray | null;
          PIPE_CHAR_RE.lastIndex = 0;
          while ((m = PIPE_CHAR_RE.exec(line.text)) !== null) {
            const at = line.from + m.index;
            builder.add(at, at + 1, pipeTablePipeDeco);
          }
        }
        pos = line.to + 1;
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

const latexMathTheme = EditorView.theme({
  '.cm-latexDelimiter': { color: 'var(--bd-accent, #2563eb)', fontWeight: '600' },
  '.cm-latexCommand': { color: '#c678dd' },
  '.cm-latexBrace': { color: '#e5c07b', fontWeight: '600' },
  '.cm-latexOperator': { color: '#56b6c2' },
});

const latexDelimiterDeco = Decoration.mark({ class: 'cm-latexDelimiter' });
const latexCommandDeco = Decoration.mark({ class: 'cm-latexCommand' });
const latexBraceDeco = Decoration.mark({ class: 'cm-latexBrace' });
const latexOperatorDeco = Decoration.mark({ class: 'cm-latexOperator' });

const LATEX_CMD_RE = /\\(?:(?:big{1,2}|Big{1,2}|left|right)(?:\\[{}|]|[(\[\])|.\/])?|[a-zA-Z@]+|[\\,;!>{}|&%#_^~$ ])/g;
const LATEX_BRACE_RE = /[{}]/g;
const LATEX_OP_RE = /[_^&]/g;

interface PendingDeco {
  from: number;
  to: number;
  deco: Decoration;
}

/** Find $…$ and single-line $$…$$ spans in a line; returns [start,end] offsets. */
function findMathSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === '$') {
      const isDouble = text[i + 1] === '$';
      const delimLen = isDouble ? 2 : 1;
      const start = i;
      i += delimLen;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === '$') {
          const closeDouble = text[i + 1] === '$';
          if (isDouble === closeDouble) {
            spans.push([start, i + delimLen]);
            i += delimLen;
            break;
          }
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return spans;
}

function decorateMathInner(inner: string, innerStart: number, decos: PendingDeco[]): void {
  let m: RegExpExecArray | null;
  LATEX_CMD_RE.lastIndex = 0;
  while ((m = LATEX_CMD_RE.exec(inner)) !== null) {
    decos.push({ from: innerStart + m.index, to: innerStart + m.index + m[0]!.length, deco: latexCommandDeco });
  }
  LATEX_BRACE_RE.lastIndex = 0;
  while ((m = LATEX_BRACE_RE.exec(inner)) !== null) {
    decos.push({ from: innerStart + m.index, to: innerStart + m.index + 1, deco: latexBraceDeco });
  }
  LATEX_OP_RE.lastIndex = 0;
  while ((m = LATEX_OP_RE.exec(inner)) !== null) {
    decos.push({ from: innerStart + m.index, to: innerStart + m.index + 1, deco: latexOperatorDeco });
  }
}

const latexMathPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const { from, to } = view.viewport;
      const decos: PendingDeco[] = [];

      // Pass 1: multi-line $$…$$ blocks.
      const multiLineRanges: Array<[number, number]> = [];
      let openPos: number | null = null;
      for (let pos = from; pos <= to; ) {
        const line = view.state.doc.lineAt(pos);
        const trimmed = line.text.trim();
        if (openPos === null) {
          if (trimmed === '$$' || (trimmed.startsWith('$$') && !trimmed.endsWith('$$'))) openPos = line.from;
        } else if (trimmed === '$$' || trimmed.endsWith('$$')) {
          multiLineRanges.push([openPos, line.from + line.text.lastIndexOf('$$') + 2]);
          openPos = null;
        }
        pos = line.to + 1;
      }
      for (const [blockStart, blockEnd] of multiLineRanges) {
        decos.push({ from: blockStart, to: blockStart + 2, deco: latexDelimiterDeco });
        decos.push({ from: blockEnd - 2, to: blockEnd, deco: latexDelimiterDeco });
        const innerStart = blockStart + 2;
        const innerEnd = blockEnd - 2;
        if (innerEnd > innerStart) {
          decorateMathInner(view.state.doc.sliceString(innerStart, innerEnd), innerStart, decos);
        }
      }

      // Pass 2: single-line $…$ / $$…$$ spans.
      for (let pos = from; pos <= to; ) {
        const line = view.state.doc.lineAt(pos);
        const inMultiLine = multiLineRanges.some(([s, e]) => line.from >= s && line.to <= e);
        if (!inMultiLine) {
          for (const [spanStart, spanEnd] of findMathSpans(line.text)) {
            const absStart = line.from + spanStart;
            const absEnd = line.from + spanEnd;
            const isDouble = line.text[spanStart + 1] === '$';
            const delimLen = isDouble ? 2 : 1;
            decos.push({ from: absStart, to: absStart + delimLen, deco: latexDelimiterDeco });
            decos.push({ from: absEnd - delimLen, to: absEnd, deco: latexDelimiterDeco });
            decorateMathInner(line.text.slice(spanStart + delimLen, spanEnd - delimLen), absStart + delimLen, decos);
          }
        }
        pos = line.to + 1;
      }

      decos.sort((a, b) => a.from - b.from || a.to - b.to);
      for (const d of decos) builder.add(d.from, d.to, d.deco);
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

// ---------------------------------------------------------------------------
//  Language extensions
// ---------------------------------------------------------------------------

type EditorLanguage = 'markdown' | 'html';

/** The language parser + language-specific extras (markdown gets the plugins +
 *  native spellcheck; HTML stays plain so tags aren't flagged as misspellings). */
function languageExtension(language: EditorLanguage): Extension {
  if (language === 'html') return html();
  return [
    markdown({ base: markdownLanguage }),
    pipeTablePlugin,
    latexMathPlugin,
    EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'off', autocapitalize: 'off' }),
  ];
}

function themeExtension(dark: boolean): Extension {
  return dark
    ? [darkTheme, oneDarkTheme, syntaxHighlighting(darkHighlight)]
    : [lightTheme, syntaxHighlighting(lightHighlight)];
}

// ---------------------------------------------------------------------------
//  The custom element
// ---------------------------------------------------------------------------

export class BdCodeEditor extends HTMLElement {
  static observedAttributes = ['value', 'placeholder', 'theme', 'readonly', 'min-height', 'language'];

  private root: ShadowRoot;
  private view: EditorView | null = null;
  private readonly themeCompartment = new Compartment();
  private readonly readonlyCompartment = new Compartment();
  private readonly placeholderCompartment = new Compartment();
  private readonly languageCompartment = new Compartment();
  /** Guards the change listener while we set content programmatically. */
  private settingValue = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  private get language(): EditorLanguage {
    return this.getAttribute('language') === 'html' ? 'html' : 'markdown';
  }

  /** Dark unless theme="light"; defaults to the document's data-theme. */
  private get isDark(): boolean {
    const attr = this.getAttribute('theme');
    if (attr === 'light') return false;
    if (attr === 'dark') return true;
    return document.documentElement.dataset.theme === 'dark';
  }

  connectedCallback(): void {
    if (this.view) return; // already initialised

    const wrapper = document.createElement('div');
    wrapper.className = 'bd-cm-root';
    this.root.appendChild(wrapper);

    const style = document.createElement('style');
    style.textContent = `
      :host { display: block; min-height: ${this.getAttribute('min-height') || '180px'}; }
      .bd-cm-root { height: 100%; display: flex; flex-direction: column; }
      .cm-editor { flex: 1; min-height: inherit; }
    `;
    this.root.appendChild(style);

    const placeholderText = this.getAttribute('placeholder') || '';
    const extensions: Extension[] = [
      baseTheme,
      dropHighlightTheme,
      pipeTableTheme,
      latexMathTheme,
      this.themeCompartment.of(themeExtension(this.isDark)),
      this.readonlyCompartment.of(EditorState.readOnly.of(this.hasAttribute('readonly'))),
      this.placeholderCompartment.of(placeholderText ? cmPlaceholder(placeholderText) : []),
      this.languageCompartment.of(languageExtension(this.language)),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !this.settingValue) {
          this.dispatchEvent(
            new CustomEvent('bd-input', { detail: update.state.doc.toString(), bubbles: true, composed: true }),
          );
        }
      }),
      EditorView.domEventHandlers({
        focus: () => this.dispatchEvent(new CustomEvent('bd-focus', { bubbles: true, composed: true })),
        blur: () => this.dispatchEvent(new CustomEvent('bd-blur', { bubbles: true, composed: true })),
      }),
    ];

    this.view = new EditorView({
      state: EditorState.create({ doc: this.getAttribute('value') || '', extensions }),
      parent: wrapper,
      root: this.root,
    });

    // File-drop → re-emit as bd-drop so the host can embed/attach resources.
    const dom = this.view.dom;
    dom.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        dom.classList.add('bd-drop-hover');
      }
    });
    dom.addEventListener('dragleave', (e) => {
      if (!dom.contains(e.relatedTarget as Node | null)) dom.classList.remove('bd-drop-hover');
    });
    dom.addEventListener('drop', (e) => {
      dom.classList.remove('bd-drop-hover');
      if (e.dataTransfer?.files?.length) {
        e.preventDefault();
        e.stopPropagation();
        this.dispatchEvent(
          new CustomEvent('bd-drop', { detail: { files: e.dataTransfer.files }, bubbles: true, composed: true }),
        );
      }
    });
  }

  disconnectedCallback(): void {
    this.view?.destroy();
    this.view = null;
  }

  attributeChangedCallback(name: string, _oldVal: string | null, newVal: string | null): void {
    if (!this.view) return;
    switch (name) {
      case 'value':
        if ((newVal || '') !== this.value) this.setValue(newVal || '');
        break;
      case 'placeholder':
        this.view.dispatch({
          effects: this.placeholderCompartment.reconfigure(newVal ? cmPlaceholder(newVal) : []),
        });
        break;
      case 'theme':
        this.view.dispatch({ effects: this.themeCompartment.reconfigure(themeExtension(this.isDark)) });
        break;
      case 'language':
        this.view.dispatch({ effects: this.languageCompartment.reconfigure(languageExtension(this.language)) });
        break;
      case 'readonly':
        this.view.dispatch({
          effects: this.readonlyCompartment.reconfigure(EditorState.readOnly.of(this.hasAttribute('readonly'))),
        });
        break;
      case 'min-height': {
        const style = this.root.querySelector('style');
        if (style) style.textContent = style.textContent.replace(/min-height:\s*[^;]+;/, `min-height: ${newVal || '180px'};`);
        break;
      }
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  get value(): string {
    return this.view ? this.view.state.doc.toString() : this.getAttribute('value') || '';
  }

  set value(str: string) {
    this.setValue(str);
  }

  getValue(): string {
    return this.value;
  }

  /** Replace the whole document without firing bd-input. */
  setValue(str: string): void {
    if (!this.view) return;
    this.settingValue = true;
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: str || '' } });
    this.settingValue = false;
  }

  insertAtCursor(text: string): void {
    if (!this.view) return;
    this.view.dispatch(this.view.state.replaceSelection(text));
    this.view.focus();
  }

  override focus(): void {
    this.view?.focus();
  }

  get editorView(): EditorView | null {
    return this.view;
  }
}

if (!customElements.get('bd-code-editor')) {
  customElements.define('bd-code-editor', BdCodeEditor);
}
