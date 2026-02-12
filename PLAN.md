# Phase 3 — Plan 1 of 3: AI Provider Backend & Settings Foundation

## Coverage
- **R7: AI Provider System** (backend portion — schema, services, IPC)
- **R9: Settings & Configuration** (backend portion — settings schema, IPC)

## Plan Overview
Phase 3 delivers the AI Provider System (R7) and Settings & Configuration (R9). It requires 3 plans:

- **Plan 3.1** (this plan): Backend foundation — deps, DB schema, services, IPC handlers.
- **Plan 3.2** (next): Settings UI — store, settings page, provider management, model config.
- **Plan 3.3** (next): Theme toggle, token usage display, and general app settings.

## Scope Notes

Some R9 deliverables are deferred to later phases where they naturally belong:
- **Whisper model selection/download** → Phase 4 (depends on whisper-node installation)
- **Audio device/source preferences** → Phase 4 (depends on audio capture setup)
- **Data export/import** → Phase 7 / R15 (v2 feature)

## Design Decisions for This Plan

1. **Settings table** — generic key-value store (varchar key PK, text value).
   Used for theme preference, task model assignments (as JSON), and misc app config.
   Simple and extensible without schema changes for each new setting.

2. **ai_providers table** — dedicated table for configured AI providers.
   Each row = one provider instance (e.g., OpenAI, Anthropic, Ollama).
   API keys stored encrypted via Electron safeStorage (base64 of encrypted buffer).
   Provider name is an enum-like varchar: 'openai' | 'anthropic' | 'ollama'.

3. **ai_usage table** — append-only log of AI API calls.
   Tracks tokens (prompt, completion, total) and estimated cost per call.
   No foreign key to ai_providers — keeps history even if provider is deleted.

4. **Secure storage** — Electron safeStorage API encrypts API keys at rest.
   Keys are encrypted to Buffer, then stored as base64 strings in PostgreSQL.
   Never send decrypted keys to the renderer process — only `hasApiKey: boolean`.

5. **AI provider service** — thin wrapper around Vercel AI SDK providers.
   Creates provider instances via createOpenAI/createAnthropic/createOllama.
   Caches instances by provider DB id. Provides testConnection and generate methods.
   Token usage logged automatically after each generation.

6. **Task model assignments** — stored as JSON in the settings table
   (key: `ai.taskModels`, value: JSON of TaskModelConfig per task type).
   No separate table needed for v1 — simpler, fewer joins.

7. **Ollama provider** — using `ollama-ai-provider` package (listed on Vercel AI SDK
   community providers page). UNCERTAINTY: Multiple community packages exist
   (`ollama-ai-provider`, `ai-sdk-ollama`). Executor should verify at install time.

---

