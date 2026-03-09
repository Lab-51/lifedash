// === FILE PURPOSE ===
// E2E tests for the Settings page — tabs, content switching, diagnostics, and theme toggle.

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchApp } from './helpers';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  ({ app, page } = await launchApp());
  // Navigate to Settings
  await page.locator('nav a[title*="Settings"]').click();
  await page.waitForTimeout(1000);
});

test.afterAll(async () => {
  await app?.close();
});

test.describe('Settings Page', () => {
  test('Settings page loads with header', async () => {
    // The settings page has a "Settings" heading
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
  });

  test('all 4 tabs are visible', async () => {
    // Tab labels: General, AI & Models, Data & Storage, About
    await expect(page.locator('button:has-text("General")')).toBeVisible();
    await expect(page.locator('button:has-text("AI & Models")')).toBeVisible();
    await expect(page.locator('button:has-text("Data & Storage")')).toBeVisible();
    await expect(page.locator('button:has-text("About")')).toBeVisible();
  });

  test('General tab is active by default', async () => {
    // The General tab button should have the active styling class
    const generalTab = page.locator('button:has-text("General")');
    // Verify we're on the General tab by checking for content unique to it
    // The Diagnostics section is in the General tab
    await expect(page.locator('text=Diagnostics').first()).toBeVisible({ timeout: 5000 });
  });

  test('can switch to AI & Models tab', async () => {
    await page.locator('button:has-text("AI & Models")').click();
    await page.waitForTimeout(500);
    // AI tab should show provider-related content
    // Look for something unique to the AI tab
    await expect(page.locator('text=Providers').first()).toBeVisible({ timeout: 5000 });
  });

  test('can switch to Data & Storage tab', async () => {
    await page.locator('button:has-text("Data & Storage")').click();
    await page.waitForTimeout(500);
    // Data tab should show backup or export related content
    await expect(page.locator('text=Backup').first()).toBeVisible({ timeout: 5000 });
  });

  test('can switch to About tab', async () => {
    await page.locator('button:has-text("About")').click();
    await page.waitForTimeout(500);
    // About tab should show version or app name
    await expect(page.locator('text=LifeDash').first()).toBeVisible({ timeout: 5000 });
  });

  test('can switch back to General tab', async () => {
    await page.locator('button:has-text("General")').click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=Diagnostics').first()).toBeVisible({ timeout: 5000 });
  });

  test('theme toggle button exists in sidebar', async () => {
    // The theme toggle is a button in the sidebar (not settings page)
    // It cycles through dark/light/system and has a title like "Dark mode", "Light mode", or "System theme"
    const themeButton = page.locator('nav button[title*="mode"], nav button[title*="theme"]');
    await expect(themeButton).toBeVisible();
  });
});
