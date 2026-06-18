/**
 * React entry point. Mounts either the main <App/> or, when launched with a
 * `#editor=<documentId>::<itemId>` hash (a standalone editor window opened by
 * main), the focused single-item <EditorWindow/>. Importing `@bibdesk/shared`
 * here also pulls in the `Window.bibdesk` global augmentation for the renderer.
 */

import '@bibdesk/shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { EditorWindow } from './EditorWindow.js';
import { registerBdElements } from './bd-elements.js';
import './styles.css';

// Register the bd-* custom elements (journal cover, citation) used by the
// template-driven detail/panel HTML.
registerBdElements();

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element not found');
}

/** Parse a `#editor=<documentId>::<itemId>` launch hash, if present. */
function editorTarget(): { documentId: string; itemId: string } | null {
  const m = /^#editor=([^:]+)::(.+)$/.exec(window.location.hash);
  if (!m) return null;
  return { documentId: decodeURIComponent(m[1]!), itemId: decodeURIComponent(m[2]!) };
}

const target = editorTarget();

createRoot(container).render(
  <StrictMode>{target ? <EditorWindow {...target} /> : <App />}</StrictMode>,
);
