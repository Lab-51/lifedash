// === FILE PURPOSE ===
// Zod schemas for the local-model catalog and the local-models IPC inputs.
// Kept out of schemas.ts (which mirrors DB/IPC entity types) and free of electron
// imports so the catalog file itself can be validated from a plain unit test.
//
// === DEPENDENCIES ===
// zod v3, ../types/localModels
//
// === VERIFICATION STATUS ===
// modelCatalogSchema is exercised against the real bundled catalog/models.json by
// modelCatalogService.test.ts — a malformed catalog fails the suite, not the user.

import { z } from 'zod';
import type { ModelCatalog } from '../types/localModels';

/**
 * Lowercase 64-hex sha256, or '' for a user-supplied file whose hash nobody has
 * published. Empty means "compute and report, don't enforce"; the bundled catalog
 * is separately asserted to have a real hash for every file.
 */
export const sha256Schema = z
  .string()
  .regex(/^(?:[0-9a-f]{64})?$/, 'sha256 must be 64 lowercase hex characters (or empty when unknown)');

export const modelRoleSchema = z.enum(['chat', 'embedding']);

export const catalogModelFileSchema = z.object({
  quant: z.string().min(1),
  url: z.string().url(),
  sha256: sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
});

export const catalogModelSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  vendor: z.string().min(1),
  originCountry: z.string().min(2),
  license: z.string().min(1),
  role: modelRoleSchema,
  parameters: z.string().min(1),
  files: z.array(catalogModelFileSchema).min(1),
  minRamGB: z.number().int().nonnegative(),
  languages: z.array(z.string().min(1)).min(1),
  toolCalling: z.boolean(),
  // 0 = unknown (custom GGUFs registered by the user).
  contextLength: z.number().int().nonnegative(),
  minRuntimeTag: z.string().min(1).optional(),
  notes: z.string().optional(),
});

export const modelCatalogSchema = z.object({
  catalogVersion: z.number().int().positive(),
  updatedAt: z.string().min(1),
  models: z.array(catalogModelSchema),
});

/** Compile-time proof the schema still matches the frozen ModelCatalog contract. */
export type ParsedModelCatalog = z.infer<typeof modelCatalogSchema>;
const _contractCheck: (c: ParsedModelCatalog) => ModelCatalog = (c) => c;
void _contractCheck;

// --- IPC input schemas --------------------------------------------------------

export const downloadModelInputSchema = z.object({
  modelId: z.string().min(1),
  /** Omitted = the model's first (default) offered quant. */
  quant: z.string().min(1).optional(),
});

export const downloadKeySchema = z.string().min(1);

/** A .gguf filename inside the models dir. Segment separators are rejected outright. */
export const modelFileNameSchema = z
  .string()
  .min(1)
  .regex(/^[^/\\]+\.gguf$/i, 'must be a .gguf filename with no path separators');

export const registerCustomModelInputSchema = z
  .object({
    displayName: z.string().min(1).max(120),
    /** Absolute path to an existing local .gguf. */
    filePath: z.string().min(1).optional(),
    /** Direct download URL for a .gguf — fetched through modelDownloadService. */
    url: z.string().url().optional(),
    // Required rather than defaulted: a defaulted field makes zod's input and output
    // types diverge, which validateInput's `z.ZodType<T>` signature cannot express.
    role: modelRoleSchema,
  })
  .refine((v) => !!v.filePath !== !!v.url, {
    message: 'provide exactly one of filePath or url',
  });
