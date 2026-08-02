// === FILE PURPOSE ===
// E2E checks for Settings → AI & Models → Local AI (LOCAL-RT.1 Task 4) against the
// real Electron app and the real bundled catalog: filters, the hedged best-match
// highlight, the tool-calling badges, live download progress surviving a remount,
// overflow discipline with a deliberately long custom-GGUF name, and the
// optionality guarantee that rendering the section spawns nothing.
//
// Runs with a temporary user-data dir, so downloads and custom entries land in a
// throwaway profile, never the developer's real LifeDash data.

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page, Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { launchApp } from './helpers';

let app: ElectronApplication;
let page: Page;
let localAI: Locator;

const LONG_CUSTOM_NAME =
  'my-extremely-long-locally-finetuned-model-name-that-must-wrap-instead-of-blowing-out-the-settings-row-Q4_K_M';

/** Route straight to Settings → AI & Models. Hash navigation is stable; the
 *  sidebar's link titles have drifted (see app-launch.spec.ts). */
async function gotoAiTab() {
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=ai';
  });
  await page.waitForTimeout(500);
}

/** In dev the app also opens a DevTools window, and `firstWindow()` can return it
 *  (its toolbar contains a <nav>, so the shared helper's wait passes). Pick the
 *  window actually serving the renderer. */
