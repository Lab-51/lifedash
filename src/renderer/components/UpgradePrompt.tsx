// === FILE PURPOSE ===
// HUD-styled card shown when a Pro feature is accessed by a free user.
// Displays the feature name, description, trial expiry notice if applicable,
// and an "Upgrade to Pro" button that opens the checkout page.
//
// === DEPENDENCIES ===
// react, lucide-react, PRO_FEATURES constant, LicenseInfo type

import type { ReactNode } from 'react';
import { Lock, Zap, ExternalLink } from 'lucide-react';
import { PRO_FEATURES } from '../../shared/constants/features';
import type { ProFeatureKey } from '../../shared/constants/features';
import type { LicenseInfo } from '../../shared/types/license';

// TODO: Fill after LemonSqueezy store setup
const CHECKOUT_URL = 'https://lifedash.lemonsqueezy.com/buy/lifedash-pro';

interface UpgradePromptProps {
  feature: ProFeatureKey;
  info: LicenseInfo | null;
  /** Optional extra content rendered below the prompt body. */
  children?: ReactNode;
}

function UpgradePrompt({ feature, info, children }: UpgradePromptProps) {
  const featureDef = PRO_FEATURES[feature];
  const isTrialExpired = info?.status === 'trial_expired';

  function handleUpgrade() {
    window.open(CHECKOUT_URL, '_blank');
  }

  return (
    <div
      className="flex flex-col items-center justify-center p-8 text-center"
      style={{ minHeight: '200px' }}
    >
      {/* HUD panel */}
      <div
        className="relative w-full max-w-md clip-corner-cut"
        style={{
          background: 'var(--color-surface-950)',
          border: '1px solid var(--color-border)',
          borderRadius: '2px',
          padding: '2rem',
        }}
      >
        {/* Top accent line */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '1.5rem',
            right: '1.5rem',
            height: '2px',
            background: 'var(--color-accent)',
            opacity: 0.8,
          }}
        />

        {/* Lock icon */}
        <div
          className="flex items-center justify-center mx-auto mb-4"
          style={{
            width: '3rem',
            height: '3rem',
            borderRadius: '50%',
            background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)',
          }}
        >
          <Lock
            size={20}
            style={{ color: 'var(--color-accent)' }}
          />
        </div>

        {/* Trial expired notice */}
        {isTrialExpired && (
          <div
            className="mb-3 px-3 py-1.5 rounded font-mono text-xs tracking-wider"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
              color: 'var(--color-accent)',
            }}
          >
            Your 14-day trial has ended
          </div>
        )}

        {/* Feature label */}
        <p
          className="font-mono text-xs uppercase tracking-widest mb-1"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Pro Feature
        </p>

        {/* Feature name */}
        <h3
          className="font-hud text-xl font-bold mb-2"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {featureDef.label}
        </h3>

        {/* Feature description */}
        <p
          className="text-sm mb-6"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {featureDef.description}
        </p>

        {/* Upgrade button */}
        <button
          onClick={handleUpgrade}
          className="inline-flex items-center gap-2 px-5 py-2.5 clip-corner-cut font-hud font-semibold text-sm uppercase tracking-wider transition-opacity hover:opacity-90 active:opacity-75"
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-surface-950)',
          }}
        >
          <Zap size={15} />
          Upgrade to Pro
          <ExternalLink size={13} />
        </button>

        {children && (
          <div className="mt-4">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

export default UpgradePrompt;
