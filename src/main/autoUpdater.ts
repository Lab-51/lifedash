// === FILE PURPOSE ===
// Custom auto-updater (UPDATER-SAFE.1). Finds the latest release through GitHub's
// public API (updateSource.ts), downloads the Windows installer and proves it matches
// GitHub's sha256 (updateDownload.ts), and installs it silently in place — never
// during a recording, and only after the app has shut its services down cleanly.
// macOS only notifies and links to the releases page.

import { app, BrowserWindow, ipcMain, net, Notification, shell } from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createLogger } from './services/logger';
import { getIsRecording } from './services/recordingState';
import { isRecording as isAudioRecording } from './services/audioProcessor';
import {
  fetchLatestRelease,
  isNewerVersion,
  parseInstaller,
  parseReleaseVersion,
  type VerifiedInstaller,
} from './updateSource';
import { downloadVerified, removeOtherDownloads, sha256File } from './updateDownload';

const log = createLogger('AutoUpdater');

// --- Types ---

export interface UpdateInfo {
  version: string;
  releaseName: string;
  /** Windows only: the installer the release record names, with its GitHub digest. */
  installer: VerifiedInstaller | null;
}

type UpdateStatus = 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error';

// --- Module state ---

let downloaded: { path: string; sha256: string; version: string; releaseName: string } | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;

const RELEASES_URL = 'https://github.com/Lab-51/lifedash/releases/latest';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const STARTUP_DELAY_MS = 10_000; // 10 seconds after startup
const IS_MAC = process.platform === 'darwin';

const fetchViaElectron = (url: string, init?: { headers?: Record<string, string> }) => net.fetch(url, init);

// --- macOS notification ---

/**
 * Show a native notification that a new version is available.
 * Clicking the notification opens the GitHub releases page in the default browser.
 */
function showMacUpdateNotification(version: string): void {
  const notification = new Notification({
    title: 'LifeDash Update Available',
    body: `Version ${version} is available. Click to download.`,
  });

  notification.on('click', () => {
    shell.openExternal(RELEASES_URL);
  });

  notification.show();
}

// --- Core functions ---

/**
 * Ask GitHub for the latest release. Returns the update when it is newer and (on
 * Windows) names a verifiable installer; `'rate-limited'` when GitHub refused the
 * unauthenticated request; null otherwise.
 */
export async function checkForUpdates(currentVersion: string): Promise<UpdateInfo | 'rate-limited' | null> {
  const latest = await fetchLatestRelease(fetchViaElectron, currentVersion);
  if (latest.kind === 'rate-limited') return 'rate-limited';
  if (latest.kind === 'error') throw new Error(latest.message);

  const release = parseReleaseVersion(latest.json);
  if (!release.ok) {
    log.warn(`Ignoring latest release: ${release.reason}`);
    return null;
  }
  const { version, releaseName } = release.value;
  if (!isNewerVersion(currentVersion, version)) {
    log.info(`Up to date (current: ${currentVersion}, latest: ${version})`);
    return null;
  }
  if (IS_MAC) return { version, releaseName, installer: null };

  const installer = parseInstaller(latest.json, version);
  if (!installer.ok) {
    log.warn(`New version ${version} found but not installable: ${installer.reason}`);
    return null;
  }
  log.info(`Update available: ${currentVersion} -> ${version} (sha256 ${installer.value.sha256})`);
  return { version, releaseName, installer: installer.value };
}

export type InstallRefusal = { reason: string; discardDownload: boolean };

let installInProgress = false;

const matchesDigest = async (download: { path: string; sha256: string }) =>
  (await sha256File(download.path).catch(() => null)) === download.sha256;

/**
 * Re-verify the downloaded installer, shut the app's services down, launch the Inno
 * Setup installer silently into the SAME directory (so ZIP-extracted installs update
 * in place), and exit. Refuses during a recording or when the file no longer matches
 * the digest it was verified against; returns the refusal, or never returns.
 */
export async function installUpdate(
  download: { path: string; sha256: string } | null,
  shutdown: () => Promise<void>,
): Promise<InstallRefusal> {
  if (installInProgress) return { reason: 'The update is already being installed', discardDownload: false };
  if (!download) return { reason: 'No update has been downloaded', discardDownload: false };
  if (getIsRecording() || isAudioRecording()) {
    return { reason: 'Stop the recording before installing the update', discardDownload: false };
  }
  // Claimed before the first await: a second click arriving during the hash must be refused.
  installInProgress = true;
  if (!(await matchesDigest(download))) {
    installInProgress = false;
    log.error(`Installer no longer matches sha256 ${download.sha256} — not installing`);
    return { reason: 'The downloaded update failed verification and was discarded', discardDownload: true };
  }

  const appDir = path.dirname(process.execPath);
  log.info(`Installing verified update from: ${download.path} to: ${appDir}`);
  await shutdown();

  // Hash once more right before running it: shutdown can take seconds.
  if (await matchesDigest(download)) {
    const child = spawn(
      download.path,
      [`/DIR=${appDir}`, '/VERYSILENT', '/SUPPRESSMSGBOXES', '/CLOSEAPPLICATIONS', '/RESTARTAPPLICATIONS'],
      { detached: true, stdio: 'ignore' },
    );
    child.on('error', (err) => log.error('Installer failed to start:', err));
    child.unref();
  } else {
    log.error('Installer changed during shutdown — not running it; quitting without updating');
  }
  // Services are already down either way: quit through the normal path (will-quit runs).
  app.quit();
  return new Promise<never>(() => undefined); // the app is quitting
}

