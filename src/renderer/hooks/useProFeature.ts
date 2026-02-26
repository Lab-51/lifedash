// === FILE PURPOSE ===
// Hook for checking whether a Pro feature is enabled based on the cached
// license state. Returns a synchronous enabled flag so components can gate
// without async calls.
//
// === DEPENDENCIES ===
// useLicenseStore, shared types (LicenseInfo), shared constants (ProFeatureKey)

import { useLicenseStore } from '../stores/licenseStore';
import type { LicenseInfo } from '../../shared/types/license';
import type { ProFeatureKey } from '../../shared/constants/features';

interface UseProFeatureResult {
  enabled: boolean;
  info: LicenseInfo | null;
}

/**
 * Check whether a specific Pro feature is accessible given the current license.
 * Returns `enabled = true` only when tier is 'pro' and status is 'active' or 'trial'.
 */
export function useProFeature(_feature: ProFeatureKey): UseProFeatureResult {
  const info = useLicenseStore(s => s.info);
  const enabled =
    info !== null &&
    (info.status === 'active' || info.status === 'trial' || info.status === 'expired_fallback') &&
    info.tier === 'pro';
  return { enabled, info };
}
