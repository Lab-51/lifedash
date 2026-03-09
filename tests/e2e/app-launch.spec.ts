// === FILE PURPOSE ===
// E2E tests for basic app launch, window behavior, and sidebar navigation.

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchApp } from './helpers';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
});

test.afterAll(async () => {
  await app?.close();
});

test.describe('App Launch', () => {
  test('window opens and has a title', async () => {
    const title = await page.title();
    // Electron Forge sets the title from package.json name or the HTML <title>
    expect(title).toBeTruthy();
  });

  test('window is visible and has reasonable dimensions', async () => {
    const window = await app.browserWindow(page);
    const isVisible = await window.evaluate((w) => w.isVisible());
    expect(isVisible).toBe(true);

    const bounds = await window.evaluate((w) => w.getBounds());
    expect(bounds.width).toBeGreaterThanOrEqual(900);
    expect(bounds.height).toBeGreaterThanOrEqual(600);
  });

  test('sidebar navigation is visible', async () => {
    const nav = page.locator('nav');
    await expect(nav).toBeVisible();
  });
});

test.describe('Sidebar Navigation', () => {
  // The sidebar uses icon-only NavLinks with title attributes containing the label.
  // Nav items: Home, Meetings, Projects, Brainstorm, Ideas, Focus, Settings

  test('can navigate to Projects', async () => {
    await page.locator('nav a[title*="Projects"]').click();
    await page.waitForTimeout(500);
    // The URL hash should change to #/projects
    const url = page.url();
    expect(url).toContain('/projects');
  });

  test('can navigate to Meetings', async () => {
    await page.locator('nav a[title*="Meetings"]').click();
    await page.waitForTimeout(500);
    const url = page.url();
    expect(url).toContain('/meetings');
  });

  test('can navigate to Ideas', async () => {
    await page.locator('nav a[title*="Ideas"]').click();
    await page.waitForTimeout(500);
    const url = page.url();
    expect(url).toContain('/ideas');
  });

  test('can navigate to Brainstorm', async () => {
    await page.locator('nav a[title*="Brainstorm"]').click();
    await page.waitForTimeout(500);
    const url = page.url();
    expect(url).toContain('/brainstorm');
  });

  test('can navigate to Settings', async () => {
    await page.locator('nav a[title*="Settings"]').click();
    await page.waitForTimeout(500);
    const url = page.url();
    expect(url).toContain('/settings');
  });

  test('can navigate back to Home', async () => {
    await page.locator('nav a[title*="Home"]').click();
    await page.waitForTimeout(500);
    // Home is at root hash — URL ends with #/ or just the base
    const url = page.url();
    // Should not contain /projects, /meetings, etc.
    expect(url).not.toContain('/projects');
    expect(url).not.toContain('/settings');
  });
});

test.describe('Window Controls', () => {
  test('window can be minimized and restored', async () => {
    const window = await app.browserWindow(page);

    await window.evaluate((w) => w.minimize());
    const isMinimized = await window.evaluate((w) => w.isMinimized());
    expect(isMinimized).toBe(true);

    await window.evaluate((w) => w.restore());
    const isMinimizedAfter = await window.evaluate((w) => w.isMinimized());
    expect(isMinimizedAfter).toBe(false);
  });

  test('window can be maximized and unmaximized', async () => {
    const window = await app.browserWindow(page);

    await window.evaluate((w) => w.maximize());
    const isMaximized = await window.evaluate((w) => w.isMaximized());
    expect(isMaximized).toBe(true);

    await window.evaluate((w) => w.unmaximize());
    const isMaximizedAfter = await window.evaluate((w) => w.isMaximized());
    expect(isMaximizedAfter).toBe(false);
  });
});
