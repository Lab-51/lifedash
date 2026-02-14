// === FILE PURPOSE ===
// Drizzle Kit configuration for schema generation and migrations.
// Used by drizzle-kit CLI commands (db:generate, db:migrate, db:studio) ONLY.
// The app uses PGlite at runtime (see src/main/db/connection.ts).
// Keep the Docker URL here for optional drizzle-kit studio/migrate usage.

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/main/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://dashboard:localdev@localhost:5432/living_dashboard',
  },
});
