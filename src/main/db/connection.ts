// === FILE PURPOSE ===
// Database connection management for the Electron main process.
// Creates and manages a PGlite (WASM PostgreSQL) instance with filesystem
// persistence and wraps it with Drizzle ORM for type-safe queries.

// === DEPENDENCIES ===
// @electric-sql/pglite, drizzle-orm/pglite

// === LIMITATIONS ===
// - PGlite runs PostgreSQL in-process via WASM -- no external server needed.
// - Data is persisted to the Electron userData directory.
// - Single-connection (no pool), which is fine for a desktop app.

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { app } from 'electron';
import path from 'node:path';
import * as schema from './schema';

// Module-level state
let pglite: PGlite | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Returns the filesystem path where PGlite stores its data.
 * Located inside the Electron userData directory so it persists across app restarts.
 */
export function getDataDirectory(): string {
  return path.join(app.getPath('userData'), 'pg-data');
}

export async function connectDatabase(): Promise<void> {
  const dataDir = getDataDirectory();
  pglite = new PGlite(dataDir);
  db = drizzle(pglite, { schema });
}

export function getDb() {
  if (!db) {
    throw new Error('Database not connected. Call connectDatabase() first.');
  }
  return db;
}

/**
 * Returns the raw PGlite instance for direct access (health checks, backups, etc.).
 * Throws if the database has not been connected yet.
 */
export function getPglite(): PGlite {
  if (!pglite) {
    throw new Error('Database not connected. Call connectDatabase() first.');
  }
  return pglite;
}

export async function disconnectDatabase(): Promise<void> {
  if (pglite) {
    await pglite.close();
    pglite = null;
    db = null;
  }
}

export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  message: string;
}> {
  try {
    if (!pglite) return { connected: false, message: 'Not connected' };
    await pglite.query('SELECT 1');
    return { connected: true, message: 'Connected' };
  } catch (error) {
    return {
      connected: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
