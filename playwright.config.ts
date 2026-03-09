// === FILE PURPOSE ===
// Playwright configuration for Electron E2E tests.
// Uses @playwright/test's Electron integration to launch the app from source.
//
// PREREQUISITE: Run `npm run start` at least once to compile main.js and preload.js.
// The global setup starts a Vite dev server on port 5173 to serve the renderer.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1, // Electron tests must run serially (single app instance)
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    trace: 'on-first-retry',
  },
});
