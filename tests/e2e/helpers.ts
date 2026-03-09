// === FILE PURPOSE ===
// Shared helpers for Electron Playwright E2E tests.
// Provides a reusable function to launch the app and wait for it to be ready.
//
// PREREQUISITE: Run `npm run start` at least once before running E2E tests.
// This compiles main.js and preload.js (with Vite dev server URL baked in).
// The global setup starts a Vite dev server on the same port, then tests
// launch Electron via Playwright.

import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Launch the Electron app for E2E testing.
 *
 * The compiled `.vite/build/main.js` has the Vite dev server URL baked in
 * (http://localhost:5173). The global setup in `global-setup.ts` starts
 * a Vite dev server on that port so the renderer loads correctly.
 *
 * We use a temporary user-data directory so the test instance doesn't
 * conflict with a running dev instance (separate single-instance lock).
 *
 * On first launch with a fresh user-data dir, the app shows a Feature Tour
 * and Setup Wizard overlay. This helper dismisses them automatically.
 */
export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-e2e-'));

  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${testUserData}`],
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
    timeout: 30_000,
  });

  // Wait for the first BrowserWindow to appear
  const page = await app.firstWindow();

  // Wait for the app to be fully loaded — the renderer shows a loading state
  // until PGlite initializes and the React app mounts. Wait for the sidebar
  // nav element, which indicates the app shell has rendered.
  await page.waitForSelector('nav', { timeout: 30_000 });

  // Dismiss the Feature Tour if it appears (shown on first launch)
  await dismissOverlays(page);

  return { app, page };
}

/**
 * Wait for the app to settle after launch.
 * The tour/wizard are skipped in test mode (NODE_ENV=test) via isTestMode flag,
 * so we just need a brief pause for any initial renders to complete.
 */
async function dismissOverlays(page: Page): Promise<void> {
  await page.waitForTimeout(1000);
}
