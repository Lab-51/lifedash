// === FILE PURPOSE ===
// IPC handlers for projects, boards, and columns CRUD operations.
// Groups related entities that form the board structure.

// === DEPENDENCIES ===
// drizzle-orm (eq, asc operators), electron (ipcMain)

// === LIMITATIONS ===
// - No pagination on list queries yet.
// - Column reorder does sequential updates (not batched).

import { ipcMain } from 'electron';
import { eq, asc, desc } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { projects, boards, columns, cards } from '../db/schema';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  createProjectInputSchema,
  updateProjectInputSchema,
  createBoardInputSchema,
  updateBoardInputSchema,
  createColumnInputSchema,
  updateColumnInputSchema,
  idParamSchema,
  columnReorderSchema,
} from '../../shared/validation/schemas';

export function registerProjectHandlers(): void {
  // --- Projects ---

  ipcMain.handle('projects:list', async () => {
    const db = getDb();
    return db.select().from(projects).orderBy(desc(projects.pinned), asc(projects.createdAt));
  });

  ipcMain.handle(
    'projects:create',
    async (_event, data: unknown) => {
      const input = validateInput(createProjectInputSchema, data);
      const db = getDb();
      const [project] = await db
        .insert(projects)
        .values({
          name: input.name,
          description: input.description ?? null,
          color: input.color ?? null,
        })
        .returning();
      return project;
    },
  );

  ipcMain.handle(
    'projects:update',
    async (_event, id: unknown, data: unknown) => {
      const validId = validateInput(idParamSchema, id);
      const input = validateInput(updateProjectInputSchema, data);
      const db = getDb();
      const [project] = await db
        .update(projects)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(projects.id, validId))
        .returning();
      return project;
    },
  );

  ipcMain.handle('projects:delete', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const db = getDb();
    await db.delete(projects).where(eq(projects.id, validId));
  });

  ipcMain.handle('projects:duplicate', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const db = getDb();

    // Fetch source project
    const [source] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, validId));
    if (!source) throw new Error('Project not found');

    // Create new project with copied metadata
    const [newProject] = await db
      .insert(projects)
      .values({
        name: `${source.name} (copy)`,
        description: source.description,
        color: source.color,
      })
      .returning();

    // Fetch all boards for the source project
    const sourceBoards = await db
      .select()
      .from(boards)
      .where(eq(boards.projectId, validId))
      .orderBy(asc(boards.position));

    // Duplicate each board and its columns
    for (const srcBoard of sourceBoards) {
      const [newBoard] = await db
        .insert(boards)
        .values({
          projectId: newProject.id,
          name: srcBoard.name,
          position: srcBoard.position,
        })
        .returning();

      const srcColumns = await db
        .select()
        .from(columns)
        .where(eq(columns.boardId, srcBoard.id))
        .orderBy(asc(columns.position));

      for (const srcCol of srcColumns) {
        const [newCol] = await db.insert(columns).values({
          boardId: newBoard.id,
          name: srcCol.name,
          position: srcCol.position,
        }).returning();

        // Duplicate cards in this column
        const srcCards = await db
          .select()
          .from(cards)
          .where(eq(cards.columnId, srcCol.id))
          .orderBy(asc(cards.position));

        for (const srcCard of srcCards) {
          await db.insert(cards).values({
            columnId: newCol.id,
            title: srcCard.title,
            description: srcCard.description,
            position: srcCard.position,
            priority: srcCard.priority,
            dueDate: srcCard.dueDate,
            archived: srcCard.archived,
          });
        }
      }
    }

    return newProject;
  });

  // --- Boards ---

  ipcMain.handle('boards:list', async (_event, projectId: unknown) => {
    const validProjectId = validateInput(idParamSchema, projectId);
    const db = getDb();
    return db
      .select()
      .from(boards)
      .where(eq(boards.projectId, validProjectId))
      .orderBy(asc(boards.position));
  });

  ipcMain.handle(
    'boards:create',
    async (_event, data: unknown) => {
      const input = validateInput(createBoardInputSchema, data);
      const db = getDb();
      // Get next position
      const existing = await db
        .select()
        .from(boards)
        .where(eq(boards.projectId, input.projectId));
      const [board] = await db
        .insert(boards)
        .values({
          projectId: input.projectId,
          name: input.name,
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
    async (_event, id: unknown, data: unknown) => {
      const validId = validateInput(idParamSchema, id);
      const input = validateInput(updateBoardInputSchema, data);
      const db = getDb();
      const [board] = await db
        .update(boards)
        .set(input)
        .where(eq(boards.id, validId))
        .returning();
      return board;
    },
  );

  ipcMain.handle('boards:delete', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const db = getDb();
    await db.delete(boards).where(eq(boards.id, validId));
  });

  // --- Columns ---

  ipcMain.handle('columns:list', async (_event, boardId: unknown) => {
    const validBoardId = validateInput(idParamSchema, boardId);
    const db = getDb();
    return db
      .select()
      .from(columns)
      .where(eq(columns.boardId, validBoardId))
      .orderBy(asc(columns.position));
  });

  ipcMain.handle(
    'columns:create',
    async (_event, data: unknown) => {
      const input = validateInput(createColumnInputSchema, data);
      const db = getDb();
      const existing = await db
        .select()
        .from(columns)
        .where(eq(columns.boardId, input.boardId));
      const [column] = await db
        .insert(columns)
        .values({
          boardId: input.boardId,
          name: input.name,
          position: existing.length,
        })
        .returning();
      return column;
    },
  );

  ipcMain.handle(
    'columns:update',
    async (_event, id: unknown, data: unknown) => {
      const validId = validateInput(idParamSchema, id);
      const input = validateInput(updateColumnInputSchema, data);
      const db = getDb();
      const [column] = await db
        .update(columns)
        .set(input)
        .where(eq(columns.id, validId))
        .returning();
      return column;
    },
  );

  ipcMain.handle('columns:delete', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const db = getDb();
    await db.delete(columns).where(eq(columns.id, validId));
  });

  ipcMain.handle(
    'columns:reorder',
    async (_event, boardId: unknown, columnIds: unknown) => {
      const validBoardId = validateInput(idParamSchema, boardId);
      const validColumnIds = validateInput(columnReorderSchema, columnIds);
      const db = getDb();
      // Update position for each column in the given order
      // boardId validated for consistency; used for future scope constraints
      void validBoardId;
      for (let i = 0; i < validColumnIds.length; i++) {
        await db
          .update(columns)
          .set({ position: i })
          .where(eq(columns.id, validColumnIds[i]));
      }
    },
  );
}
