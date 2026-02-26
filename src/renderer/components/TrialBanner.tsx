// === FILE PURPOSE ===
// Thin banner displayed below the TitleBar during an active Pro trial.
// Shows the number of trial days remaining, a progress bar, and a button
// to navigate to Settings > License tab. Dismissible per session.
//
// === DEPENDENCIES ===
// react, lucide-react, useLicenseStore, react-router-dom

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, X } from 'lucide-react';
import { useLicenseStore } from '../stores/licenseStore';

/** Calculate days remaining until trialEndsAt. Returns null if unavailable. */
function daysRemaining(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const end = new Date(trialEndsAt).getTime();
  const now = Date.now();
  const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  return Math.max(diff, 0);
}

/** Calculate trial progress (0–1). Returns 0 if dates unavailable. */
function trialProgress(trialStartedAt: string | null, trialEndsAt: string | null): number {
  if (!trialStartedAt || !trialEndsAt) return 0;
  const start = new Date(trialStartedAt).getTime();
  const end = new Date(trialEndsAt).getTime();
  const now = Date.now();
  const total = end - start;
  if (total <= 0) return 1;
  return Math.min(Math.max((now - start) / total, 0), 1);
}

export default function TrialBanner() {
  const info = useLicenseStore(s => s.info);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  // Only show during active trial
  if (dismissed || !info || info.status !== 'trial' || info.tier !== 'pro') {
    return null;
  }

  const days = daysRemaining(info.trialEndsAt);
  const progress = trialProgress(info.trialStartedAt, info.trialEndsAt);
  const progressPct = Math.round((1 - progress) * 100);

  return (
    <div
      className="shrink-0 flex items-center gap-3 px-4 py-1.5 text-xs font-data"
      style={{
        background: 'color-mix(in srgb, var(--color-accent) 6%, var(--color-chrome))',
        borderBottom: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
      }}
    >
      <Zap size={12} className="text-[var(--color-accent)] shrink-0" />

      <span className="text-[var(--color-text-secondary)]">
        <span className="text-[var(--color-accent)] font-semibold">Pro Trial</span>
        {days !== null && (
          <> &mdash; {days} day{days !== 1 ? 's' : ''} remaining</>
        )}
      </span>

      {/* Progress bar */}
      <div
        className="flex-1 max-w-[120px] h-1 rounded-full overflow-hidden"
        style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${progressPct}%`,
            background: 'var(--color-accent)',
          }}
        />
      </div>

      <button
        onClick={() => navigate('/settings?tab=license')}
        className="flex items-center gap-1 text-[var(--color-accent)] hover:opacity-80 transition-opacity border border-[var(--color-accent)]/30 rounded px-2 py-0.5 font-hud tracking-wider uppercase text-[10px]"
      >
        Enter License Key
      </button>

      <button
        onClick={() => setDismissed(true)}
        className="ml-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        title="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  );
}
