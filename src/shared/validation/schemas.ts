// === FILE PURPOSE ===
// Zod validation schemas for IPC input types.
// Each schema mirrors a TypeScript interface from shared/types.ts.
// Used by the IPC validation wrapper to validate incoming data at runtime.

// === DEPENDENCIES ===
// zod v3.25.76+

// === VERIFICATION STATUS ===
// Schemas verified against types.ts interfaces (CreateProjectInput, UpdateProjectInput,
// CreateBoardInput, UpdateBoardInput, CreateColumnInput, UpdateColumnInput).

import { z } from 'zod';

// --- ID validation (reusable) ---
const uuid = z.string().uuid();

// --- Projects ---
export const createProjectInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  color: z.string().max(50).optional(),
});

export const updateProjectInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().max(50).nullable().optional(),
  archived: z.boolean().optional(),
});

// --- Boards ---
export const createBoardInputSchema = z.object({
  projectId: uuid,
  name: z.string().min(1).max(200),
});

export const updateBoardInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  position: z.number().int().min(0).optional(),
});

// --- Columns ---
// NOTE: CreateColumnInput does NOT have a position field — the handler auto-calculates it.
export const createColumnInputSchema = z.object({
  boardId: uuid,
  name: z.string().min(1).max(200),
});

export const updateColumnInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  position: z.number().int().min(0).optional(),
});

// --- Common ---
export const idParamSchema = uuid;

// --- Column reorder ---
export const columnReorderSchema = z.array(z.string().uuid());
