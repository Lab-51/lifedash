// === FILE PURPOSE ===
// Custom GitHub-based auto-updater for Inno Setup builds.
// Replaces Squirrel's update-electron-app with direct GitHub Releases API polling,
// download via Electron net, and silent Inno Setup install.

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
  assetId: number;
  releaseName: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  assets: Array<{
    id: number;
    name: string;
    browser_download_url: string;
  }>;
}

type UpdateStatus = 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error';

// --- Module state ---

let downloadedInstallerPath: string | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;

const GITHUB_REPO = 'Lab-51/lifedash';
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
 * Check GitHub Releases for a newer version.
 * Returns UpdateInfo if a newer version with a matching asset is found, null otherwise.
 */
export async function checkForUpdates(currentVersion: string): Promise<UpdateInfo | null> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': `LifeDash/${currentVersion}`,
  };

  // Optional: use GITHUB_TOKEN for higher rate limits
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await net.fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
  }

  const release = (await response.json()) as GitHubRelease;
  const remoteVersion = release.tag_name.replace(/^v/, '');

  if (!isNewerVersion(currentVersion, remoteVersion)) {
    log.info(`Up to date (current: ${currentVersion}, latest: ${remoteVersion})`);
    return null;
  }

  // Find the Setup.exe asset
  const setupAsset = release.assets.find((a) => /LifeDash-.*-Setup\.exe$/.test(a.name));
  if (!setupAsset) {
    log.warn(`New version ${remoteVersion} found but no Setup.exe asset`);
    return null;
  }

  log.info(`Update available: ${currentVersion} -> ${remoteVersion}`);
  return {
    version: remoteVersion,
    assetUrl: setupAsset.browser_download_url,
    assetId: setupAsset.id,
    releaseName: release.name || `v${remoteVersion}`,
  };
}

/**
 * Download an update asset to a temp directory.
 * Uses Electron net.request() to track download progress.
 */
export function downloadUpdate(
  assetUrl: string,
  onProgress: (percent: number) => void,
): Promise<string> {
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
  const sendStatus = (status: UpdateStatus, releaseName?: string, progress?: number) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:update-status', { status, releaseName, progress });
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

  // --- Check + download cycle ---
  const runUpdateCheck = async () => {
    try {
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
      log.error('Update check failed:', error);
      sendStatus('up-to-date'); // Fail silently
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