async function rendererWindow(): Promise<Page> {
  for (let i = 0; i < 40; i++) {
    const match = app.windows().find((w) => w.url().startsWith('http://localhost:5173'));
    if (match) return match;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Renderer window not found. Open windows: ${app
      .windows()
      .map((w) => w.url())
      .join(', ')}`,
  );
}

/** A fresh profile opens the Feature Tour, whose z-100 spotlight swallows clicks. */
async function dismissTour() {
  for (let i = 0; i < 6; i++) {
    const skip = page.getByRole('button', { name: /Skip tour|Skip for now/ });
    if ((await skip.count()) === 0) break;
    await skip.first().click({ force: true });
    await page.waitForTimeout(500);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

test.beforeAll(async () => {
  ({ app } = await launchApp());
  page = await rendererWindow();
  await page.waitForSelector('nav', { timeout: 30_000 });
  await dismissTour();
  await gotoAiTab();
  localAI = page.locator('section').filter({ hasText: 'Run models on this computer' }).first();
  await expect(localAI).toBeVisible({ timeout: 20_000 });
});

test.afterAll(async () => {
  await app?.close();
});

/** Open a HudSelect by its accessible name and choose an option (portal-rendered). */
async function pickFilter(name: string, option: string) {
  await page.getByRole('button', { name }).click();
  // HudSelect renders its options in a fixed-position portal outside the section.
  const popover = page.locator('div.fixed.z-\\[9999\\]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
  await popover.getByRole('button', { name: option, exact: true }).click();
  await page.waitForTimeout(300);
}

test.describe('Settings → Local AI', () => {
  test('renders the bundled catalog grouped by role', async () => {
    await expect(localAI.getByText('Chat models')).toBeVisible();
    await expect(localAI.getByText('Embedding models')).toBeVisible();
    await expect(localAI.getByText('Qwen3 14B (Q4_K_M)')).toBeVisible();
    await expect(localAI.getByText('EmbeddingGemma 300M (Q8_0)')).toBeVisible();
    await expect(localAI.locator('li')).toHaveCount(9);
    await localAI.screenshot({ path: 'test-results/local-ai-section.png' });
  });

  test('tool-calling verdicts match the four GGUFs Task 3 verified', async () => {
    await expect(localAI.getByText('Tool calling', { exact: true })).toHaveCount(4);
    await expect(localAI.getByText('No tool calling', { exact: true })).toHaveCount(4);

    const row = localAI.locator('li').filter({ hasText: 'No tool calling' }).first();
    await row.scrollIntoViewIfNeeded();
    await expect(row.getByText(/cannot run Digital Twin actions/)).toBeVisible();
    await page.screenshot({ path: 'test-results/local-ai-no-tool-calling.png' });
  });

  test('best match is a hedged highlight, not a selection or a download', async () => {
    const badges = localAI.getByText('Likely best for your machine');
    expect(await badges.count()).toBeGreaterThan(0);
    expect(await badges.count()).toBeLessThanOrEqual(2); // one chat + one embedding
    const row = localAI.locator('li').filter({ hasText: 'Likely best for your machine' }).first();
    await row.scrollIntoViewIfNeeded();
    await expect(row.getByText(/does not measure video memory/)).toBeVisible();
    await expect(row.getByText(/Nothing is downloaded until you choose/)).toBeVisible();
    await page.screenshot({ path: 'test-results/local-ai-best-match.png' });
    // No transfer started itself.
    await expect(localAI.getByRole('progressbar')).toHaveCount(0);
  });

  test('origin filter hides Chinese-origin models', async () => {
    await pickFilter('Filter models by country of origin', 'United States');

    await expect(localAI.getByText('Qwen3 14B (Q4_K_M)')).toHaveCount(0);
    await expect(localAI.getByText('Qwen3 4B (Q4_K_M)')).toHaveCount(0);
    await expect(localAI.getByText('Phi-4 14B (Q4_K)')).toBeVisible();

    await pickFilter('Filter models by country of origin', 'Any country');
    await expect(localAI.getByText('Qwen3 14B (Q4_K_M)')).toBeVisible();
  });

  test('license filter narrows to one model', async () => {
    await pickFilter('Filter models by license', 'MIT');

    await expect(localAI.locator('li')).toHaveCount(1);
    await expect(localAI.getByText('Phi-4 14B (Q4_K)')).toBeVisible();

    await localAI.getByRole('button', { name: 'Clear filters' }).click();
    await expect(localAI.locator('li')).toHaveCount(9);
  });

  test('runtime card reports status and exposes the idle auto-stop control', async () => {
    await expect(localAI.getByText('Built-in runtime', { exact: true })).toBeVisible();
    await expect(localAI.getByRole('button', { name: 'Stop the built-in runtime' })).toBeDisabled();
    await expect(localAI.getByLabel('Minutes idle before the built-in runtime stops')).toHaveValue('15');
  });

  test('rendering the section spawned no sidecar process (optional by construction)', async () => {
    const tasks = execFileSync('tasklist', [], { encoding: 'utf8' }).toLowerCase();
    expect(tasks).not.toContain('llama-server');
    await expect(localAI.getByText('Stopped')).toBeVisible();
  });

  test('download progress renders and survives a settings-page remount', async () => {
    // Smallest catalog entry (~333 MB) so the check is quick; it is cancelled below
    // and lives in the throwaway profile either way.
    await localAI.getByRole('button', { name: /Download EmbeddingGemma/ }).click();

    const bar = localAI.getByRole('progressbar');
    await expect(bar).toBeVisible({ timeout: 20_000 });
    const before = Number(await bar.getAttribute('aria-valuenow'));

    // Unmount the whole settings page, then come back. Progress is a push event, so
    // this is the case where a naive implementation loses the transfer.
    await page.evaluate(() => {
      window.location.hash = '#/ideas';
    });
    await expect(page.getByText('Run models on this computer')).toHaveCount(0);
    await page.waitForTimeout(2000);
    await gotoAiTab();

    const barAfter = localAI.getByRole('progressbar');
    await expect(barAfter).toBeVisible({ timeout: 15_000 });
    const after = Number(await barAfter.getAttribute('aria-valuenow'));
    expect(after).toBeGreaterThanOrEqual(before);
    await localAI.locator('li').filter({ hasText: 'EmbeddingGemma' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/local-ai-download-after-remount.png' });

    await localAI.getByRole('button', { name: /Cancel downloading EmbeddingGemma/ }).click();
    await expect(localAI.getByRole('button', { name: /Download EmbeddingGemma/ })).toBeVisible({ timeout: 15_000 });
  });

  test('a deliberately long custom-GGUF name wraps instead of overflowing the row', async () => {
    await localAI.getByRole('button', { name: 'Add your own GGUF' }).click();
    await page.locator('#custom-gguf-name').fill(LONG_CUSTOM_NAME);
    await page.locator('#custom-gguf-url').fill(`https://example.invalid/${LONG_CUSTOM_NAME}.gguf`);
    await page.getByRole('button', { name: 'Add model' }).click();

    const row = localAI.locator('li').filter({ hasText: LONG_CUSTOM_NAME });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await localAI.screenshot({ path: 'test-results/local-ai-long-custom-name.png' });

    // The row must not scroll horizontally — the standing overflow rule.
    const overflow = await row.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await row.getByRole('button', { name: /Remove .* from the model list/ }).click();
    await expect(localAI.locator('li').filter({ hasText: LONG_CUSTOM_NAME })).toHaveCount(0, { timeout: 10_000 });
  });
});
