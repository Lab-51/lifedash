// === FILE PURPOSE ===
// Wrapper component that renders children when a Pro feature is enabled,
// or shows an UpgradePrompt (or a custom fallback) when it is not.
// Drop-in guard for any UI section that requires a Pro license.
//
// === DEPENDENCIES ===
// react, useProFeature hook, UpgradePrompt component

import type { ReactNode } from 'react';
import { useProFeature } from '../hooks/useProFeature';
import UpgradePrompt from './UpgradePrompt';
import type { ProFeatureKey } from '../../shared/constants/features';

interface ProGateProps {
  /** The Pro feature key to gate on. */
  feature: ProFeatureKey;
  /** Content to render when the feature is enabled. */
  children: ReactNode;
  /** Custom fallback rendered when feature is NOT enabled. Defaults to UpgradePrompt. */
  fallback?: ReactNode;
}

/**
 * Renders `children` when the feature is enabled, otherwise renders
 * `fallback` (or the default UpgradePrompt) when the user is on the free tier.
 */
function ProGate({ feature, children, fallback }: ProGateProps) {
  const { enabled, info } = useProFeature(feature);

  if (enabled) {
    return <>{children}</>;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  return <UpgradePrompt feature={feature} info={info} />;
}

export default ProGate;
