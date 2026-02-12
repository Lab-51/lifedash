// === FILE PURPOSE ===
// Drizzle Kit configuration for schema generation and migrations.
// Used by drizzle-kit CLI commands (db:generate, db:migrate, db:studio).

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/main/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://dashboard:localdev@localhost:5432/living_dashboard',
  },
});
