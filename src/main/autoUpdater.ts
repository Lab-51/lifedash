// === FILE PURPOSE ===
// Custom auto-updater that checks lifedash.space for new versions.
// Downloads the Inno Setup installer and installs silently in-place.

import { app, BrowserWindow, ipcMain, net } from 'electron';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createLogger } from './services/logger';

const log = createLogger('AutoUpdater');

// --- Types ---

export interface UpdateInfo {
  version: string;
  assetUrl: string;
  releaseName: string;
}

interface LatestVersionResponse {
  version: string;
  releaseName: string;
  setupUrl: string | null;
}

type UpdateStatus = 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error';

// --- Module state ---

let downloadedInstallerPath: string | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;

const VERSION_API = 'https://lifedash.space/api/latest-version';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const STARTUP_DELAY_MS = 10_000; // 10 seconds after startup

// --- Semver comparison ---

/**
 * Compare two semver strings (major.minor.patch).
 * Returns true if `remote` is newer than `current`.
 */
function isNewerVersion(current: string, remote: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [cMajor, cMinor, cPatch] = parse(current);
  const [rMajor, rMinor, rPatch] = parse(remote);

  if (rMajor !== cMajor) return rMajor > cMajor;
  if (rMinor !== cMinor) return rMinor > cMinor;
  return rPatch > cPatch;
}

// --- Core functions ---

/**
 * Check lifedash.space for a newer version.
 * The website proxies the private GitHub repo with server-side auth.
 * Returns UpdateInfo if a newer version is found, null otherwise.
 */
export async function checkForUpdates(currentVersion: string): Promise<UpdateInfo | null> {
  const response = await net.fetch(VERSION_API, {
    headers: { 'User-Agent': `LifeDash/${currentVersion}` },
  });

  if (!response.ok) {
    throw new Error(`Version API returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as LatestVersionResponse;

  if (!isNewerVersion(currentVersion, data.version)) {
    log.info(`Up to date (current: ${currentVersion}, latest: ${data.version})`);
    return null;
  }

  if (!data.setupUrl) {
    log.warn(`New version ${data.version} found but no Setup.exe download URL`);
    return null;
  }

  log.info(`Update available: ${currentVersion} -> ${data.version}`);
  return {
    version: data.version,
    assetUrl: data.setupUrl,
    releaseName: data.releaseName,
  };
}

/**
 * Download an update asset to a temp directory.
 * Uses Electron net.request() to track download progress.
 */
export function downloadUpdate(assetUrl: string, onProgress: (percent: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const destPath = path.join(app.getPath('temp'), 'LifeDash-Update-Setup.exe');

    const request = net.request({
      url: assetUrl,
      redirect: 'follow',
    });

    request.setHeader('Accept', 'application/octet-stream');
    request.setHeader('User-Agent', `LifeDash/${app.getVersion()}`);

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const contentLength = parseInt(response.headers['content-length'] as string, 10) || 0;
      let receivedBytes = 0;

      const fileStream = createWriteStream(destPath);

      response.on('data', (chunk: Buffer) => {
        fileStream.write(chunk);
        receivedBytes += chunk.length;
        if (contentLength > 0) {
          const percent = Math.round((receivedBytes / contentLength) * 100);
          onProgress(percent);
        }
      });

      response.on('end', () => {
        fileStream.end(() => {
          log.info(`Download complete: ${destPath} (${receivedBytes} bytes)`);
          resolve(destPath);
        });
      });

      response.on('error', (error: Error) => {
        fileStream.destroy();
        reject(error);
      });
    });

    request.on('error', (error: Error) => {
      reject(error);
    });

    request.end();
  });
}

/**
 * Launch the Inno Setup installer in silent mode and exit the app.
 * The installer will close the running app, install to the SAME directory
 * (via /DIR=), and relaunch. This ensures ZIP-extracted installs get
 * updated in-place rather than creating a second copy in the default dir.
 */
export function installUpdate(installerPath: string): void {
  const appDir = path.dirname(process.execPath);
  log.info(`Installing update from: ${installerPath} to: ${appDir}`);
  spawn(
    installerPath,
    [`/DIR=${appDir}`, '/VERYSILENT', '/SUPPRESSMSGBOXES', '/CLOSEAPPLICATIONS', '/RESTARTAPPLICATIONS'],
    { detached: true, stdio: 'ignore' },
  );
  process.exit(0);
}

// --- Init ---

/**
 * Initialize the auto-updater. Only runs in packaged builds.
 * Periodically checks for updates and sends IPC status events to the renderer.
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
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

  // --- IPC handler: install downloaded update ---
  ipcMain.handle('app:install-update', () => {
    if (downloadedInstallerPath) {
      log.info('User accepted update -- quitting and installing');
      installUpdate(downloadedInstallerPath);
    } else {
      log.warn('Install requested but no update has been downloaded');
    }
  });

  // --- IPC handler: manual "Check for Updates" ---
  ipcMain.handle('app:check-for-updates', async () => {
    log.info('Manual update check triggered');
    await runUpdateCheck();
  });

  // --- Check + download cycle ---
  const runUpdateCheck = async () => {
    try {
      log.info(`Checking for updates (current: v${currentVersion})`);
      sendStatus('checking');

      const update = await checkForUpdates(currentVersion);
      if (!update) {
        sendStatus('up-to-date');
        return;
      }

      // Download the update
      sendStatus('downloading', update.releaseName);
      const installerPath = await downloadUpdate(update.assetUrl, (percent) => {
        sendStatus('downloading', update.releaseName, percent);
      });

      downloadedInstallerPath = installerPath;
      sendStatus('ready', update.releaseName);
      log.info(`Update ready to install: ${update.releaseName}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error('Update check failed:', msg);
      sendStatus('error', undefined, undefined, msg);
    }
  };

  // Check after startup delay
  setTimeout(() => {
    runUpdateCheck();
  }, STARTUP_DELAY_MS);

  // Periodic check
  checkInterval = setInterval(() => {
    runUpdateCheck();
  }, CHECK_INTERVAL_MS);

  // Cleanup on app quit
  app.on('before-quit', () => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  });
}
