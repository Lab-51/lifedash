// === FILE PURPOSE ===
// License-related type definitions shared between main process and renderer.

export type LicenseTier = 'free' | 'pro';
// expired_fallback: license expired but user is on the same version they paid for — Pro stays unlocked
export type LicenseStatus = 'active' | 'expired' | 'expired_fallback' | 'inactive' | 'disabled' | 'trial' | 'trial_expired';

export interface LicenseInfo {
  tier: LicenseTier;
  status: LicenseStatus;
  licenseKey: string | null;
  customerName: string | null;
  customerEmail: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  lastValidated: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  instanceId: string | null;
  /** App version when the license was last active. Used for perpetual fallback. */
  lastActiveVersion: string | null;
}
