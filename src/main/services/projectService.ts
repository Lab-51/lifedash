// === FILE PURPOSE ===
// Leaf service for creating a project row — the single project-creation path
// (LIVE.3 Task 5). Extracted from the projects:create IPC handler so non-IPC
// callers can create a project: the Live Assistant's createProject tool and the
// 'project' live-suggestion accept branch both delegate here. The DB handle is
// passed in and it imports only drizzle + db/schema (getDb is referenced for its
// TYPE only), so nothing imports it back into a cycle — the same cycle-proof leaf
// pattern as inboxColumnService / autoPushService (CODE-Q.1 removed 4 cycles).

// === DEPENDENCIES ===
// drizzle-orm (sql), db/schema (projects), db/connection (getDb — type only).

import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { projects } from '../db/schema';

type DB = ReturnType<typeof getDb>;

/** Fields accepted when creating a project — mirrors createProjectInputSchema. */
export interface CreateProjectRecordInput {
  name: string;
  description?: string | null;
  color?: string | null;
  hourlyRate?: number | null;
}

/**
 * Insert a new project at the end of the sort order and return the created row.
 * sortOrder = coalesce(max(sort_order), -1) + 1 so new projects always land last.
 * The ONE place a project row is created — the projects:create IPC handler, the
 * Live Assistant createProject tool, and the 'project' live-suggestion accept all
 * call this so sort-order and null-defaults stay identical across every path.
 */
export async function createProjectRecord(
  db: DB,
  input: CreateProjectRecordInput,
): Promise<typeof projects.$inferSelect> {
  const [{ maxOrder }] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${projects.sortOrder}), -1)` })
    .from(projects);

  const [project] = await db
    .insert(projects)
    .values({
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? null,
      hourlyRate: input.hourlyRate ?? null,
      sortOrder: maxOrder + 1,
    })
    .returning();

  return project;
}
