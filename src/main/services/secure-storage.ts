// === FILE PURPOSE ===
// Wraps Electron safeStorage API for secure API key encryption/decryption.
// Encrypts strings to base64 for DB storage, decrypts on demand.
// Uses OS-level encryption: DPAPI (Windows), Keychain (macOS), libsecret (Linux).
//
// === DEPENDENCIES ===
// electron (safeStorage)
//
// === LIMITATIONS ===
// - Only usable in main process (not preload or renderer)
// - Must be called after app 'ready' event
// - On Windows, protects from other users but not other apps on same account
//
// === VERIFICATION STATUS ===
// - safeStorage API: verified in Electron docs (available since Electron 15)

import { safeStorage } from 'electron';

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function encryptString(plaintext: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system');
  }
  const encrypted = safeStorage.encryptString(plaintext);
  return encrypted.toString('base64');
}

export function decryptString(encryptedBase64: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system');
  }
  const buffer = Buffer.from(encryptedBase64, 'base64');
  return safeStorage.decryptString(buffer);
}
