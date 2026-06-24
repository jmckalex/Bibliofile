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
import { AnnotationWindow } from './AnnotationWindow.js';
import { registerBdElements } from './bd-elements.js';
import './styles.css';

// Register the bd-* custom elements (journal cover, citation) used by the
// template-driven detail/panel HTML.
registerBdElements();

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element not found');
}

/** Parse a `#<kind>=<documentId>::<itemId>` launch hash for a per-item window. */
function windowTarget(kind: string): { documentId: string; itemId: string } | null {
  const m = new RegExp(`^#${kind}=([^:]+)::(.+)$`).exec(window.location.hash);
  if (!m) return null;
  return { documentId: decodeURIComponent(m[1]!), itemId: decodeURIComponent(m[2]!) };
}

const editor = windowTarget('editor');
const annotation = windowTarget('annotation');

createRoot(container).render(
  <StrictMode>
    {editor ? (
      <EditorWindow {...editor} />
    ) : annotation ? (
      <AnnotationWindow {...annotation} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
