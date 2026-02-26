// === FILE PURPOSE ===
// Main-process licensing service for LifeDash's freemium model.
// Handles LemonSqueezy license activation/validation, 14-day trial auto-start,
// 7-day offline grace, and machine fingerprinting.
// All license logic is here — renderer communicates via IPC only.
//
// === DEPENDENCIES ===
// @lemonsqueezy/lemonsqueezy.js (activateLicense, validateLicense, deactivateLicense)
// node-machine-id (machineIdSync)
// crypto (SHA-256 hashing)
// ../services/secure-storage (encryptString, decryptString)
//
// === LIMITATIONS ===
// - Only usable in main process after app 'ready'
// - LEMONSQUEEZY_STORE_ID / LEMONSQUEEZY_PRODUCT_IDS are configured for the LifeDash store
// - lemonSqueezySetup() requires an API key for admin endpoints; license public endpoints work without it

import crypto from 'node:crypto';
import { app } from 'electron';
import { machineIdSync } from 'node-machine-id';
import {
  activateLicense,
  validateLicense,
  deactivateLicense,
  lemonSqueezySetup,
} from '@lemonsqueezy/lemonsqueezy.js';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { encryptString, decryptString, isEncryptionAvailable } from './secure-storage';
import type { LicenseInfo, LicenseStatus, LicenseTier } from '../../shared/types/license';
import { PRO_FEATURES, type ProFeatureKey } from '../../shared/constants/features';

// === CONSTANTS ===
const LEMONSQUEEZY_STORE_ID = 301928;
const LEMONSQUEEZY_PRODUCT_IDS: readonly number[] = [855065, 855068]; // Pro Annual, Pro Lifetime
const TRIAL_DURATION_DAYS = 14;
const OFFLINE_GRACE_DAYS = 7;
const MACHINE_ID_SALT = 'lifedash-v1';

// In-memory cache — refreshed by checkLicense() / activateLicense()
let _cachedInfo: LicenseInfo | null = null;

// Initialize LS SDK (public endpoints don't need an API key, but setup is required)
lemonSqueezySetup({ apiKey: '' });

// === MACHINE FINGERPRINT ===

/** Returns a stable 32-char machine fingerprint (SHA-256 of hardware ID + salt). */
function getMachineFingerprint(): string {
  const raw = machineIdSync();
  const hash = crypto
    .createHash('sha256')
    .update(raw + MACHINE_ID_SALT)
    .digest('hex');
  return hash.substring(0, 32);
}

// === SETTINGS HELPERS ===

async function getSetting(key: string): Promise<string | null> {
  const db = getDb();
  const rows = await db.select().from(settings).where(eq(settings.key, key));
  return rows.length > 0 ? rows[0].value : null;
}

async function setSetting(key: string, value: string): Promise<void> {
  const db = getDb();
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });
}

async function deleteSetting(key: string): Promise<void> {
  const db = getDb();
  await db.delete(settings).where(eq(settings.key, key));
}

/** Encrypt a value if safeStorage is available; fall back to plain text. */
function safeEncrypt(value: string): string {
  if (isEncryptionAvailable()) {
    return encryptString(value);
  }
  return value;
}

/** Decrypt a value if safeStorage is available; fall back to plain text. */
function safeDecrypt(value: string): string {
  if (isEncryptionAvailable()) {
    return decryptString(value);
  }
  return value;
}

// === HMAC TAMPER DETECTION ===

/** Fields covered by the HMAC checksum — excludes lastValidated (changes every validation)
 *  and customerName/customerEmail (metadata only). Includes trial fields (tamper-attractive). */
const HMAC_FIELDS: readonly (keyof LicenseInfo)[] = [
  'tier', 'status', 'licenseKey', 'instanceId', 'activatedAt', 'expiresAt',
  'lastActiveVersion', 'trialStartedAt', 'trialEndsAt',
] as const;

