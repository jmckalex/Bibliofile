/**
 * React wrapper around the <bd-code-editor> custom element (CodeMirror 6).
 *
 * The element's `value` is managed imperatively through a ref — we never pass it
 * as a JSX attribute — to sidestep React 18's ambiguous attribute-vs-property
 * handling for custom elements. `language` / `theme` / `placeholder` / `readonly`
 * are plain string attributes React can set safely, and the element reconfigures
 * itself when they change. Theme follows the app's current light/dark setting.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from './store.js';
// Side-effect import: runs customElements.define('bd-code-editor', …). Kept on
// its own line so the transpiler can't elide it — the type-only import of the
// class below would otherwise be dropped, leaving the element unregistered.
import './codemirror/bd-code-editor.js';
import type { BdCodeEditor } from './codemirror/bd-code-editor.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'bd-code-editor': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        ref?: React.Ref<BdCodeEditor>;
        language?: string;
        theme?: string;
        placeholder?: string;
        readonly?: string;
        'min-height'?: string;
      };
    }
  }
}

export interface CodeEditorProps {
  /** Current document text (controlled). */
  value: string;
  /** Fires on user edits with the full document string. */
  onChange: (value: string) => void;
  /** Fires when the editor loses focus (good for commit-on-blur). */
  onBlur?: () => void;
  language?: 'markdown' | 'html' | 'javascript';
  placeholder?: string;
  readOnly?: boolean;
  /** CSS min-height for the editor (default 180px). */
  minHeight?: string;
  autoFocus?: boolean;
}

export function CodeEditor({
  value,
  onChange,
  onBlur,
  language = 'markdown',
  placeholder,
  readOnly = false,
  minHeight,
  autoFocus = false,
}: CodeEditorProps) {
  const ref = useRef<BdCodeEditor>(null);
  const themeSetting = useStore((s) => s.settings.theme);
  const isDark =
    themeSetting === 'dark' ||
    (themeSetting === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  // Keep the latest callbacks without re-subscribing the listeners each render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;

  // Set initial content + wire the change/blur events once the element is connected.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.setValue(value);
    if (autoFocus) el.focus();
    const onInput = (e: Event): void => onChangeRef.current((e as CustomEvent<string>).detail);
    const onBlurEv = (): void => onBlurRef.current?.();
    el.addEventListener('bd-input', onInput);
    el.addEventListener('bd-blur', onBlurEv);
    return () => {
      el.removeEventListener('bd-input', onInput);
      el.removeEventListener('bd-blur', onBlurEv);
    };
    // Mount-only: subsequent value changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push external value changes into the editor (guarded against echo: setValue
  // does not fire bd-input, and we only write when the text actually differs).
  useEffect(() => {
    const el = ref.current;
    if (el && el.value !== value) el.setValue(value);
  }, [value]);

  return (
    <bd-code-editor
      ref={ref}
      language={language}
      theme={isDark ? 'dark' : 'light'}
      placeholder={placeholder}
      {...(readOnly ? { readonly: '' } : {})}
      {...(minHeight ? { 'min-height': minHeight } : {})}
    />
  );
}
