/**
 * Automated demo video recorder for LifeDash.
 *
 * Launches the Electron app via Playwright, drives through the demo flow
 * defined in docs/demo-storyboard.md, and captures the window with ffmpeg.
 *
 * Prerequisites:
 *   - npm run start (app must build first via Vite — Playwright connects to the running Electron)
 *   - ffmpeg in PATH
 *   - Playwright installed: npm install --save-dev @playwright/test
 *
 * Usage:
 *   node scripts/record-demo.mjs              # full demo
 *   node scripts/record-demo.mjs --short      # 30-second Twitter/GIF cut
 *
 * Output:
 *   docs/demo-raw.mp4       — raw screen capture
 *   docs/demo-final.mp4     — with text overlays (after running scripts/demo-overlay.sh)
 */

import { _electron } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'docs');
const RAW_VIDEO = path.join(OUTPUT_DIR, 'demo-raw.mp4');
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'demo-frames');

const SHORT_MODE = process.argv.includes('--short');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait ms milliseconds */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Save a numbered screenshot */
let frameIndex = 0;
async function screenshot(page, label) {
  const name = `${String(frameIndex++).padStart(3, '0')}_${label}.png`;
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, name) });
  console.log(`  📸 ${name}`);
}

/** Smooth mouse move (Playwright moves instantly by default) */
async function smoothMove(page, x, y, steps = 20) {
  const box = await page.evaluate(() => ({ x: 0, y: 0 }));
  await page.mouse.move(x, y, { steps });
}

// ---------------------------------------------------------------------------
// FFmpeg screen recorder — captures the Electron window
// ---------------------------------------------------------------------------

function startScreenCapture(windowTitle) {
  // Use ffmpeg gdigrab to capture the window by title (Windows)
  const args = [
    '-y',
    '-f', 'gdigrab',
    '-framerate', '30',
    '-i', `title=${windowTitle}`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    RAW_VIDEO,
  ];

  console.log(`🎥 Starting screen capture → ${RAW_VIDEO}`);
  const proc = spawn('ffmpeg', args, {
    stdio: ['pipe', 'ignore', 'pipe'],
    detached: false,
  });

  proc.stderr.on('data', (d) => {
    const line = d.toString().trim();
    // Only log errors, not progress
    if (line.includes('Error') || line.includes('error')) {
      console.error(`  ffmpeg: ${line}`);
    }
  });

  return proc;
}

function stopScreenCapture(proc) {
  return new Promise((resolve) => {
    proc.on('close', resolve);
    // Send 'q' to ffmpeg to stop gracefully
    proc.stdin.write('q');
    proc.stdin.end();
    // Fallback: kill after 5s if it doesn't stop
    setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      resolve();
    }, 5000);
  });
}

// ---------------------------------------------------------------------------
// Demo flow
// ---------------------------------------------------------------------------

