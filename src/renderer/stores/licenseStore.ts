// === FILE PURPOSE ===
// Zustand store for license state management in the renderer process.
// Caches license info from the main process and provides synchronous
// feature gating checks for UI components.
//
// === DEPENDENCIES ===
// zustand, shared types (LicenseInfo), shared constants (ProFeatureKey),
// window.electronAPI (preload bridge — license methods from Task 1)

import { create } from 'zustand';
import type { LicenseInfo } from '../../shared/types/license';
import type { ProFeatureKey } from '../../shared/constants/features';

interface LicenseStore {
  // State
  info: LicenseInfo | null;
  loading: boolean;
  error: string | null;

  // Actions
  loadLicense: () => Promise<void>;
  activateLicense: (key: string) => Promise<LicenseInfo>;
  deactivateLicense: () => Promise<void>;
  isProFeature: (feature: ProFeatureKey) => boolean;
}

export const useLicenseStore = create<LicenseStore>((set, get) => ({
  info: null,
  loading: false,
  error: null,

  loadLicense: async () => {
    set({ loading: true, error: null });
    try {
      const info = await window.electronAPI.licenseCheck();
      set({ info, loading: false });
    } catch (_checkError) {
      // licenseCheck() runs full validation (trial expiry, network calls, etc.)
      // and can fail. Fall back to licenseGetInfo() which reads cached/DB data
      // without validation — ensures trial info is available even if check fails.
      try {
        const fallback = await window.electronAPI.licenseGetInfo();
        set({ info: fallback, loading: false });
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to load license',
          loading: false,
        });
      }
    }
  },

  activateLicense: async (key: string) => {
    set({ loading: true, error: null });
    try {
      const info = await window.electronAPI.licenseActivate(key);
      set({ info, loading: false });
      return info;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Activation failed';
      set({ error: message, loading: false });
      throw error;
    }
  },

  deactivateLicense: async () => {
    set({ loading: true, error: null });
    try {
      await window.electronAPI.licenseDeactivate();
      // Re-load to get updated free-tier info
      const info = await window.electronAPI.licenseCheck();
      set({ info, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Deactivation failed';
      set({ error: message, loading: false });
      throw error;
    }
  },

  isProFeature: (_feature: ProFeatureKey) => {
    const { info } = get();
    if (!info) return false;
    const isActiveTier = info.status === 'active' || info.status === 'trial' || info.status === 'expired_fallback';
    return isActiveTier && info.tier === 'pro';
  },
}));
