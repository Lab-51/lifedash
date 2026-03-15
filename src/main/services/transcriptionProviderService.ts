// === FILE PURPOSE ===
// Manages transcription provider configuration — which provider (local/deepgram/assemblyai)
// is active and stores encrypted API keys for cloud providers.
//
// === DEPENDENCIES ===
// secure-storage (encryptString/decryptString), settings table, whisperModelManager
//
// === LIMITATIONS ===
// - API keys are encrypted at rest but decrypted in memory for API calls
// - Only one active provider at a time (no round-robin or load balancing)

import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { encryptString, decryptString } from './secure-storage';
import * as whisperModelManager from './whisperModelManager';
import { createLogger } from './logger';
import type {
  TranscriptionProviderConfig,
  TranscriptionProviderStatus,
  TranscriptionProviderType,
} from '../../shared/types';

const log = createLogger('TranscriptionProvider');

const SETTINGS_KEY = 'transcription_provider';
const DEFAULT_CONFIG: TranscriptionProviderConfig = { type: 'local' };

/**
 * Load transcription provider config from the settings table.
 * Returns defaults if no config has been saved yet.
 * Merges stored values with defaults for forward-compatibility.
 */
export async function getConfig(): Promise<TranscriptionProviderConfig> {
  try {
    const db = getDb();
    const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);

    if (rows.length === 0) {
      return { ...DEFAULT_CONFIG };
    }

    const stored = JSON.parse(rows[0].value) as Partial<TranscriptionProviderConfig>;
    return { ...DEFAULT_CONFIG, ...stored };
  } catch (err) {
    log.error('Failed to load config:', err);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Get the renderer-safe status (no encrypted key strings — only boolean flags).
 */
export async function getStatus(): Promise<TranscriptionProviderStatus> {
  const config = await getConfig();
  return {
    type: config.type,
    hasDeepgramKey: !!config.deepgramKeyEncrypted,
    hasAssemblyaiKey: !!config.assemblyaiKeyEncrypted,
    localModelAvailable: !!(await whisperModelManager.getDefaultModelPath()),
  };
}

/**
 * Change the active transcription provider type.
 */
export async function setProviderType(type: TranscriptionProviderType): Promise<void> {
  const config = await getConfig();
  config.type = type;
  await saveConfig(config);
}

/**
 * Store an encrypted API key for a cloud transcription provider.
 * The plain-text key is encrypted via Electron safeStorage before storage.
 */
export async function setApiKey(provider: 'deepgram' | 'assemblyai', apiKey: string): Promise<void> {
  const config = await getConfig();
  const encrypted = encryptString(apiKey);

  if (provider === 'deepgram') {
    config.deepgramKeyEncrypted = encrypted;
  } else {
    config.assemblyaiKeyEncrypted = encrypted;
  }

  await saveConfig(config);
}

/**
 * Decrypt and return an API key for internal use by transcriber services.
 * Never exposed via IPC — only used by main-process transcription logic.
 */
export async function getDecryptedKey(provider: 'deepgram' | 'assemblyai'): Promise<string | null> {
  const config = await getConfig();
  const encrypted = provider === 'deepgram' ? config.deepgramKeyEncrypted : config.assemblyaiKeyEncrypted;

  if (!encrypted) return null;

  try {
    return decryptString(encrypted);
  } catch (err) {
    log.error(`Failed to decrypt ${provider} key:`, err);
    return null;
  }
}

// --- Internal helper ---

/**
 * Upsert the transcription provider config to the settings table.
 */
async function saveConfig(config: TranscriptionProviderConfig): Promise<void> {
  const db = getDb();
  const value = JSON.stringify(config);

  const existing = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);

  if (existing.length > 0) {
    await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, SETTINGS_KEY));
  } else {
    await db.insert(settings).values({
      key: SETTINGS_KEY,
      value,
    });
  }
}
