// === FILE PURPOSE ===
// IPC handlers for AI provider management and usage tracking.
// Handles provider CRUD with encrypted API key storage,
// connection testing, and usage history queries.

// === DEPENDENCIES ===
// drizzle-orm (eq, desc operators), electron (ipcMain)
// ../services/secure-storage (encryptString, isEncryptionAvailable)
// ../services/ai-provider (testConnection, clearProviderCache)

// === LIMITATIONS ===
// - API keys never leave the main process — renderer only sees hasApiKey boolean
// - Usage summary loads all rows into memory (fine for typical volumes)
// - No pagination on usage list (capped at 100 rows newest-first)

import { ipcMain } from 'electron';
import { eq, desc, sql, gte } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { aiProviders, aiUsage } from '../db/schema';
import {
  encryptString,
  isEncryptionAvailable,
} from '../services/secure-storage';
import { testConnection, clearProviderCache } from '../services/ai-provider';
import type { AIProviderName } from '../../shared/types';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  idParamSchema,
  createAIProviderInputSchema,
  updateAIProviderInputSchema,
} from '../../shared/validation/schemas';

/** Convert a DB row to a renderer-safe AIProvider (no raw API key). */
function toAIProvider(row: typeof aiProviders.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    enabled: row.enabled,
    hasApiKey: !!row.apiKeyEncrypted,
    baseUrl: row.baseUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function registerAIProviderHandlers(): void {
  // --- Provider CRUD ---

  // List all configured providers
  ipcMain.handle('ai:list-providers', async () => {
    const db = getDb();
    const rows = await db.select().from(aiProviders);
    return rows.map(toAIProvider);
  });

  // Create a new provider (encrypts API key if provided)
  ipcMain.handle(
    'ai:create-provider',
    async (_event, data: unknown) => {
      const input = validateInput(createAIProviderInputSchema, data);
      const db = getDb();
      const values: {
        name: string;
        displayName: string | null;
        baseUrl: string | null;
        apiKeyEncrypted?: string;
      } = {
        name: input.name,
        displayName: input.displayName ?? null,
        baseUrl: input.baseUrl ?? null,
      };
      if (input.apiKey) {
        values.apiKeyEncrypted = encryptString(input.apiKey);
      }
      const [row] = await db
        .insert(aiProviders)
        .values(values)
        .returning();
      return toAIProvider(row);
    },
  );

  // Update a provider (re-encrypts API key if changed)
  ipcMain.handle(
    'ai:update-provider',
    async (_event, id: unknown, data: unknown) => {
      const validId = validateInput(idParamSchema, id);
      const input = validateInput(updateAIProviderInputSchema, data);
      const db = getDb();
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.displayName !== undefined) updates.displayName = input.displayName;
      if (input.baseUrl !== undefined) updates.baseUrl = input.baseUrl;
      if (input.enabled !== undefined) updates.enabled = input.enabled;
      if (input.apiKey !== undefined) {
        updates.apiKeyEncrypted = input.apiKey
          ? encryptString(input.apiKey)
          : null;
      }
      const [row] = await db
        .update(aiProviders)
        .set(updates)
        .where(eq(aiProviders.id, validId))
        .returning();
      clearProviderCache(validId);
      return toAIProvider(row);
    },
  );

  // Delete a provider
  ipcMain.handle('ai:delete-provider', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const db = getDb();
    await db.delete(aiProviders).where(eq(aiProviders.id, validId));
    clearProviderCache(validId);
  });

  // --- Connection Testing ---

  // Test provider connection (generates a minimal completion)
  ipcMain.handle('ai:test-connection', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const db = getDb();
    const [row] = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, validId));
    if (!row) throw new Error('Provider not found');
    return testConnection(
      row.name as AIProviderName,
      row.apiKeyEncrypted,
      row.baseUrl,
    );
  });

  // Check if OS-level encryption is available
  ipcMain.handle('ai:encryption-available', async () => {
    return isEncryptionAvailable();
  });

  // --- Usage Tracking ---

  // Get recent usage entries (newest first, max 100)
  ipcMain.handle('ai:get-usage', async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(aiUsage)
      .orderBy(desc(aiUsage.createdAt))
      .limit(100);
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
  });

  // Get aggregated usage summary across all providers and task types
  ipcMain.handle('ai:get-usage-summary', async () => {
    const db = getDb();
    const [rows, providers] = await Promise.all([
      db.select().from(aiUsage),
      db.select({ id: aiProviders.id, name: aiProviders.name, displayName: aiProviders.displayName }).from(aiProviders),
    ]);
    const providerNameMap = new Map(providers.map(p => [p.id, p.displayName || p.name]));
    const summary = {
      totalTokens: 0,
      totalCost: 0,
      byProvider: {} as Record<string, { tokens: number; cost: number }>,
      byTaskType: {} as Record<string, { tokens: number; cost: number }>,
      byModel: {} as Record<string, { tokens: number; cost: number }>,
    };
    for (const row of rows) {
      summary.totalTokens += row.totalTokens;
      summary.totalCost += row.estimatedCost ?? 0;

      const providerLabel = row.providerId ? (providerNameMap.get(row.providerId) ?? row.providerId) : 'Unknown';
      if (!summary.byProvider[providerLabel]) {
        summary.byProvider[providerLabel] = { tokens: 0, cost: 0 };
      }
      summary.byProvider[providerLabel].tokens += row.totalTokens;
      summary.byProvider[providerLabel].cost += row.estimatedCost ?? 0;

      if (!summary.byTaskType[row.taskType]) {
        summary.byTaskType[row.taskType] = { tokens: 0, cost: 0 };
      }
      summary.byTaskType[row.taskType].tokens += row.totalTokens;
      summary.byTaskType[row.taskType].cost += row.estimatedCost ?? 0;

      const model = row.model || 'Unknown';
      if (!summary.byModel[model]) {
        summary.byModel[model] = { tokens: 0, cost: 0 };
      }
      summary.byModel[model].tokens += row.totalTokens;
      summary.byModel[model].cost += row.estimatedCost ?? 0;
    }
    return summary;
  });

  // Get daily usage aggregates for last 30 days (for usage dashboard chart)
  ipcMain.handle('ai:get-usage-daily', async () => {
    const db = getDb();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const dateKey = sql<string>`to_char(${aiUsage.createdAt}, 'YYYY-MM-DD')`;
    const rows = await db
      .select({
        date: dateKey,
        tokens: sql<number>`COALESCE(SUM(${aiUsage.totalTokens}), 0)`,
        cost: sql<number>`COALESCE(SUM(${aiUsage.estimatedCost}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, thirtyDaysAgo))
      .groupBy(dateKey)
      .orderBy(dateKey);

    // Build a map from the query results
    const dataMap = new Map<string, { tokens: number; cost: number; count: number }>();
    for (const row of rows) {
      dataMap.set(row.date, {
        tokens: Number(row.tokens),
        cost: Number(row.cost),
        count: Number(row.count),
      });
    }

    // Fill in missing days for a continuous 30-day series
    const result: Array<{ date: string; tokens: number; cost: number; count: number }> = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const entry = dataMap.get(key);
      result.push({
        date: key,
        tokens: entry?.tokens ?? 0,
        cost: entry?.cost ?? 0,
        count: entry?.count ?? 0,
      });
    }
    return result;
  });
}
