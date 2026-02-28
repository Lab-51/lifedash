// === FILE PURPOSE ===
// Runs Drizzle ORM migrations against the connected database.
// Called during app startup after the database connection is established.

// === DEPENDENCIES ===
// drizzle-orm/pglite/migrator

// === LIMITATIONS ===
// - In development, migrations are read from the project root ./drizzle/ folder.
// - In production, migrations are shipped as an extraResource alongside the asar.

import { migrate } from 'drizzle-orm/pglite/migrator';
import { getDb } from './connection';
import path from 'node:path';
import { app } from 'electron';

export async function runMigrations(): Promise<void> {
  const db = getDb();

  // In development, migrations folder is relative to project root.
  // In production, resolved from the extraResource path alongside the asar.
  const migrationsFolder = app.isPackaged
    ? path.join(process.resourcesPath, 'drizzle')
    : path.join(app.getAppPath(), 'drizzle');

  await migrate(db, { migrationsFolder });
}