/** Serialize HMAC_FIELDS into a deterministic payload and return HMAC-SHA256 hex digest. */
function computeHmac(info: LicenseInfo, secret: string): string {
  const payload = HMAC_FIELDS
    .map((field) => `${field}=${info[field] ?? ''}`)
    .join('|');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Read or create the HMAC secret stored (encrypted) as license.hmacSecret. */
async function getOrCreateHmacSecret(): Promise<string> {
  const stored = await getSetting('license.hmacSecret');
  if (stored) {
    return safeDecrypt(stored);
  }
  // First time — generate a random 32-byte hex secret and persist it
  const secret = crypto.randomBytes(32).toString('hex');
  await setSetting('license.hmacSecret', safeEncrypt(secret));
  return secret;
}

/** Verify the stored checksum against the current LicenseInfo.
 *  Returns true when no checksum exists (pre-checksum installs — will backfill). */
async function verifyChecksum(info: LicenseInfo): Promise<boolean> {
  const stored = await getSetting('license.checksum');
  if (!stored) {
    // No checksum yet — trust the data and backfill on next write
    return true;
  }
  const secret = await getOrCreateHmacSecret();
  const expected = computeHmac(info, secret);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(stored, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    // Mismatched buffer lengths — treat as tampered
    return false;
  }
}

/** Compute and persist the HMAC checksum for the given LicenseInfo. */
async function persistChecksum(info: LicenseInfo): Promise<void> {
  const secret = await getOrCreateHmacSecret();
  const checksum = computeHmac(info, secret);
  await setSetting('license.checksum', checksum);
}

// === CACHE BUILDER ===

/** Build a LicenseInfo from settings DB. Returns null if no license data exists. */
async function buildInfoFromSettings(): Promise<LicenseInfo | null> {
  const tier = (await getSetting('license.tier')) as LicenseTier | null;
  const status = (await getSetting('license.status')) as LicenseStatus | null;

  if (!tier || !status) return null;

  const encryptedKey = await getSetting('license.key');
  const encryptedInstanceId = await getSetting('license.instanceId');

  const info: LicenseInfo = {
    tier,
    status,
    licenseKey: encryptedKey ? safeDecrypt(encryptedKey) : null,
    instanceId: encryptedInstanceId ? safeDecrypt(encryptedInstanceId) : null,
    customerName: await getSetting('license.customerName'),
    customerEmail: await getSetting('license.customerEmail'),
    activatedAt: await getSetting('license.activatedAt'),
    expiresAt: await getSetting('license.expiresAt'),
    lastValidated: await getSetting('license.lastValidated'),
    trialStartedAt: await getSetting('license.trialStartedAt'),
    trialEndsAt: await getSetting('license.trialEndsAt'),
    lastActiveVersion: await getSetting('license.lastActiveVersion'),
  };

  const hadChecksum = (await getSetting('license.checksum')) !== null;
  const valid = await verifyChecksum(info);

  if (!valid) {
    // Tampered — reset to free/expired
    const reset: LicenseInfo = {
      tier: 'free',
      status: 'expired',
      licenseKey: null,
      instanceId: null,
      customerName: null,
      customerEmail: null,
      activatedAt: null,
      expiresAt: null,
      lastValidated: null,
      trialStartedAt: null,
      trialEndsAt: null,
      lastActiveVersion: null,
    };
    // persistInfo already calls persistChecksum internally
    await persistInfo(reset);
    return reset;
  }

  // Valid — backfill checksum for pre-checksum installs
  if (!hadChecksum) {
    await persistChecksum(info);
  }

  return info;
}

/** Persist a LicenseInfo to settings DB (encrypt sensitive fields). */
async function persistInfo(info: LicenseInfo): Promise<void> {
  await setSetting('license.tier', info.tier);
  await setSetting('license.status', info.status);

  if (info.licenseKey) {
    await setSetting('license.key', safeEncrypt(info.licenseKey));
  } else {
    await deleteSetting('license.key');
  }

  if (info.instanceId) {
    await setSetting('license.instanceId', safeEncrypt(info.instanceId));
  } else {
    await deleteSetting('license.instanceId');
  }

  if (info.customerName) {
    await setSetting('license.customerName', info.customerName);
  } else {
    await deleteSetting('license.customerName');
  }

  if (info.customerEmail) {
    await setSetting('license.customerEmail', info.customerEmail);
  } else {
    await deleteSetting('license.customerEmail');
  }

  if (info.activatedAt) {
    await setSetting('license.activatedAt', info.activatedAt);
  } else {
    await deleteSetting('license.activatedAt');
  }

  if (info.expiresAt) {
    await setSetting('license.expiresAt', info.expiresAt);
  } else {
    await deleteSetting('license.expiresAt');
  }

  if (info.lastValidated) {
    await setSetting('license.lastValidated', info.lastValidated);
  }

  if (info.trialStartedAt) {
    await setSetting('license.trialStartedAt', info.trialStartedAt);
  } else {
    await deleteSetting('license.trialStartedAt');
  }

  if (info.trialEndsAt) {
    await setSetting('license.trialEndsAt', info.trialEndsAt);
  } else {
    await deleteSetting('license.trialEndsAt');
  }

  if (info.lastActiveVersion) {
    await setSetting('license.lastActiveVersion', info.lastActiveVersion);
  } else {
    await deleteSetting('license.lastActiveVersion');
  }

  await persistChecksum(info);
}

// === TRIAL HELPERS ===

/** Returns a new trial LicenseInfo starting now. */
function buildTrialInfo(): LicenseInfo {
  const now = new Date();
  const trialEnd = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);
  return {
    tier: 'pro',
    status: 'trial',
    licenseKey: null,
    instanceId: null,
    customerName: null,
    customerEmail: null,
    activatedAt: null,
    expiresAt: null,
    lastValidated: null,
    trialStartedAt: now.toISOString(),
    trialEndsAt: trialEnd.toISOString(),
    lastActiveVersion: app.getVersion(),
  };
}

