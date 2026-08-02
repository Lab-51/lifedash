// === FILE PURPOSE ===
// E2E checks for the reworked setup wizard (LOCAL-RT.1 Task 5) against the real
// Electron app on a fresh profile: local is the headline branch, the built-in
// step renders the real catalog through the real `local-models:view` IPC, and
// leaving the wizard downloads nothing and configures nothing.
//
// Unlike the other specs this one must NOT launch with NODE_ENV=test — that sets
// preload's `isTestMode`, which suppresses the onboarding overlays outright, so
// the wizard would never appear.
//
// Optional: set LIFEDASH_LLAMA_BIN_DIR / LIFEDASH_LLAMA_MODELS_DIR before running
// to point the runtime at real llama.cpp binaries and an existing GGUF; the two
// tests that need them skip themselves when they are absent.

import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let app: ElectronApplication;
let page: Page;

const MODELS_DIR_OVERRIDE = process.env.LIFEDASH_LLAMA_MODELS_DIR;

/** In dev the app also opens a DevTools window and `firstWindow()` can return it. */
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

/** Jump the Feature Tour to its last step and take its "Set up AI" exit into the wizard. */
async function openWizardViaTour() {
  const dots = page.getByRole('button', { name: /^Go to step \d+$/ });
  await expect(dots.first()).toBeVisible({ timeout: 30_000 });
  await dots.last().click();
  await page.getByRole('button', { name: 'Set up AI', exact: true }).click();
  await expect(page.getByText('Setup Wizard')).toBeVisible();
}

test.beforeAll(async () => {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-wizard-e2e-'));
  // NODE_ENV deliberately left alone — see the file header.
  const env = { ...process.env } as Record<string, string>;
  delete env.NODE_ENV;

  app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${testUserData}`],
    cwd: projectRoot,
    env,
    timeout: 30_000,
  });
  page = await rendererWindow();
  await page.waitForSelector('nav', { timeout: 30_000 });
  await openWizardViaTour();
});

test.afterAll(async () => {
  await app?.close();
});

test('the wizard opens on its welcome screen and leads into the branch step', async () => {
  await page.getByRole('button', { name: /Set up AI now/ }).click();
  await expect(page.getByRole('heading', { name: 'Set up AI' })).toBeVisible();
});

test('running AI on this computer is the headline option, without the old expert framing', async () => {
  await expect(page.getByText('Private — AI runs on this computer')).toBeVisible();
  await expect(page.getByText('Recommended')).toBeVisible();
  await expect(page.getByRole('button', { name: /Set up the built-in AI/ })).toBeVisible();
  // Demoted, not removed.
  await expect(page.getByRole('button', { name: 'LM Studio' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ollama' })).toBeVisible();
  // Cloud paths intact, below local.
  await expect(page.getByText('Cloud — I have an API key')).toBeVisible();
  await expect(page.getByText('Help me get a cloud API key')).toBeVisible();
  // The pre-rework copy is gone.
  await expect(page.getByText(/terminal usage/i)).toHaveCount(0);
  await expect(page.getByText(/technical users/i)).toHaveCount(0);
  await expect(page.getByText(/\(advanced\)/i)).toHaveCount(0);
});

test('the built-in step renders the real catalog against this machine, spawning nothing', async () => {
  await page.getByRole('button', { name: /Set up the built-in AI/ }).click();

  await expect(page.getByText(/Your machine reports \d+ GB of memory/)).toBeVisible({ timeout: 20_000 });
  // The hedged rationale from format.ts, verbatim — never restated by the wizard.
  await expect(page.getByText(/LifeDash does not measure video memory/).first()).toBeVisible();
  await expect(page.getByText('Likely best for your machine').first()).toBeVisible();
  // A shortlist with a visible way to the rest.
  await expect(page.getByRole('button', { name: /Show all \d+ models/ })).toBeVisible();
  // Nothing was picked, so nothing can be committed.
  await expect(page.getByRole('button', { name: /Use this model/ })).toBeDisabled();
  // The runtime card is a pure read: it never moves off "Stopped" by itself.
  await expect(page.getByText('Stopped')).toBeVisible();
});

test('an origin policy that hides the only small tool-caller says so plainly', async () => {
  await page.getByRole('button', { name: 'Filter models by country of origin' }).click();
  await page.getByRole('button', { name: 'China' }).click();
  await page.getByRole('button', { name: 'Filter models by license' }).click();
  await page.getByRole('button', { name: 'Gemma' }).click();

  // No Chinese-origin model is Gemma-licensed, so nothing is left at all.
  await expect(page.getByText('No models match the current filters.')).toBeVisible();
  await expect(page.getByText(/None of the models shown can call tools/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Use a cloud provider instead/ })).toBeVisible();

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText('No models match the current filters.')).toHaveCount(0);
});

test('the bundled runtime binary is found when one is staged', async () => {
  test.skip(!process.env.LIFEDASH_LLAMA_BIN_DIR, 'No llama.cpp binaries staged (Task 6 does that).');
  await expect(page.getByText(/bundled runtime binary is missing/)).toHaveCount(0);
});

test('a GGUF already on disk is offered as a routable choice', async () => {
  test.skip(!MODELS_DIR_OVERRIDE, 'No pre-populated models dir provided.');
  const embedRow = page.locator('li', { hasText: 'EmbeddingGemma 300M' }).first();
  await expect(embedRow.getByText('Downloaded', { exact: true })).toBeVisible();
  await expect(embedRow.getByRole('button', { name: /Delete EmbeddingGemma/ })).toBeVisible();
  // Still no chat model, so the assistant picker honestly has nothing to offer.
  await expect(page.getByText(/Download one above to choose it here/)).toBeVisible();
});

test('skipping the built-in step leaves no provider and no task-model routing', async () => {
  await page.getByRole('button', { name: /Skip for now — nothing is downloaded or changed/ }).click();
  await expect(page.getByText('Setup Wizard')).toHaveCount(0);

  const state = await page.evaluate(async () => {
    const api = (window as unknown as { electronAPI: Record<string, () => Promise<unknown>> }).electronAPI;
    return {
      settings: (await api.getAllSettings()) as Record<string, string>,
      providers: (await api.getAIProviders()) as unknown[],
      runtime: (await api.checkBuiltinRuntime()) as { runtime: { running: boolean } },
    };
  });

  expect(state.settings['ai.taskModels']).toBeUndefined();
  expect(state.settings['setupWizard.completed']).toBe('true');
  expect(state.providers).toHaveLength(0);
  expect(state.runtime.runtime.running).toBe(false);
});
