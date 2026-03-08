/**
 * Automated demo video recorder for LifeDash.
 *
 * Launches the app via electron-forge (dev mode), connects Playwright
 * to the running renderer, drives the demo flow, and captures with ffmpeg.
 *
 * Usage:
 *   node scripts/record-demo.mjs              # full demo
 *   node scripts/record-demo.mjs --short      # 30-second Twitter/GIF cut
 *   node scripts/record-demo.mjs --no-record  # drive the app without ffmpeg
 *
 * Output:
 *   docs/demo-raw.mp4       — raw screen capture
 *   docs/demo-frames/       — numbered screenshots of each scene
 */

import { chromium } from '@playwright/test';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'docs');
const RAW_VIDEO = path.join(OUTPUT_DIR, 'demo-raw.mp4');
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'demo-frames');

const SHORT_MODE = process.argv.includes('--short');
const NO_RECORD = process.argv.includes('--no-record');

// ---------------------------------------------------------------------------
// Find ffmpeg
// ---------------------------------------------------------------------------

function findFfmpeg() {
  for (const p of ['ffmpeg', 'D:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\ffmpeg\\bin\\ffmpeg.exe']) {
    if (p === 'ffmpeg' || fs.existsSync(p)) return p;
  }
  return 'ffmpeg';
}

const FFMPEG = findFfmpeg();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let frameIndex = 0;
async function screenshot(page, label) {
  try {
    const name = `${String(frameIndex++).padStart(3, '0')}_${label}.png`;
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, name) });
    console.log(`  [frame] ${name}`);
  } catch (err) {
    console.log(`  [frame] SKIPPED ${label}: ${err.message}`);
  }
}

async function safeClick(page, selector, timeoutMs = 3000) {
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout: timeoutMs });
    await el.click();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// FFmpeg screen capture
// ---------------------------------------------------------------------------

function startScreenCapture() {
  // Capture the entire desktop — more reliable than window title matching
  const args = [
    '-y',
    '-f', 'gdigrab',
    '-framerate', '30',
    '-i', 'desktop',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    RAW_VIDEO,
  ];

  console.log(`[ffmpeg] Recording desktop -> ${RAW_VIDEO}`);
  const proc = spawn(FFMPEG, args, {
    stdio: ['pipe', 'ignore', 'pipe'],
    detached: false,
  });

  proc.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (line.includes('Error') || line.includes('Could not')) {
      console.error(`  [ffmpeg] ${line}`);
    }
  });

  proc.on('error', (err) => {
    console.error(`  [ffmpeg] Failed: ${err.message}`);
  });

  return proc;
}

function stopScreenCapture(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) { resolve(); return; }
    proc.on('close', resolve);
    try { proc.stdin.write('q'); proc.stdin.end(); } catch {}
    setTimeout(() => { try { proc.kill(); } catch {} resolve(); }, 5000);
  });
}

// ---------------------------------------------------------------------------
// Launch the app via Electron with remote debugging
// ---------------------------------------------------------------------------

async function launchApp() {
  const packagedExe = path.join(ROOT, 'out', 'lifedash-win32-x64', 'lifedash.exe');

  if (!fs.existsSync(packagedExe)) {
    console.error(`  ERROR: Packaged app not found at ${packagedExe}`);
    console.error('  Run "npm run package" first.');
    process.exit(1);
  }

  const debugPort = 9222;

  console.log(`[app] Launching packaged app with remote debugging on port ${debugPort}...`);
  console.log(`  Exe: ${packagedExe}`);

  // Launch the packaged app with remote debugging enabled
  const electronProc = spawn(
    packagedExe,
    [`--remote-debugging-port=${debugPort}`],
    {
      cwd: ROOT,
      stdio: 'ignore',
      detached: false,
    }
  );

  electronProc.on('error', (err) => {
    console.error(`  [app] Failed to start: ${err.message}`);
  });

  // Wait for the debugging port to become available
  console.log('[app] Waiting for app to start...');
  let browser = null;
  for (let i = 0; i < 30; i++) {
    await wait(1000);
    try {
      browser = await chromium.connectOverCDP(`http://localhost:${debugPort}`);
      break;
    } catch {
      // Not ready yet
    }
  }

  if (!browser) {
    console.error('  ERROR: Could not connect to app after 30 seconds.');
    electronProc.kill();
    process.exit(1);
  }

  console.log('[app] Connected via CDP');

  // Get the first page (renderer window)
  const contexts = browser.contexts();
  let page = null;

  // Wait for a page to appear
  for (let i = 0; i < 20; i++) {
    for (const ctx of browser.contexts()) {
      const pages = ctx.pages();
      if (pages.length > 0) {
        page = pages[0];
        break;
      }
    }
    if (page) break;
    await wait(500);
  }

  if (!page) {
    console.error('  ERROR: No renderer page found.');
    electronProc.kill();
    process.exit(1);
  }

  console.log('[app] Got renderer page');

  return { browser, page, electronProc };
}

// ---------------------------------------------------------------------------
// Demo flow
// ---------------------------------------------------------------------------

