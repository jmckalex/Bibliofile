/**
 * React entry point. Mounts <App/> into #root. Importing `@bibdesk/shared` here
 * also pulls in the `Window.bibdesk` global augmentation for the whole renderer.
 */

import '@bibdesk/shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
