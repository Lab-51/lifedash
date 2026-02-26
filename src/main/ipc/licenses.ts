// === FILE PURPOSE ===
// IPC handlers for license management.
// Delegates to licensingService for all logic — renderer never calls LemonSqueezy directly.

// === DEPENDENCIES ===
// electron (ipcMain)
// ../services/licensingService

import { ipcMain } from 'electron';
import {
  activateLicenseKey,
  checkLicense,
  deactivateLicenseKey,
  getLicenseInfo,
  isFeatureEnabled,
} from '../services/licensingService';
import type { ProFeatureKey } from '../../shared/constants/features';

export function registerLicenseHandlers(): void {
  // Activate a license key — returns LicenseInfo on success, throws on failure
  ipcMain.handle('license:activate', async (_event, key: unknown) => {
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('Invalid license key');
    }
    return activateLicenseKey(key.trim());
  });

  // Validate current license (online + offline grace fallback) — returns LicenseInfo
  ipcMain.handle('license:check', async () => {
    return checkLicense();
  });

  // Deactivate the current license key instance — returns cleared LicenseInfo
  ipcMain.handle('license:deactivate', async () => {
    return deactivateLicenseKey();
  });

  // Return cached LicenseInfo (no network) — returns LicenseInfo
  ipcMain.handle('license:get-info', async () => {
    return getLicenseInfo();
  });

  // Check if a specific pro feature is enabled — returns boolean
  ipcMain.handle('license:is-feature-enabled', async (_event, feature: unknown) => {
    if (typeof feature !== 'string') return false;
    return isFeatureEnabled(feature as ProFeatureKey);
  });
}