async function runDemo() {
  console.log('\n=== LifeDash Demo Recorder ===\n');
  console.log(`  Mode: ${SHORT_MODE ? 'SHORT (30s)' : 'FULL (70s)'}`);
  console.log(`  Record: ${NO_RECORD ? 'OFF' : 'ON'}`);
  console.log(`  ffmpeg: ${FFMPEG}`);

  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  // --- Launch app ---
  const { browser, page, electronProc } = await launchApp();

  // Wait for the app to fully render (splash + init)
  console.log('[app] Waiting for full render...');
  await wait(6000);

  // --- Dismiss onboarding ---
  console.log('[app] Dismissing onboarding...');

  if (await safeClick(page, 'button:has-text("Skip tour")', 3000)) {
    console.log('  Skipped feature tour');
    await wait(1000);
  }

  if (await safeClick(page, 'button:has-text("Skip — I\'ll do it later")', 3000)) {
    console.log('  Skipped setup wizard');
    await wait(1000);
  } else if (await safeClick(page, 'button:has-text("Skip for now")', 2000)) {
    console.log('  Skipped setup wizard');
    await wait(1000);
  }

  if (await safeClick(page, 'button:has-text("Skip and finish anyway")', 2000)) {
    console.log('  Skipped wizard final');
    await wait(1000);
  }

  // Close the What's New modal if it appears
  if (await safeClick(page, 'button:has-text("Close"), button:has-text("Got it")', 2000)) {
    console.log('  Closed modal');
    await wait(500);
  }

  console.log('[app] Ready for demo\n');

  // --- Start ffmpeg ---
  let recorder = null;
  if (!NO_RECORD) {
    recorder = startScreenCapture();
    await wait(2000);
  }

  // =====================================================================
  // SCENE 2 — Dashboard (0:05-0:15)
  // =====================================================================
  console.log('--- SCENE 2: Dashboard ---');
  await screenshot(page, 'dashboard');
  await wait(2000);

  // Navigate to Meetings
  if (await safeClick(page, '[data-tour-id="nav-meetings"]')) {
    console.log('  -> Meetings');
    await wait(2000);
    await screenshot(page, 'meetings-page');

    // Try to start recording
    if (await safeClick(page, 'button:has-text("New Recording")') ||
        await safeClick(page, 'button:has-text("Record Your First Meeting")')) {
      console.log('  -> Recording started');
      await wait(3000);
      await screenshot(page, 'recording-active');
      await wait(SHORT_MODE ? 3000 : 5000);

      // Stop
      await safeClick(page, 'button:has-text("Stop")') ||
        await safeClick(page, 'button:has-text("End")') ||
        await safeClick(page, 'button:has-text("Cancel")');
      console.log('  -> Recording stopped');
      await wait(2000);
      await screenshot(page, 'recording-stopped');
    } else {
      console.log('  (no record button found)');
      await screenshot(page, 'meetings-current');
    }
  }

  // =====================================================================
  // SCENE 3 — Transcription (0:15-0:25)
  // =====================================================================
  console.log('\n--- SCENE 3: Transcription ---');
  await wait(1500);

  // Click an existing meeting
  if (await safeClick(page, 'tr:has-text("meeting"), [class*="cursor-pointer"]', 2000)) {
    console.log('  -> Opened meeting');
    await wait(2000);
    await screenshot(page, 'meeting-detail');
    await page.mouse.wheel(0, 300);
    await wait(1500);
    await screenshot(page, 'transcript-scroll');
  } else {
    console.log('  (no meetings available)');
    await screenshot(page, 'meetings-empty');
  }

  // =====================================================================
  // SCENE 4 — AI Brief (0:25-0:38)
  // =====================================================================
  console.log('\n--- SCENE 4: AI Brief ---');
  if (await safeClick(page, 'button:has-text("Generate Brief"), button:has-text("Brief")')) {
    console.log('  -> Generating brief');
    await wait(5000);
    await screenshot(page, 'ai-brief');
  }
  await wait(SHORT_MODE ? 1000 : 3000);

  // =====================================================================
  // SCENE 5 — Kanban Board (0:38-0:50)
  // =====================================================================
  console.log('\n--- SCENE 5: Kanban ---');
  if (await safeClick(page, '[data-tour-id="nav-projects"]')) {
    console.log('  -> Projects');
    await wait(2500);
    await screenshot(page, 'kanban-board');
    await wait(SHORT_MODE ? 2000 : 4000);
  }

  // =====================================================================
  // SCENE 6 — Feature Montage (0:50-0:58)
  // =====================================================================
  if (!SHORT_MODE) {
    console.log('\n--- SCENE 6: Montage ---');

    if (await safeClick(page, '[data-tour-id="nav-brainstorm"]')) {
      console.log('  -> Brainstorm');
      await wait(2500);
      await screenshot(page, 'brainstorm');
    }

    if (await safeClick(page, '[data-tour-id="nav-ideas"]')) {
      console.log('  -> Ideas');
      await wait(2500);
      await screenshot(page, 'ideas');
    }

    if (await safeClick(page, 'a[href="/focus"]')) {
      console.log('  -> Focus');
      await wait(2500);
      await screenshot(page, 'focus-timer');
    }
  }

  // =====================================================================
  // Done
  // =====================================================================
  console.log('\n--- Done ---');

  if (recorder) {
    await stopScreenCapture(recorder);
    console.log(`  Raw video: ${fs.existsSync(RAW_VIDEO) ? 'saved' : 'MISSING'}`);
  }

  // Cleanup
  try { await browser.close(); } catch {}
  try { electronProc.kill(); } catch {}

  console.log('\n=== Recording complete ===\n');
  console.log(`  Screenshots: ${SCREENSHOT_DIR}/`);
  if (!NO_RECORD) {
    console.log(`  Raw video:   ${RAW_VIDEO}`);
    console.log('\n  Next: bash scripts/demo-overlay.sh');
  }
}

runDemo().catch((err) => {
  console.error('\n  ERROR:', err.message);
  process.exit(1);
});
