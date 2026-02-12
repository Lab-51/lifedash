// === FILE PURPOSE ===
// IPC handlers for projects, boards, and columns CRUD operations.
// Groups related entities that form the board structure.

// === DEPENDENCIES ===
// drizzle-orm (eq, asc operators), electron (ipcMain)

// === LIMITATIONS ===
// - No pagination on list queries yet.
// - Column reorder does sequential updates (not batched).

import { ipcMain } from 'electron';
import { eq, asc } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { projects, boards, columns } from '../db/schema';
import type {
  CreateProjectInput,
  UpdateProjectInput,
  CreateBoardInput,
  UpdateBoardInput,
  CreateColumnInput,
  UpdateColumnInput,
} from '../../shared/types';

export function registerProjectHandlers(): void {
  // --- Projects ---

  ipcMain.handle('projects:list', async () => {
    const db = getDb();
    return db.select().from(projects).orderBy(asc(projects.createdAt));
  });

  ipcMain.handle(
    'projects:create',
    async (_event, data: CreateProjectInput) => {
      const db = getDb();
      const [project] = await db
        .insert(projects)
        .values({
          name: data.name,
          description: data.description ?? null,
          color: data.color ?? null,
        })
        .returning();
      return project;
    },
  );

  ipcMain.handle(
    'projects:update',
    async (_event, id: string, data: UpdateProjectInput) => {
      const db = getDb();
      const [project] = await db
        .update(projects)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning();
      return project;
    },
  );

  ipcMain.handle('projects:delete', async (_event, id: string) => {
    const db = getDb();
    await db.delete(projects).where(eq(projects.id, id));
  });

  // --- Boards ---

  ipcMain.handle('boards:list', async (_event, projectId: string) => {
    const db = getDb();
    return db
      .select()
      .from(boards)
      .where(eq(boards.projectId, projectId))
      .orderBy(asc(boards.position));
  });

  ipcMain.handle(
    'boards:create',
    async (_event, data: CreateBoardInput) => {
      const db = getDb();
      // Get next position
      const existing = await db
        .select()
        .from(boards)
        .where(eq(boards.projectId, data.projectId));
      const [board] = await db
        .insert(boards)
        .values({
          projectId: data.projectId,
          name: data.name,
          position: existing.length,
        })
        .returning();

      // Auto-create default columns for new boards
      const defaultColumns = ['To Do', 'In Progress', 'Done'];
      for (let i = 0; i < defaultColumns.length; i++) {
        await db.insert(columns).values({
          boardId: board.id,
          name: defaultColumns[i],
          position: i,
        });
      }

      return board;
    },
  );

  ipcMain.handle(
    'boards:update',
    async (_event, id: string, data: UpdateBoardInput) => {
      const db = getDb();
      const [board] = await db
        .update(boards)
        .set(data)
        .where(eq(boards.id, id))
        .returning();
      return board;
    },
  );

  ipcMain.handle('boards:delete', async (_event, id: string) => {
    const db = getDb();
    await db.delete(boards).where(eq(boards.id, id));
  });

  // --- Columns ---

  ipcMain.handle('columns:list', async (_event, boardId: string) => {
    const db = getDb();
    return db
      .select()
      .from(columns)
      .where(eq(columns.boardId, boardId))
      .orderBy(asc(columns.position));
  });

  ipcMain.handle(
    'columns:create',
    async (_event, data: CreateColumnInput) => {
      const db = getDb();
      const existing = await db
        .select()
        .from(columns)
        .where(eq(columns.boardId, data.boardId));
      const [column] = await db
        .insert(columns)
        .values({
          boardId: data.boardId,
          name: data.name,
          position: existing.length,
        })
        .returning();
      return column;
    },
  );

  ipcMain.handle(
    'columns:update',
    async (_event, id: string, data: UpdateColumnInput) => {
      const db = getDb();
      const [column] = await db
        .update(columns)
        .set(data)
        .where(eq(columns.id, id))
        .returning();
      return column;
    },
  );

  ipcMain.handle('columns:delete', async (_event, id: string) => {
    const db = getDb();
    await db.delete(columns).where(eq(columns.id, id));
  });

  ipcMain.handle(
    'columns:reorder',
    async (_event, boardId: string, columnIds: string[]) => {
      const db = getDb();
      // Update position for each column in the given order
      for (let i = 0; i < columnIds.length; i++) {
        await db
          .update(columns)
          .set({ position: i })
          .where(eq(columns.id, columnIds[i]));
      }
    },
  );
}
