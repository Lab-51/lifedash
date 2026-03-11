// === FILE PURPOSE ===
// Schema for the sync_tracking table — stores per-table sync watermarks.
// Used by the sync service to track when each table was last synced to Supabase.

import { pgTable, varchar, timestamp } from 'drizzle-orm/pg-core';

export const syncTracking = pgTable('sync_tracking', {
  tableName: varchar('table_name', { length: 100 }).primaryKey(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
});
