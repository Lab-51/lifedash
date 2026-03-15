// === FILE PURPOSE ===
// Reusable IPC validation wrapper. Validates handler parameters using Zod schemas
// before executing the handler logic. Returns structured errors on validation failure.

// === DEPENDENCIES ===
// zod v3.25.76+

// === LIMITATIONS ===
// - Simple function approach (not middleware/decorator) — intentionally minimal.
// - Validation errors thrown as Error, propagated to renderer via Electron IPC.

import { z } from 'zod';

/** Validate IPC handler input against a Zod schema */
export function validateInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Validation failed: ${issues}`);
  }
  return result.data;
}
