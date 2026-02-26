// === FILE PURPOSE ===
// License management section for the Settings page.
// Displays current license status, provides a key activation form,
// deactivation controls, a customer portal link, and a Pro feature list.
//
// === DEPENDENCIES ===
// react, lucide-react, useLicenseStore, PRO_FEATURES, toast

import { useState } from 'react';
import { Key, Check, Lock, ExternalLink, Loader2, Zap, AlertCircle } from 'lucide-react';
import { useLicenseStore } from '../../stores/licenseStore';
import { PRO_FEATURES } from '../../../shared/constants/features';
import { toast } from '../../hooks/useToast';

// TODO: Replace with actual LemonSqueezy customer portal URL after store setup
const CUSTOMER_PORTAL_URL = 'https://app.lemonsqueezy.com/my-orders';

/** Returns badge class and label text for the given license status. */
function statusBadge(status: string): { classes: string; label: string } {
  switch (status) {
    case 'trial':
      return { classes: 'bg-amber-500/15 text-amber-400 border border-amber-500/30', label: 'Trial' };
    case 'active':
      return { classes: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30', label: 'Pro — Active' };
    case 'expired':
    case 'trial_expired':
      return { classes: 'bg-red-500/15 text-red-400 border border-red-500/30', label: 'Expired' };
    default:
      return { classes: 'bg-surface-700/40 text-[var(--color-text-muted)] border border-[var(--color-border)]', label: 'Free' };
  }
}

/** Days remaining until a given ISO date string. Returns null if date unavailable. */
function daysUntil(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const diff = Math.ceil((new Date(isoDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return Math.max(diff, 0);
}

export default function LicenseSection() {
  const info = useLicenseStore(s => s.info);
  const loading = useLicenseStore(s => s.loading);
  const activateLicense = useLicenseStore(s => s.activateLicense);
  const deactivateLicense = useLicenseStore(s => s.deactivateLicense);

  const [licenseKey, setLicenseKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const isProActive = info?.status === 'active' || info?.status === 'trial';
  const badge = info ? statusBadge(info.status) : statusBadge('free');
  const trialDaysLeft = isProActive && info?.status === 'trial' ? daysUntil(info.trialEndsAt) : null;

  const handleActivate = async () => {
    const key = licenseKey.trim();
    if (!key) {
      toast('Please enter a license key', 'error');
      return;
    }
    setActivating(true);
    try {
      await activateLicense(key);
      toast('License activated successfully!', 'success');
      setLicenseKey('');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Activation failed', 'error');
    } finally {
      setActivating(false);
    }
  };

  const handleDeactivate = async () => {
    setDeactivating(true);
    setConfirmDeactivate(false);
    try {
      await deactivateLicense();
      toast('License deactivated on this machine', 'info');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Deactivation failed', 'error');
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <section className="mb-10">
      {/* Section header */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Key size={16} className="text-[var(--color-accent)]" />
          <h2 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">License</h2>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Manage your LifeDash Pro license and feature access.
        </p>
      </div>

      {/* Status card */}
      <div className="hud-panel clip-corner-cut-sm p-5 mb-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${badge.classes}`}>
            {badge.label}
            {trialDaysLeft !== null && ` — ${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''} remaining`}
          </span>
          {loading && <Loader2 size={14} className="animate-spin text-[var(--color-text-muted)]" />}
        </div>

        {info?.customerName && (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-[var(--color-text-primary)]">{info.customerName}</span>
            {info.customerEmail && (
              <span className="text-xs text-[var(--color-text-muted)]">{info.customerEmail}</span>
            )}
          </div>
        )}

        {info?.expiresAt && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Expires: <span className="text-[var(--color-text-secondary)]">
              {new Date(info.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
          </p>
        )}
      </div>

      {/* Activation form */}
      <div className="hud-panel clip-corner-cut-sm p-5 mb-4">
        <h3 className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)] mb-3">
          Activate License
        </h3>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={licenseKey}
            onChange={e => setLicenseKey(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleActivate(); }}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="flex-1 text-sm bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] font-mono tracking-wider"
          />
          <button
            onClick={handleActivate}
            disabled={activating || !licenseKey.trim()}
            className="flex items-center gap-2 border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] hover:shadow-[0_0_12px_var(--color-chrome-glow)] disabled:opacity-50 disabled:cursor-not-allowed px-3 py-2 text-sm transition-all whitespace-nowrap"
          >
            {activating ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
            {activating ? 'Activating...' : 'Activate'}
          </button>
        </div>
      </div>

      {/* Manage section — only shown when active */}
      {info?.status === 'active' && (
        <div className="hud-panel clip-corner-cut-sm p-5 mb-4">
          <h3 className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)] mb-3">
            Manage License
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => window.electronAPI.openExternal(CUSTOMER_PORTAL_URL)}
              className="flex items-center gap-2 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-3 py-1.5 text-sm transition-all"
            >
              <ExternalLink size={14} />
              Manage Subscription
            </button>
            {confirmDeactivate ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-400 flex items-center gap-1">
                  <AlertCircle size={13} />
                  Deactivate this machine?
                </span>
                <button
                  onClick={() => setConfirmDeactivate(false)}
                  className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors px-2 py-1"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeactivate}
                  disabled={deactivating}
                  className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-1 rounded transition-colors disabled:opacity-50"
                >
                  {deactivating ? 'Deactivating...' : 'Confirm'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeactivate(true)}
                className="text-xs text-[var(--color-text-muted)] hover:text-red-400 transition-colors px-2 py-1"
              >
                Deactivate this machine
              </button>
            )}
          </div>
        </div>
      )}

      {/* Pro feature list */}
      <div className="hud-panel clip-corner-cut-sm p-5">
        <h3 className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)] mb-3">
          Pro Features
        </h3>
        <div className="flex flex-col gap-2">
          {Object.values(PRO_FEATURES).map(feature => (
            <div key={feature.key} className="flex items-start gap-3">
              <div className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center border transition-colors mt-0.5 ${
                isProActive
                  ? 'bg-emerald-500/15 border-emerald-500/40'
                  : 'bg-surface-800/50 border-[var(--color-border)]'
              }`}>
                {isProActive
                  ? <Check size={11} className="text-emerald-400" />
                  : <Lock size={11} className="text-[var(--color-text-muted)]" />
                }
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">{feature.label}</span>
                <span className="text-xs text-[var(--color-text-muted)]">{feature.description}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