// --- Init ---

/**
 * Initialize the auto-updater. Only runs in packaged builds.
 * `shutdown` is main.ts's service cleanup, awaited before the installer runs.
 */
export function initAutoUpdater(mainWindow: BrowserWindow, shutdown: () => Promise<void>): void {
  if (!app.isPackaged) {
    log.info('Skipping auto-updater in development');
    return;
  }

  const currentVersion = app.getVersion();
  log.info(`Auto-updater initialized (v${currentVersion})`);

  // --- IPC status helper ---
  const sendStatus = (status: UpdateStatus, releaseName?: string, progress?: number, errorMessage?: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:update-status', { status, releaseName, progress, errorMessage });
    }
  };

  // --- Check + download cycle ---
  let checkRunning = false;
  const runUpdateCheck = async (manual: boolean) => {
    if (checkRunning) return; // an hourly check must not start a second download into the same file
    checkRunning = true;
    try {
      log.info(`Checking for updates (current: v${currentVersion})`);
      sendStatus('checking');

      const update = await checkForUpdates(currentVersion);
      if (update === 'rate-limited') {
        log.info('GitHub rate limit reached — will check again later');
        if (downloaded)
          sendStatus('ready', downloaded.releaseName); // keep Restart & Install available
        else if (manual)
          sendStatus('error', undefined, undefined, 'GitHub is limiting update checks — try again later');
        else sendStatus('up-to-date');
        return;
      }
      if (!update) {
        sendStatus('up-to-date');
        return;
      }

      if (IS_MAC || !update.installer) {
        // macOS: notify user and link to GitHub releases -- no download/install
        log.info(`Update available for macOS: ${update.releaseName} -- showing notification`);
        showMacUpdateNotification(update.version);
        sendStatus('ready', update.releaseName);
        return;
      }

      if (downloaded?.version === update.version) {
        sendStatus('ready', update.releaseName); // already downloaded and verified
        return;
      }

      // Windows: download and verify the installer against GitHub's digest
      const { installer } = update;
      sendStatus('downloading', update.releaseName);
      const destDir = path.join(app.getPath('userData'), 'updates');
      const installerPath = await downloadVerified(
        {
          url: installer.downloadUrl,
          sha256: installer.sha256,
          size: installer.size,
          destDir,
          fileName: installer.assetName,
          onProgress: (percent) => sendStatus('downloading', update.releaseName, percent),
        },
        fetchViaElectron,
      );
      await removeOtherDownloads(destDir, installerPath);

      downloaded = {
        path: installerPath,
        sha256: installer.sha256,
        version: update.version,
        releaseName: update.releaseName,
      };
      sendStatus('ready', update.releaseName);
      log.info(`Update ready to install: ${update.releaseName} (sha256 verified)`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error('Update check failed:', msg);
      sendStatus('error', undefined, undefined, msg);
    } finally {
      checkRunning = false;
    }
  };

  // Register IPC handlers BEFORE the OFFICIAL_BUILD guard so the renderer
  // never gets an unhandled invoke error, even in unofficial builds.

  // --- IPC handler: install downloaded update ---
  ipcMain.handle('app:install-update', async () => {
    if (!process.env.OFFICIAL_BUILD) return;
    if (IS_MAC) {
      log.info('Opening releases page (macOS does not support in-app install)');
      shell.openExternal(RELEASES_URL);
      return;
    }
    log.info('User accepted update -- verifying and installing');
    const refused = await installUpdate(downloaded, shutdown);
    log.warn(`Install refused: ${refused.reason}`);
    if (refused.discardDownload) downloaded = null;
    sendStatus('error', undefined, undefined, refused.reason);
  });

  // --- IPC handler: manual "Check for Updates" ---
  ipcMain.handle('app:check-for-updates', async () => {
    if (!process.env.OFFICIAL_BUILD) {
      sendStatus('up-to-date');
      return;
    }
    log.info('Manual update check triggered');
    await runUpdateCheck(true);
  });

  // Gate the automatic update loop on OFFICIAL_BUILD so forks don't
  // accidentally pull updates from the official LifeDash release channel.
  if (!process.env.OFFICIAL_BUILD) {
    log.info('Skipping auto-updater — not an official build (set OFFICIAL_BUILD=true to enable)');
    return;
  }

  // Check after startup delay
  setTimeout(() => {
    void runUpdateCheck(false);
  }, STARTUP_DELAY_MS);

  // Periodic check
  checkInterval = setInterval(() => {
    void runUpdateCheck(false);
  }, CHECK_INTERVAL_MS);

  // Cleanup on app quit
  app.on('before-quit', () => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  });
}
