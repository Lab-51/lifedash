// === FILE PURPOSE ===
// React entry point — mounts the root component into the DOM.
// Loaded via dynamic import from bootstrap.ts so that import errors
// are caught and displayed on the splash screen.

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found. Check index.html for <div id="root">.');
}

const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
