// === FILE PURPOSE ===
// Runs Drizzle ORM migrations against the connected database.
// Called during app startup after the database connection is established.

// === DEPENDENCIES ===
// drizzle-orm/postgres-js/migrator

// === LIMITATIONS ===
// - In development, migrations are read from the project root ./drizzle/ folder.
// - TODO: For production (asar packaging), migrations will need special handling.
//   Options include: extracting from asar at runtime, shipping as extraResource,
//   or bundling migration SQL as embedded strings. This is a Phase 7 concern.

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDb } from './connection';
import path from 'node:path';
import { app } from 'electron';

export async function runMigrations(): Promise<void> {
  const db = getDb();

  // In development, migrations folder is relative to project root.
  // In production, we'd need to resolve from app resources.
  // TODO: Handle asar packaging for production builds.
  const migrationsFolder = app.isPackaged
    ? path.join(process.resourcesPath, 'drizzle')
    : path.join(app.getAppPath(), 'drizzle');

  await migrate(db, { migrationsFolder });
}
