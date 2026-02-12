// === FILE PURPOSE ===
// Database connection management for the Electron main process.
// Creates and manages a PostgreSQL connection pool using porsager/postgres
// and wraps it with Drizzle ORM for type-safe queries.

// === DEPENDENCIES ===
// drizzle-orm, postgres (porsager/postgres driver)

// === LIMITATIONS ===
// - Connection string defaults to local Docker PostgreSQL.
// - No SSL configuration yet (not needed for local dev).
// - Pool size and timeouts are hardcoded for development.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Module-level state
let sql: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

const DEFAULT_CONNECTION_STRING =
  'postgresql://dashboard:localdev@localhost:5432/living_dashboard';

export function getConnectionString(): string {
  return process.env.DATABASE_URL || DEFAULT_CONNECTION_STRING;
}

export async function connectDatabase(): Promise<void> {
  const connectionString = getConnectionString();

  sql = postgres(connectionString, {
    max: 10, // Connection pool size
    idle_timeout: 20, // Close idle connections after 20s
    connect_timeout: 10, // 10s connection timeout
  });

  db = drizzle(sql, { schema });
}

export function getDb() {
  if (!db) {
    throw new Error('Database not connected. Call connectDatabase() first.');
  }
  return db;
}

export async function disconnectDatabase(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
    db = null;
  }
}

export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  message: string;
}> {
  try {
    if (!sql) return { connected: false, message: 'Not connected' };
    await sql`SELECT 1`;
    return { connected: true, message: 'Connected' };
  } catch (error) {
    return {
      connected: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