async function runDemo() {
  console.log('\n🚀 LifeDash Demo Recorder\n');
  console.log(SHORT_MODE ? '  Mode: SHORT (30s Twitter/GIF cut)' : '  Mode: FULL (70s demo)');

  // Ensure output dirs exist
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  // --- Launch Electron ---
  console.log('\n📦 Launching LifeDash...');
  const electronApp = await _electron.launch({
    args: [path.join(ROOT, '.vite/build/main.js')],
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production', // Skip dev tools
    },
  });

  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  console.log('  ✅ App window ready\n');

  // Give the app a moment to fully render (splash screen, etc.)
  await wait(4000);

  // --- Dismiss any onboarding if present ---
  // Skip feature tour if it appears
  const skipTourBtn = page.locator('text=Skip tour');
  if (await skipTourBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipTourBtn.click();
    await wait(500);
    console.log('  ⏭️  Skipped feature tour');
  }

  // Skip setup wizard if it appears
  const skipWizardBtn = page.locator('text=Skip');
  if (await skipWizardBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipWizardBtn.click();
    await wait(500);
    console.log('  ⏭️  Skipped setup wizard');
  }

  await wait(1000);

  // --- Start screen capture ---
  // Get the window title for ffmpeg
  const windowTitle = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win?.getTitle() || 'LifeDash';
  });

  const recorder = startScreenCapture(windowTitle || 'LifeDash');
  await wait(2000); // Let ffmpeg stabilize

  try {
    // =====================================================================
    // SCENE 2 — Dashboard + Start Recording (matches storyboard 0:05-0:15)
    // =====================================================================
    console.log('\n🎬 SCENE 2 — Dashboard + Start Recording');
    await screenshot(page, 'dashboard');
    await wait(2000);

    // Navigate to Meetings
    const meetingsNav = page.locator('[data-tour-id="nav-meetings"]');
    await meetingsNav.click();
    await wait(1500);
    await screenshot(page, 'meetings-page');

    // Click "New Recording" or "Record Your First Meeting" button
    const recordBtn = page.locator('button:has-text("New Recording"), button:has-text("Record Your First Meeting"), button:has-text("Record")').first();
    if (await recordBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await recordBtn.click();
      console.log('  ▶️  Started recording');
      await wait(3000);
      await screenshot(page, 'recording-active');

      // Let it record for a few seconds
      await wait(SHORT_MODE ? 3000 : 5000);

      // Stop recording
      const stopBtn = page.locator('button:has-text("Stop"), button:has-text("End Recording")').first();
      if (await stopBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await stopBtn.click();
        console.log('  ⏹️  Stopped recording');
        await wait(2000);
        await screenshot(page, 'recording-stopped');
      }
    } else {
      console.log('  ⚠️  Record button not found — taking screenshot of current state');
      await screenshot(page, 'meetings-no-record');
    }

    // =====================================================================
    // SCENE 3 — Transcription (0:15-0:25)
    // =====================================================================
    console.log('\n🎬 SCENE 3 — Transcription');
    await wait(2000);
    await screenshot(page, 'transcription');

    // If there are existing meetings with transcripts, click one
    const meetingCard = page.locator('[class*="meeting"], [class*="card"]').first();
    if (await meetingCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await meetingCard.click();
      await wait(2000);
      await screenshot(page, 'meeting-detail');

      // Scroll through transcript
      await page.mouse.wheel(0, 300);
      await wait(1000);
      await screenshot(page, 'transcript-scroll');
    }

    // =====================================================================
    // SCENE 4 — AI Brief (0:25-0:38)
    // =====================================================================
    console.log('\n🎬 SCENE 4 — AI Meeting Brief');
    // Look for brief/summary section
    const briefBtn = page.locator('button:has-text("Generate Brief"), button:has-text("Brief"), button:has-text("Summary")').first();
    if (await briefBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await briefBtn.click();
      await wait(3000);
      await screenshot(page, 'ai-brief');
    }
    await wait(SHORT_MODE ? 2000 : 5000);

    // =====================================================================
    // SCENE 5 — Push to Kanban (0:38-0:50)
    // =====================================================================
    console.log('\n🎬 SCENE 5 — Push to Kanban');

    // Navigate to Projects
    const projectsNav = page.locator('[data-tour-id="nav-projects"]');
    await projectsNav.click();
    await wait(2000);
    await screenshot(page, 'kanban-board');

    // Interact with the board — try to drag a card if any exist
    const kanbanCard = page.locator('[data-testid*="card"], [class*="kanban"] [class*="card"]').first();
    if (await kanbanCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await screenshot(page, 'kanban-card-hover');
    }
    await wait(SHORT_MODE ? 2000 : 4000);

    if (SHORT_MODE) {
      console.log('\n🎬 SHORT MODE — Skipping feature montage');
    } else {
      // =================================================================
      // SCENE 6 — Feature Montage (0:50-0:58)
      // =================================================================
      console.log('\n🎬 SCENE 6 — Feature Montage');

      // Brainstorm
      const brainstormNav = page.locator('[data-tour-id="nav-brainstorm"]');
      await brainstormNav.click();
      await wait(2000);
      await screenshot(page, 'brainstorm');

      // Ideas
      const ideasNav = page.locator('[data-tour-id="nav-ideas"]');
      await ideasNav.click();
      await wait(2000);
      await screenshot(page, 'ideas');

      // Focus timer (if in sidebar)
      const focusNav = page.locator('[data-tour-id="nav-focus"], a[href="/focus"]').first();
      if (await focusNav.isVisible({ timeout: 1000 }).catch(() => false)) {
        await focusNav.click();
        await wait(2000);
        await screenshot(page, 'focus-timer');
      }
    }

  } finally {
    // --- Stop screen capture ---
    console.log('\n⏹️  Stopping screen capture...');
    await stopScreenCapture(recorder);
    console.log(`  ✅ Raw video saved: ${RAW_VIDEO}`);
  }

  // --- Close app ---
  await electronApp.close();

  // --- Summary ---
  console.log('\n✅ Demo recording complete!\n');
  console.log('Output:');
  console.log(`  Raw video:    ${RAW_VIDEO}`);
  console.log(`  Screenshots:  ${SCREENSHOT_DIR}/`);
  console.log('\nNext steps:');
  console.log('  1. Review the raw video and screenshots');
  console.log('  2. Run the overlay script to add text captions:');
  console.log('     bash scripts/demo-overlay.sh');
  console.log('  3. For GIF export:');
  console.log('     ffmpeg -i docs/demo-final.mp4 -vf "fps=15,scale=960:-1" -loop 0 docs/demo.gif');
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

runDemo().catch((err) => {
  console.error('\n❌ Demo recording failed:', err.message);
  process.exit(1);
});