/** Check whether a trial is still active given its end date. */
function isTrialActive(trialEndsAt: string | null): boolean {
  if (!trialEndsAt) return false;
  return new Date(trialEndsAt) > new Date();
}

// === PUBLIC API ===

/**
 * Initialize license on app startup.
 * - First run (no cache): starts 14-day trial.
 * - Existing cache: runs checkLicense().
 */
export async function initializeLicense(): Promise<LicenseInfo> {
  const existing = await buildInfoFromSettings();

  if (!existing) {
    // First run — start trial
    const trial = buildTrialInfo();
    await persistInfo(trial);
    _cachedInfo = trial;
    return trial;
  }

  // Existing data — validate
  return checkLicense();
}

/**
 * Primary validation flow:
 * 1. Trial check (no network needed)
 * 2. Online validation against LemonSqueezy
 * 3. Offline grace (7 days since last successful validation)
 * 4. Expired
 */
export async function checkLicense(): Promise<LicenseInfo> {
  const info = await buildInfoFromSettings();

  if (!info) {
    return initializeLicense();
  }

  // --- Trial path ---
  if (info.status === 'trial' || info.status === 'trial_expired') {
    const active = isTrialActive(info.trialEndsAt);
    const updated: LicenseInfo = { ...info, status: active ? 'trial' : 'trial_expired' };
    await persistInfo(updated);
    _cachedInfo = updated;
    return updated;
  }

  // --- Licensed path — try online validation ---
  if (info.licenseKey) {
    try {
      const result = await validateLicense(info.licenseKey, info.instanceId ?? undefined);

      if (result.error) {
        throw new Error(result.error.message);
      }

      const data = result.data;
      if (!data) {
        throw new Error('No data in validate response');
      }

      // Verify this key belongs to our store/product
      if (LEMONSQUEEZY_STORE_ID && data.meta.store_id !== LEMONSQUEEZY_STORE_ID) {
        throw new Error('License key does not match this store');
      }
      if (LEMONSQUEEZY_PRODUCT_IDS.length && !LEMONSQUEEZY_PRODUCT_IDS.includes(data.meta.product_id)) {
        throw new Error('License key does not match this product');
      }

      const lsStatus = data.license_key.status; // 'active' | 'inactive' | 'expired' | 'disabled'
      const mappedStatus: LicenseStatus =
        lsStatus === 'active' ? 'active' :
        lsStatus === 'expired' ? 'expired' :
        lsStatus === 'disabled' ? 'disabled' :
        'inactive';

      const isActive = mappedStatus === 'active';
      const updated: LicenseInfo = {
        ...info,
        status: mappedStatus,
        tier: isActive ? 'pro' : 'free',
        customerName: data.meta.customer_name,
        customerEmail: data.meta.customer_email,
        expiresAt: data.license_key.expires_at,
        lastValidated: new Date().toISOString(),
        // Stamp current app version while license is active (for perpetual fallback)
        lastActiveVersion: isActive ? app.getVersion() : info.lastActiveVersion,
      };

      // If license expired remotely, check perpetual fallback
      if (!isActive && info.lastActiveVersion) {
        return applyPerpetualFallback(updated);
      }

      await persistInfo(updated);
      _cachedInfo = updated;
      return updated;
    } catch (_err) {
      // Network or validation error — check offline grace
      return applyOfflineGrace(info);
    }
  }

  // No key — check perpetual fallback before locking
  if (info.lastActiveVersion) {
    return applyPerpetualFallback(info);
  }
  const expired: LicenseInfo = { ...info, status: 'expired', tier: 'free', lastActiveVersion: null };
  await persistInfo(expired);
  _cachedInfo = expired;
  return expired;
}

