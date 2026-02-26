// === FILE PURPOSE ===
// Reusable IPC license guard. Call requireProFeature() as the first line
// of any handler that requires a Pro license. Throws a prefixed error
// that the renderer can detect and route to an upgrade prompt.

import { isFeatureEnabled } from '../services/licensingService';
import type { ProFeatureKey } from '../../shared/constants/features';

/** Prefix added to all license-gate error messages. Renderer detects this string. */
export const LICENSE_ERROR_PREFIX = 'LICENSE_REQUIRED:';

/**
 * Resolves quietly if the feature is enabled.
 * Throws a prefixed Error if the feature is not enabled, so IPC error
 * propagates to the renderer with a detectable prefix.
 */
export async function requireProFeature(feature: ProFeatureKey): Promise<void> {
  const enabled = await isFeatureEnabled(feature);
  if (!enabled) {
    throw new Error(`${LICENSE_ERROR_PREFIX} ${feature}`);
  }
}