<phase n="3.1" name="AI Provider Backend & Settings Foundation">
  <context>
    Phase 2 is complete. The app has:
    - Electron 40 with frameless window, system tray, IPC bridge
    - PostgreSQL 16 via Docker Compose, Drizzle ORM with migrations
    - React 19 + TypeScript + Tailwind CSS 4 renderer
    - Zustand stores (projectStore, boardStore), Kanban board with drag-and-drop
    - Sidebar navigation, lazy-loaded routes, settings page placeholder

    Established patterns to follow:
    - Schema: pgTable with UUID PKs, timestamps with timezone, in src/main/db/schema/
    - IPC: registerXHandlers function per file, ipcMain.handle(), called from index.ts
    - Preload: thin bridge methods via contextBridge, ipcRenderer.invoke()
    - Types: shared types in src/shared/types.ts with ElectronAPI interface
    - File naming: kebab-case for main process files, PascalCase for components
    - Data params in preload use `any`, type safety via ElectronAPI interface

    Verified AI SDK info (Feb 2026):
    - Core: `ai` package v6.x, exports generateText, streamText
    - OpenAI: `@ai-sdk/openai` — import { createOpenAI } from '@ai-sdk/openai'
    - Anthropic: `@ai-sdk/anthropic` — import { createAnthropic } from '@ai-sdk/anthropic'
    - Ollama: `ollama-ai-provider` — import { createOllama } from 'ollama-ai-provider'
    - Pattern: createXXX({ apiKey }) returns factory fn, factory('model-name') returns LanguageModel
    - Token usage: result.usage.promptTokens, .completionTokens, .totalTokens
    - Electron safeStorage: encryptString(str) → Buffer, decryptString(buf) → string
      Available after app ready event. Uses DPAPI on Windows, Keychain on macOS.

    @src/main/db/schema/index.ts
    @src/main/db/schema/projects.ts (pattern reference)
    @src/main/db/connection.ts
    @src/main/ipc/index.ts
    @src/main/ipc/projects.ts (pattern reference)
    @src/preload/preload.ts
    @src/shared/types.ts
  </context>

  <task type="auto" n="1">
    <n>Install AI SDK dependencies and create database schema</n>
    <files>
      package.json (modify — add AI SDK deps via npm install)
      src/main/db/schema/settings.ts (create — settings key-value table)
      src/main/db/schema/ai-providers.ts (create — ai_providers + ai_usage tables)
      src/main/db/schema/index.ts (modify — export new tables)
    </files>
    <action>
      Install the Vercel AI SDK and provider packages, then create database tables
      for settings, AI providers, and usage tracking.

      WHY: The AI provider system needs persistent storage for provider configs
      (API keys, enabled state), app settings (theme, task model assignments),
      and usage logs (token counts, costs). All deps installed upfront so
      subsequent tasks can import immediately.

      Steps:

      1. Install dependencies:
         ```
         npm install ai @ai-sdk/openai @ai-sdk/anthropic ollama-ai-provider
         ```

         If `ollama-ai-provider` fails to install, try `ai-sdk-ollama` instead.
         These are regular dependencies (not dev) — they run in Electron main process.

      2. Create src/main/db/schema/settings.ts:

         A generic key-value settings table for app configuration.

         ```typescript
         // === FILE PURPOSE ===
         // Schema for the settings table — generic key-value store for app configuration.
         // Used for theme preference, task model assignments (JSON), and other settings.

         import { pgTable, varchar, text, timestamp } from 'drizzle-orm/pg-core';

         export const settings = pgTable('settings', {
           key: varchar('key', { length: 255 }).primaryKey(),
           value: text('value').notNull(),
           updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
         });
         ```

         Using varchar PK (not UUID) because settings are looked up by key name.
         Value is text type to support JSON strings for complex settings.

      3. Create src/main/db/schema/ai-providers.ts:

         Two tables: ai_providers (provider configurations) and ai_usage (token tracking).

         ```typescript
         // === FILE PURPOSE ===
         // Schema for AI provider configuration and usage tracking tables.
         // ai_providers stores configured LLM providers with encrypted API keys.
         // ai_usage is an append-only log of AI API calls for cost tracking.

         import {
           pgTable, uuid, varchar, text, boolean, integer, real, timestamp,
         } from 'drizzle-orm/pg-core';

         export const aiProviders = pgTable('ai_providers', {
           id: uuid('id').defaultRandom().primaryKey(),
           name: varchar('name', { length: 100 }).notNull(),       // 'openai' | 'anthropic' | 'ollama'
           displayName: varchar('display_name', { length: 255 }),   // User-facing name
           enabled: boolean('enabled').default(true).notNull(),
           apiKeyEncrypted: text('api_key_encrypted'),              // base64(safeStorage.encryptString())
           baseUrl: varchar('base_url', { length: 500 }),           // For Ollama or custom endpoints
           createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
           updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
         });

         export const aiUsage = pgTable('ai_usage', {
           id: uuid('id').defaultRandom().primaryKey(),
           providerId: uuid('provider_id'),                         // Nullable — keeps history if provider deleted
           model: varchar('model', { length: 255 }).notNull(),
           taskType: varchar('task_type', { length: 100 }).notNull(),
           promptTokens: integer('prompt_tokens').notNull(),
           completionTokens: integer('completion_tokens').notNull(),
           totalTokens: integer('total_tokens').notNull(),
           estimatedCost: real('estimated_cost'),                   // USD cents
           createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
         });
         ```

         Schema notes:
         - name: enforced in app logic as AIProviderName union, not DB constraint
         - apiKeyEncrypted: null for Ollama (no API key needed)
         - baseUrl: primarily for Ollama (http://localhost:11434), also custom endpoints
         - No FK from ai_usage.providerId to ai_providers.id — preserves history on delete
         - estimatedCost uses real (4-byte float), sufficient precision for cents

      4. Update src/main/db/schema/index.ts — add at end:
         ```typescript
         export * from './settings';
         export * from './ai-providers';
         ```

      5. Generate and apply migration:
         ```
         npm run db:generate
         npm run db:migrate
         ```
         Requires Docker PostgreSQL running (`npm run db:up` if not already).
    </action>
    <verify>
      1. Check node_modules/ai, node_modules/@ai-sdk/openai, node_modules/@ai-sdk/anthropic,
         node_modules/ollama-ai-provider exist
      2. Run `npx tsc --noEmit` — no TypeScript errors
      3. Run `npm run db:generate` — migration file created in drizzle/ directory
      4. Run `npm run db:migrate` — migration applied successfully
      5. Inspect generated SQL: should contain CREATE TABLE settings, ai_providers, ai_usage
    </verify>
    <done>
      AI SDK packages (ai, @ai-sdk/openai, @ai-sdk/anthropic, ollama-ai-provider) installed.
      Three new DB tables (settings, ai_providers, ai_usage) created via Drizzle schema.
      Migration generated and applied to PostgreSQL.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - ollama-ai-provider installs without errors on npm
      - Drizzle pg-core exports `real` and `integer` types
      - Docker PostgreSQL container is running for migration
      - drizzle-kit generate detects new schema files via barrel export in index.ts
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Create shared types and main process services</n>
    <files>
      src/shared/types.ts (modify — add AI provider, settings, and usage types + ElectronAPI extensions)
      src/main/services/secure-storage.ts (create — Electron safeStorage wrapper)
      src/main/services/ai-provider.ts (create — AI SDK provider manager with caching and usage logging)
    </files>
    <preconditions>
      - Task 1 completed (AI SDK packages installed, DB schema created)
    </preconditions>
    <action>
      Create the service layer for AI providers and secure storage, plus shared types
      for cross-process communication.

      WHY: The main process needs services to manage AI provider instances (create,
      cache, test, generate) and securely handle API keys. These services are consumed
      by IPC handlers (Task 3). Types are shared so renderer gets full type safety.

      Steps:

      1. Add AI/settings types to src/shared/types.ts (after existing label types):

         ```typescript
         // === AI PROVIDER TYPES ===

         export type AIProviderName = 'openai' | 'anthropic' | 'ollama';
         export type AITaskType = 'summarization' | 'brainstorming' | 'task_generation' | 'idea_analysis';

         /** AI provider as seen by renderer (no decrypted keys — only hasApiKey boolean) */
         export interface AIProvider {
           id: string;
           name: AIProviderName;
           displayName: string | null;
           enabled: boolean;
           hasApiKey: boolean;
           baseUrl: string | null;
           createdAt: string;
           updatedAt: string;
         }

         export interface CreateAIProviderInput {
           name: AIProviderName;
           displayName?: string;
           apiKey?: string;       // Plain text — encrypted before storage in main process
           baseUrl?: string;
         }

         export interface UpdateAIProviderInput {
           displayName?: string;
           apiKey?: string;       // Plain text — encrypted before storage
           baseUrl?: string;
           enabled?: boolean;
         }

         export interface AIConnectionTestResult {
           success: boolean;
           error?: string;
           latencyMs?: number;
         }

         export interface AIUsageEntry {
           id: string;
           providerId: string | null;
           model: string;
           taskType: string;
           promptTokens: number;
           completionTokens: number;
           totalTokens: number;
           estimatedCost: number | null;
           createdAt: string;
         }

         export interface AIUsageSummary {
           totalTokens: number;
           totalCost: number;
           byProvider: Record<string, { tokens: number; cost: number }>;
           byTaskType: Record<string, { tokens: number; cost: number }>;
         }

         /** Per-task model configuration (stored as JSON in settings table) */
         export interface TaskModelConfig {
           providerId: string;
           model: string;
           temperature?: number;
           maxTokens?: number;
         }
         ```

         Extend ElectronAPI interface — add after existing Labels methods:

         ```typescript
         // Settings
         getSetting: (key: string) => Promise<string | null>;
         setSetting: (key: string, value: string) => Promise<void>;
         getAllSettings: () => Promise<Record<string, string>>;
         deleteSetting: (key: string) => Promise<void>;

         // AI Providers
         getAIProviders: () => Promise<AIProvider[]>;
         createAIProvider: (data: CreateAIProviderInput) => Promise<AIProvider>;
         updateAIProvider: (id: string, data: UpdateAIProviderInput) => Promise<AIProvider>;
         deleteAIProvider: (id: string) => Promise<void>;
         testAIConnection: (id: string) => Promise<AIConnectionTestResult>;
         isEncryptionAvailable: () => Promise<boolean>;

         // AI Usage
         getAIUsage: () => Promise<AIUsageEntry[]>;
         getAIUsageSummary: () => Promise<AIUsageSummary>;
         ```

      2. Create src/main/services/secure-storage.ts:

         Thin wrapper around Electron's safeStorage API. Converts encrypted Buffers
         to/from base64 strings for database storage.

         ```typescript
         // === FILE PURPOSE ===
         // Wraps Electron safeStorage API for secure API key encryption/decryption.
         // Encrypts strings to base64 for DB storage, decrypts on demand.
         // Uses OS-level encryption: DPAPI (Windows), Keychain (macOS), libsecret (Linux).
         //
         // === LIMITATIONS ===
         // - Only usable in main process (not preload or renderer)
         // - Must be called after app 'ready' event
         // - On Windows, protects from other users but not other apps on same account

         import { safeStorage } from 'electron';

         export function isEncryptionAvailable(): boolean {
           return safeStorage.isEncryptionAvailable();
         }

         export function encryptString(plaintext: string): string {
           if (!safeStorage.isEncryptionAvailable()) {
             throw new Error('Encryption is not available on this system');
           }
           const encrypted = safeStorage.encryptString(plaintext);
           return encrypted.toString('base64');
         }

         export function decryptString(encryptedBase64: string): string {
           if (!safeStorage.isEncryptionAvailable()) {
             throw new Error('Encryption is not available on this system');
           }
           const buffer = Buffer.from(encryptedBase64, 'base64');
           return safeStorage.decryptString(buffer);
         }
         ```

      3. Create src/main/services/ai-provider.ts:

         Manages AI SDK provider instances with caching, connection testing,
         and text generation with automatic usage logging.

         ```typescript
         // === FILE PURPOSE ===
         // AI provider manager — creates/caches provider instances, tests connections,
         // and wraps generateText with automatic usage logging to ai_usage table.
         //
         // === DEPENDENCIES ===
         // ai (generateText), @ai-sdk/openai, @ai-sdk/anthropic, ollama-ai-provider
         //
         // === VERIFICATION STATUS ===
         // - createOpenAI/createAnthropic API: verified from AI SDK docs
         // - createOllama API: UNVERIFIED — ollama-ai-provider import may differ
         // - Token usage availability: verified (result.usage.promptTokens etc.)

         import { generateText } from 'ai';
         import { createOpenAI } from '@ai-sdk/openai';
         import { createAnthropic } from '@ai-sdk/anthropic';
         // TODO: Verify this import at runtime — package API may differ
         import { createOllama } from 'ollama-ai-provider';
         import { getDb } from '../db/connection';
         import { aiUsage } from '../db/schema';
         import { decryptString } from './secure-storage';
         import type { AIProviderName } from '../../shared/types';

         // Default models for connection testing (cheapest per provider)
         const TEST_MODELS: Record<AIProviderName, string> = {
           openai: 'gpt-4o-mini',
           anthropic: 'claude-haiku-4-5-20251001',
           ollama: 'llama3.2',
         };

         // Cache provider factories by DB id (invalidated on config change)
         const providerCache = new Map<string, any>();

         function createFactory(
           name: AIProviderName,
           apiKey?: string,
           baseUrl?: string,
         ): any {
           switch (name) {
             case 'openai':
               return createOpenAI({ apiKey: apiKey || '' });
             case 'anthropic':
               return createAnthropic({ apiKey: apiKey || '' });
             case 'ollama':
               return createOllama({ baseURL: baseUrl || 'http://localhost:11434/api' });
             default:
               throw new Error(`Unknown AI provider: ${name}`);
           }
         }

         /**
          * Get or create a cached provider factory for the given DB provider row.
          * Call clearProviderCache(id) when provider config changes.
          */
         export function getProvider(
           id: string,
           name: AIProviderName,
           apiKeyEncrypted: string | null,
           baseUrl: string | null,
         ) {
           if (providerCache.has(id)) return providerCache.get(id);
           const apiKey = apiKeyEncrypted ? decryptString(apiKeyEncrypted) : undefined;
           const factory = createFactory(name, apiKey, baseUrl ?? undefined);
           providerCache.set(id, factory);
           return factory;
         }

         /** Clear cached provider instance(s). Call when config changes. */
         export function clearProviderCache(id?: string): void {
           if (id) {
             providerCache.delete(id);
           } else {
             providerCache.clear();
           }
         }

         /**
          * Test provider connectivity by generating a minimal completion.
          * Uses the cheapest model per provider to minimize cost.
          */
         export async function testConnection(
           name: AIProviderName,
           apiKeyEncrypted: string | null,
           baseUrl: string | null,
         ): Promise<{ success: boolean; error?: string; latencyMs?: number }> {
           const start = Date.now();
           try {
             const apiKey = apiKeyEncrypted ? decryptString(apiKeyEncrypted) : undefined;
             const factory = createFactory(name, apiKey, baseUrl ?? undefined);
             const model = factory(TEST_MODELS[name]);

             await generateText({
               model,
               prompt: 'Say "ok".',
               maxTokens: 5,
             });

             return { success: true, latencyMs: Date.now() - start };
           } catch (error: any) {
             return {
               success: false,
               error: error.message || 'Connection failed',
               latencyMs: Date.now() - start,
             };
           }
         }

         /**
          * Generate text using a configured provider + model.
          * Automatically logs token usage to the ai_usage table.
          */
         export async function generate(options: {
           providerId: string;
           providerName: AIProviderName;
           apiKeyEncrypted: string | null;
           baseUrl: string | null;
           model: string;
           taskType: string;
           prompt: string;
           system?: string;
           temperature?: number;
           maxTokens?: number;
         }) {
           const factory = getProvider(
             options.providerId,
             options.providerName,
             options.apiKeyEncrypted,
             options.baseUrl,
           );

           const result = await generateText({
             model: factory(options.model),
             prompt: options.prompt,
             system: options.system,
             temperature: options.temperature,
             maxTokens: options.maxTokens,
           });

           // Log usage (fire-and-forget — don't fail generation if logging fails)
           try {
             const db = getDb();
             await db.insert(aiUsage).values({
               providerId: options.providerId,
               model: options.model,
               taskType: options.taskType,
               promptTokens: result.usage?.promptTokens ?? 0,
               completionTokens: result.usage?.completionTokens ?? 0,
               totalTokens: result.usage?.totalTokens ?? 0,
               // Cost estimation added in Plan 3.3 (requires pricing table)
             });
           } catch (logError) {
             console.error('[AI] Failed to log usage:', logError);
           }

           return {
             text: result.text,
             usage: result.usage,
           };
         }
         ```

         IMPORTANT notes for the executor:
         - The `any` type for providerCache values is intentional — different provider
           factories have different return types but all work as factory(modelName).
         - If `ollama-ai-provider` doesn't export `createOllama`, check the package
           README for the correct import. Alternative: `import { ollama } from 'ollama-ai-provider'`.
         - The generate function is not used by IPC handlers in this plan — it will be
           used starting in Phase 5 (meeting briefs) and Phase 6 (brainstorming).
           Plan 3.1 exposes it for future use; the connection test validates it works.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify src/shared/types.ts has: AIProviderName, AITaskType, AIProvider,
         CreateAIProviderInput, UpdateAIProviderInput, AIConnectionTestResult,
         AIUsageEntry, AIUsageSummary, TaskModelConfig types
      3. Verify ElectronAPI interface has 12 new methods (4 settings + 8 AI provider)
      4. Verify src/main/services/secure-storage.ts exports: isEncryptionAvailable,
         encryptString, decryptString
      5. Verify src/main/services/ai-provider.ts exports: getProvider, clearProviderCache,
         testConnection, generate
      6. Verify imports in ai-provider.ts: ai, @ai-sdk/openai, @ai-sdk/anthropic,
         ollama-ai-provider
    </verify>
    <done>
      Shared types defined for AI providers, settings, and usage tracking.
      ElectronAPI interface extended with 12 new methods.
      Secure storage service wraps Electron safeStorage for API key encryption.
      AI provider service manages provider instances with caching, connection testing,
      and text generation with automatic usage logging.
    </done>
    <confidence>MEDIUM</confidence>
    <assumptions>
      - ollama-ai-provider exports createOllama with { baseURL } config object
      - createOpenAI/createAnthropic return callable factory functions (factory(modelName) → LanguageModel)
      - safeStorage.encryptString/decryptString work correctly after Electron app ready event
      - generateText returns { text, usage: { promptTokens, completionTokens, totalTokens } }
      - result.usage is available for all three providers (OpenAI, Anthropic, Ollama)
      - Buffer.from(base64, 'base64') correctly reverses Buffer.toString('base64')
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Create IPC handlers and extend preload bridge</n>
    <files>
      src/main/ipc/settings.ts (create — 4 settings CRUD handlers)
      src/main/ipc/ai-providers.ts (create — 8 AI provider/usage handlers)
      src/main/ipc/index.ts (modify — register new handlers)
      src/preload/preload.ts (modify — add 12 new bridge methods)
    </files>
    <preconditions>
      - Task 1 completed (DB schema and migration applied)
      - Task 2 completed (shared types and services created)
    </preconditions>
    <action>
      Create IPC handlers for settings and AI provider management, then extend
      the preload bridge so the renderer can access these services.

      WHY: The renderer process cannot access the database or Electron safeStorage
      directly. IPC handlers in the main process handle all data operations,
      and the preload bridge provides a typed interface for the renderer.

      Steps:

      1. Create src/main/ipc/settings.ts:

         CRUD handlers for the generic key-value settings table.

         ```typescript
         // === FILE PURPOSE ===
         // IPC handlers for app settings (key-value store).
         // Supports get, set (upsert), get-all, and delete operations.

         import { ipcMain } from 'electron';
         import { eq } from 'drizzle-orm';
         import { getDb } from '../db/connection';
         import { settings } from '../db/schema';

         export function registerSettingsHandlers(): void {
           ipcMain.handle('settings:get', async (_event, key: string) => {
             const db = getDb();
             const rows = await db.select().from(settings).where(eq(settings.key, key));
             return rows.length > 0 ? rows[0].value : null;
           });

           ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
             const db = getDb();
             await db.insert(settings)
               .values({ key, value })
               .onConflictDoUpdate({
                 target: settings.key,
                 set: { value, updatedAt: new Date() },
               });
           });

           ipcMain.handle('settings:get-all', async () => {
             const db = getDb();
             const rows = await db.select().from(settings);
             return Object.fromEntries(rows.map(r => [r.key, r.value]));
           });

           ipcMain.handle('settings:delete', async (_event, key: string) => {
             const db = getDb();
             await db.delete(settings).where(eq(settings.key, key));
           });
         }
         ```

         Notes:
         - settings:set uses onConflictDoUpdate (upsert) since key is the PK
         - settings:get-all returns Record<string, string> for easy consumption
         - Follows existing handler pattern (ipcMain.handle, getDb, return data)

      2. Create src/main/ipc/ai-providers.ts:

         Handlers for AI provider CRUD, connection testing, encryption check,
         and usage queries.

         ```typescript
         // === FILE PURPOSE ===
         // IPC handlers for AI provider management and usage tracking.
         // Handles provider CRUD with encrypted API key storage,
         // connection testing, and usage history queries.

         import { ipcMain } from 'electron';
         import { eq, desc } from 'drizzle-orm';
         import { getDb } from '../db/connection';
         import { aiProviders, aiUsage } from '../db/schema';
         import {
           encryptString,
           isEncryptionAvailable,
         } from '../services/secure-storage';
         import { testConnection, clearProviderCache } from '../services/ai-provider';
         import type { AIProviderName } from '../../shared/types';

         /** Convert DB row to renderer-safe AIProvider (no raw API key) */
         function toAIProvider(row: any) {
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
           // List all configured providers
           ipcMain.handle('ai:list-providers', async () => {
             const db = getDb();
             const rows = await db.select().from(aiProviders);
             return rows.map(toAIProvider);
           });

           // Create a new provider (encrypts API key if provided)
           ipcMain.handle('ai:create-provider', async (_event, data: any) => {
             const db = getDb();
             const values: any = {
               name: data.name,
               displayName: data.displayName || null,
               baseUrl: data.baseUrl || null,
             };
             if (data.apiKey) {
               values.apiKeyEncrypted = encryptString(data.apiKey);
             }
             const [row] = await db.insert(aiProviders).values(values).returning();
             return toAIProvider(row);
           });

           // Update a provider (re-encrypts API key if changed)
           ipcMain.handle('ai:update-provider', async (_event, id: string, data: any) => {
             const db = getDb();
             const updates: any = { updatedAt: new Date() };
             if (data.displayName !== undefined) updates.displayName = data.displayName;
             if (data.baseUrl !== undefined) updates.baseUrl = data.baseUrl;
             if (data.enabled !== undefined) updates.enabled = data.enabled;
             if (data.apiKey !== undefined) {
               updates.apiKeyEncrypted = data.apiKey ? encryptString(data.apiKey) : null;
             }
             const [row] = await db.update(aiProviders)
               .set(updates)
               .where(eq(aiProviders.id, id))
               .returning();
             clearProviderCache(id);
             return toAIProvider(row);
           });

           // Delete a provider
           ipcMain.handle('ai:delete-provider', async (_event, id: string) => {
             const db = getDb();
             await db.delete(aiProviders).where(eq(aiProviders.id, id));
             clearProviderCache(id);
           });

           // Test provider connection (generates minimal completion)
           ipcMain.handle('ai:test-connection', async (_event, id: string) => {
             const db = getDb();
             const [row] = await db.select().from(aiProviders)
               .where(eq(aiProviders.id, id));
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

           // Get recent usage entries (newest first, limit 100)
           ipcMain.handle('ai:get-usage', async () => {
             const db = getDb();
             const rows = await db.select().from(aiUsage)
               .orderBy(desc(aiUsage.createdAt))
               .limit(100);
             return rows.map(r => ({
               ...r,
               createdAt: r.createdAt.toISOString(),
             }));
           });

           // Get aggregated usage summary
           ipcMain.handle('ai:get-usage-summary', async () => {
             const db = getDb();
             const rows = await db.select().from(aiUsage);
             const summary = {
               totalTokens: 0,
               totalCost: 0,
               byProvider: {} as Record<string, { tokens: number; cost: number }>,
               byTaskType: {} as Record<string, { tokens: number; cost: number }>,
             };
             for (const row of rows) {
               summary.totalTokens += row.totalTokens;
               summary.totalCost += row.estimatedCost ?? 0;

               const pid = row.providerId ?? 'unknown';
               if (!summary.byProvider[pid]) {
                 summary.byProvider[pid] = { tokens: 0, cost: 0 };
               }
               summary.byProvider[pid].tokens += row.totalTokens;
               summary.byProvider[pid].cost += row.estimatedCost ?? 0;

               if (!summary.byTaskType[row.taskType]) {
                 summary.byTaskType[row.taskType] = { tokens: 0, cost: 0 };
               }
               summary.byTaskType[row.taskType].tokens += row.totalTokens;
               summary.byTaskType[row.taskType].cost += row.estimatedCost ?? 0;
             }
             return summary;
           });
         }
         ```

         Notes:
         - toAIProvider maps DB rows to renderer-safe objects (hasApiKey boolean only)
         - API keys encrypted before storage, NEVER sent to renderer process
         - clearProviderCache called on update/delete to invalidate stale instances
         - Usage summary computed in Node.js (acceptable for v1 single-user app)
         - ai:get-usage limits to 100 entries (pagination can be added later)
         - ai:get-usage converts timestamps to ISO strings for renderer

      3. Modify src/main/ipc/index.ts:

         Import and register the two new handler files:
         ```typescript
         import { registerSettingsHandlers } from './settings';
         import { registerAIProviderHandlers } from './ai-providers';

         // Add to registerIpcHandlers() body:
         registerSettingsHandlers();
         registerAIProviderHandlers();
         ```

      4. Modify src/preload/preload.ts:

         Add bridge methods for settings and AI providers after the Labels section.
         Follow existing pattern (thin wrappers around ipcRenderer.invoke).

         ```typescript
         // Settings
         getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
         setSetting: (key: string, value: string) =>
           ipcRenderer.invoke('settings:set', key, value),
         getAllSettings: () => ipcRenderer.invoke('settings:get-all'),
         deleteSetting: (key: string) => ipcRenderer.invoke('settings:delete', key),

         // AI Providers
         getAIProviders: () => ipcRenderer.invoke('ai:list-providers'),
         createAIProvider: (data: any) => ipcRenderer.invoke('ai:create-provider', data),
         updateAIProvider: (id: string, data: any) =>
           ipcRenderer.invoke('ai:update-provider', id, data),
         deleteAIProvider: (id: string) =>
           ipcRenderer.invoke('ai:delete-provider', id),
         testAIConnection: (id: string) =>
           ipcRenderer.invoke('ai:test-connection', id),
         isEncryptionAvailable: () => ipcRenderer.invoke('ai:encryption-available'),
         getAIUsage: () => ipcRenderer.invoke('ai:get-usage'),
         getAIUsageSummary: () => ipcRenderer.invoke('ai:get-usage-summary'),
         ```

         Same `any` pattern for data params as existing bridge methods.
         Type safety enforced by ElectronAPI interface in shared/types.ts.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify settings.ts has 4 handlers: settings:get, settings:set,
         settings:get-all, settings:delete
      3. Verify ai-providers.ts has 8 handlers: ai:list-providers, ai:create-provider,
         ai:update-provider, ai:delete-provider, ai:test-connection,
         ai:encryption-available, ai:get-usage, ai:get-usage-summary
      4. Verify index.ts imports and calls registerSettingsHandlers and registerAIProviderHandlers
      5. Verify preload.ts has 12 new methods (4 settings + 8 AI)
      6. Cross-check: every ElectronAPI method in types.ts has a matching
         preload bridge method AND a matching IPC handler
    </verify>
    <done>
      Settings IPC handlers (4) provide key-value CRUD with upsert support.
      AI provider IPC handlers (8) support provider CRUD with encrypted key storage,
      connection testing, encryption availability check, and usage queries.
      Preload bridge extended with 12 new methods matching ElectronAPI interface.
      All handlers registered in index.ts.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Drizzle onConflictDoUpdate works with varchar PK (settings table)
      - desc() from drizzle-orm works for ordering ai_usage by createdAt
      - encryptString/decryptString are callable from IPC handlers (after app ready)
      - ipcMain.handle IPC channel names don't conflict with existing handlers
    </assumptions>
  </task>
</phase>