/** Apply 7-day offline grace window based on lastValidated timestamp. */
async function applyOfflineGrace(info: LicenseInfo): Promise<LicenseInfo> {
  if (!info.lastValidated) {
    // No previous validation — try perpetual fallback, else expire
    if (info.lastActiveVersion) return applyPerpetualFallback(info);
    const expired: LicenseInfo = { ...info, status: 'expired', tier: 'free', lastActiveVersion: null };
    await persistInfo(expired);
    _cachedInfo = expired;
    return expired;
  }

  const lastValidated = new Date(info.lastValidated);
  const graceEnd = new Date(lastValidated.getTime() + OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const withinGrace = new Date() < graceEnd;

  if (withinGrace) {
    // Keep existing active status during grace
    _cachedInfo = info;
    return info;
  }

  // Grace expired — try perpetual fallback before locking
  if (info.lastActiveVersion) return applyPerpetualFallback(info);

  const expired: LicenseInfo = { ...info, status: 'expired', tier: 'free', lastActiveVersion: null };
  await persistInfo(expired);
  _cachedInfo = expired;
  return expired;
}

/**
 * Perpetual fallback: if the user is on the same app version they had while licensed,
 * keep Pro features unlocked. Only lock if they've updated to a newer version.
 * This is the "you keep what you paid for" model.
 */
async function applyPerpetualFallback(info: LicenseInfo): Promise<LicenseInfo> {
  const currentVersion = app.getVersion();
  const paidVersion = info.lastActiveVersion;

  if (paidVersion && currentVersion === paidVersion) {
    // Same version — keep Pro unlocked with expired_fallback status
    const fallback: LicenseInfo = { ...info, status: 'expired_fallback', tier: 'pro' };
    await persistInfo(fallback);
    _cachedInfo = fallback;
    return fallback;
  }

  // User updated to a newer version without renewing — lock Pro features
  const expired: LicenseInfo = { ...info, status: 'expired', tier: 'free' };
  await persistInfo(expired);
  _cachedInfo = expired;
  return expired;
}

/**
 * Activate a license key against LemonSqueezy.
 * Stores encrypted key + instanceId + metadata in settings table.
 */
export async function activateLicenseKey(licenseKey: string): Promise<LicenseInfo> {
  const machineId = getMachineFingerprint();

  const result = await activateLicense(licenseKey, machineId);

  if (result.error) {
    throw new Error(result.error.message || 'Failed to activate license');
  }

  const data = result.data;
  if (!data) {
    throw new Error('No data in activate response');
  }

  if (!data.activated) {
    throw new Error(data.error ?? 'License activation was rejected');
  }

  // Verify store + product match
  if (LEMONSQUEEZY_STORE_ID && data.meta.store_id !== LEMONSQUEEZY_STORE_ID) {
    throw new Error('License key does not match this store');
  }
  if (LEMONSQUEEZY_PRODUCT_IDS.length && !LEMONSQUEEZY_PRODUCT_IDS.includes(data.meta.product_id)) {
    throw new Error('License key does not match this product');
  }

  const now = new Date().toISOString();
  const activated: LicenseInfo = {
    tier: 'pro',
    status: 'active',
    licenseKey,
    instanceId: data.instance?.id ?? null,
    customerName: data.meta.customer_name,
    customerEmail: data.meta.customer_email,
    activatedAt: now,
    expiresAt: data.license_key.expires_at,
    lastValidated: now,
    trialStartedAt: null,
    trialEndsAt: null,
    lastActiveVersion: app.getVersion(),
  };

  await persistInfo(activated);
  _cachedInfo = activated;
  return activated;
}

/**
 * Deactivate the current license key instance.
 * Clears local data and reverts to free/expired state.
 */
export async function deactivateLicenseKey(): Promise<LicenseInfo> {
  const info = await buildInfoFromSettings();

  if (info?.licenseKey && info?.instanceId) {
    try {
      await deactivateLicense(info.licenseKey, info.instanceId);
    } catch (_err) {
      // Proceed with local cleanup even if network call fails
    }
  }

  const cleared: LicenseInfo = {
    tier: 'free',
    status: 'inactive',
    licenseKey: null,
    instanceId: null,
    customerName: null,
    customerEmail: null,
    activatedAt: null,
    expiresAt: null,
    lastValidated: null,
    trialStartedAt: null,
    trialEndsAt: null,
    lastActiveVersion: null,
  };

  await persistInfo(cleared);
  _cachedInfo = cleared;
  return cleared;
}

/**
 * Returns cached LicenseInfo without any network call.
 * Initializes from DB if cache is empty.
 */
export async function getLicenseInfo(): Promise<LicenseInfo> {
  if (_cachedInfo) return _cachedInfo;

  const fromDb = await buildInfoFromSettings();
  if (fromDb) {
    _cachedInfo = fromDb;
    return fromDb;
  }

  // No data yet — initialize
  return initializeLicense();
}

/**
 * Returns true if the given pro feature is enabled.
 * Enabled when tier is 'pro' and status is 'active' or 'trial'.
 */
export async function isFeatureEnabled(feature: ProFeatureKey): Promise<boolean> {
  // Validate feature key exists (prevents arbitrary strings)
  if (!(feature in PRO_FEATURES)) return false;

  const info = await getLicenseInfo();
  return info.tier === 'pro' && (info.status === 'active' || info.status === 'trial' || info.status === 'expired_fallback');
}
