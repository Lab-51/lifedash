// === FILE PURPOSE ===
// Playwright global setup — starts a Vite dev server for the renderer process.
//
// When `electron-forge start` compiles main.js, it bakes in the Vite dev server
// URL (http://localhost:5173). For E2E tests, we need that dev server running
// so the Electron app can load the renderer. This setup starts a Vite dev server
// using the renderer config, then tests launch Electron via _electron.launch().

import { createServer } from 'vite';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';

const projectRoot = path.resolve(__dirname, '..', '..');

async function globalSetup(_config: FullConfig) {
  const server = await createServer({
    configFile: path.join(projectRoot, 'vite.renderer.config.ts'),
    root: path.join(projectRoot, 'src', 'renderer'),
    server: {
      port: 5173,
      strictPort: true,
    },
  });

  await server.listen();
  console.log('Vite dev server started on http://localhost:5173');

  // Return teardown function — Playwright calls this after all tests complete
  return async () => {
    await server.close();
    console.log('Vite dev server stopped');
  };
}

export default globalSetup;
