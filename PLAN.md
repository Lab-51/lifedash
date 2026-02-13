# Phase 6 — Plan 2 of 3: Brainstorming — Schema, Service & Chat UI

## Coverage
- **R10: AI Brainstorming Agent** (8 pts) — conversational AI, context injection, session management, export outcomes

## Plan Overview
Phase 6 covers R10 (AI Brainstorming Agent, 8 pts) + R12 (Idea Repository, 5 pts).

Plan 6.2 delivers the full AI Brainstorming feature — backend through UI:
- **Task 1**: Schema, types, streamGenerate helper, brainstormService, IPC handlers, preload bridge
- **Task 2**: brainstormStore (Zustand) + BrainstormPage (session sidebar + chat + streaming display)
- **Task 3**: ChatMessage component with markdown, context display, session rename/archive

## Architecture Decisions for Plan 6.2

1. **New schema needed** — `brainstorm_sessions` + `brainstorm_messages` tables.
   Requires Drizzle migration generation + execution.

2. **Streaming pattern (NEW)** — First feature to use `streamText` from AI SDK v6.
   - `streamGenerate` added to ai-provider.ts (parallel to `generate`)
   - IPC handler iterates textStream, pushes chunks via `event.sender.send()`
   - Preload provides `onBrainstormChunk` listener with cleanup function
   - Store accumulates chunks in `streamingText` state

3. **AI SDK v6 streamText API** (verified from node_modules/ai/dist/index.d.ts):
   - `streamText()` is synchronous (NOT async) — returns StreamTextResult immediately
   - `result.textStream`: AsyncIterableStream<string> — iterate with `for await`
   - `result.text`: PromiseLike<string> — full text after stream completes
   - `result.usage`: PromiseLike<LanguageModelUsage> — token usage after stream completes
   - Accepts: `{ model, messages, system, temperature, maxOutputTokens }`

4. **Context injection** — System prompt includes project name, board names, meeting titles.
   Built dynamically in `brainstormService.buildContext()`.

5. **Provider resolution refactoring** — Extract `resolveTaskModel` + `ResolvedProvider`
   from meetingIntelligenceService.ts to ai-provider.ts for shared use.

6. **Export to idea** — Creates idea from selected assistant message content.

---

<phase n="6.2" name="Brainstorming — Schema, Service & Chat UI">
  <context>
    Plan 6.1 (Idea Repository) is complete. Now implementing R10: AI Brainstorming Agent.
    This is the first feature to use streaming AI responses via `streamText` from the AI SDK.

    AI SDK v6 verified API (from node_modules/ai/dist/index.d.ts):
    - `streamText` from 'ai' — returns StreamTextResult (synchronous, NOT async)
    - result.textStream: AsyncIterableStream of string — iterate with `for await`
    - result.text: PromiseLike of string — full text after stream completes
    - result.usage: PromiseLike of LanguageModelUsage — token usage after stream completes
    - maxOutputTokens (not maxTokens) for token limit
    - ollama provider needs `as LanguageModel` cast

    Schema patterns (from meetings.ts, ideas.ts):
    - UUID primary keys with defaultRandom()
    - Nullable FK with onDelete: 'set null'
    - Cascade FK with onDelete: 'cascade'
    - Timestamps with timezone, defaultNow
    - pgEnum for enums

    'brainstorming' already exists in AITaskType union (types.ts line 128).

    Existing patterns to follow:
    @src/main/db/schema/meetings.ts (table pattern: parent + child with cascade)
    @src/main/db/schema/index.ts (barrel export — add brainstorming.ts)
    @src/main/services/meetingIntelligenceService.ts (resolveTaskModel lines 68-178, AI prompts)
    @src/main/services/ai-provider.ts (generate function — add streamGenerate alongside it)
    @src/main/services/ideaService.ts (CRUD service pattern)
    @src/main/ipc/ideas.ts (IPC handler pattern)
    @src/main/ipc/index.ts (registration point)
    @src/preload/preload.ts (bridge methods + listener pattern)
    @src/shared/types.ts (add types + ElectronAPI extensions)
    @src/renderer/stores/meetingStore.ts (Zustand store with async actions)
    @src/renderer/pages/BrainstormPage.tsx (stub to replace)
    @drizzle.config.ts (schema: ./src/main/db/schema/index.ts, out: ./drizzle)

    UI conventions:
    - Primary action: bg-primary-600 hover:bg-primary-500 text-white rounded-lg
    - Section bg: bg-surface-800/50 border border-surface-700 rounded-lg
    - Loading: Loader2 from lucide-react with animate-spin, text-amber-400
    - Icons: lucide-react (all standard icons available)
    - Escape + overlay click to close modals
  </context>

  <task type="auto" n="1">
    <n>Create brainstorming schema, types, stream helper, service, IPC, and preload</n>
    <files>
      src/main/db/schema/brainstorming.ts (create)
      src/main/db/schema/index.ts (modify — add brainstorming export)
      src/shared/types.ts (modify — add brainstorm types + ElectronAPI extensions)
      src/main/services/ai-provider.ts (modify — add streamGenerate, resolveTaskModel, logUsage)
      src/main/services/meetingIntelligenceService.ts (modify — import resolveTaskModel from ai-provider)
      src/main/services/brainstormService.ts (create)
      src/main/ipc/brainstorm.ts (create)
      src/main/ipc/index.ts (modify — register brainstorm handlers)
      src/preload/preload.ts (modify — add brainstorm bridge methods)
    </files>
    <preconditions>
      - Phase 6.1 complete, TypeScript compiles clean
      - AI provider system functional (ai-provider.ts with generate())
      - meetingIntelligenceService.ts has resolveTaskModel (to be extracted)
      - Docker PostgreSQL running for migration
    </preconditions>
    <action>
      Create the full backend data layer for brainstorming. This introduces the first streaming
      AI pattern in the codebase using `streamText` from the AI SDK.

      WHY: R10 requires a conversational AI interface with database-backed sessions and
      context awareness. This task builds the entire backend pipeline before the UI.

      ## 1. Schema (src/main/db/schema/brainstorming.ts, ~40 lines)

      Follow the meetings.ts pattern (parent table + child table with cascade delete):

      ```typescript
      // === FILE PURPOSE ===
      // Schema for brainstorm sessions and messages.
      // Sessions can optionally belong to a project. Messages cascade delete with session.

      import { pgTable, uuid, varchar, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';
      import { projects } from './projects';

      export const brainstormSessionStatusEnum = pgEnum('brainstorm_session_status', ['active', 'archived']);
      export const brainstormMessageRoleEnum = pgEnum('brainstorm_message_role', ['user', 'assistant']);

      export const brainstormSessions = pgTable('brainstorm_sessions', {
        id: uuid('id').defaultRandom().primaryKey(),
        projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
        title: varchar('title', { length: 500 }).notNull(),
        status: brainstormSessionStatusEnum('status').default('active').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
      });

      export const brainstormMessages = pgTable('brainstorm_messages', {
        id: uuid('id').defaultRandom().primaryKey(),
        sessionId: uuid('session_id').notNull().references(() => brainstormSessions.id, { onDelete: 'cascade' }),
        role: brainstormMessageRoleEnum('role').notNull(),
        content: text('content').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
      });
      ```

      ## 2. Export from schema/index.ts

      Add line:
      ```typescript
      export * from './brainstorming';
      ```

      ## 3. Shared Types (src/shared/types.ts)

      Add after the Idea types section, before the ElectronAPI interface:

      ```typescript
      // === BRAINSTORM TYPES ===

      export type BrainstormSessionStatus = 'active' | 'archived';
      export type BrainstormMessageRole = 'user' | 'assistant';

      export interface BrainstormSession {
        id: string;
        projectId: string | null;
        title: string;
        status: BrainstormSessionStatus;
        createdAt: string;
        updatedAt: string;
      }

      export interface BrainstormMessage {
        id: string;
        sessionId: string;
        role: BrainstormMessageRole;
        content: string;
        createdAt: string;
      }

      export interface BrainstormSessionWithMessages extends BrainstormSession {
        messages: BrainstormMessage[];
      }

      export interface CreateBrainstormSessionInput {
        title: string;
        projectId?: string;
      }
      ```

      Add to the ElectronAPI interface (after the Ideas section):

      ```typescript
      // Brainstorm
      getBrainstormSessions: () => Promise<BrainstormSession[]>;
      getBrainstormSession: (id: string) => Promise<BrainstormSessionWithMessages | null>;
      createBrainstormSession: (data: CreateBrainstormSessionInput) => Promise<BrainstormSession>;
      updateBrainstormSession: (id: string, data: { title?: string; status?: BrainstormSessionStatus }) => Promise<BrainstormSession>;
      deleteBrainstormSession: (id: string) => Promise<void>;
      sendBrainstormMessage: (sessionId: string, content: string) => Promise<BrainstormMessage>;
      onBrainstormChunk: (callback: (data: { sessionId: string; chunk: string }) => void) => () => void;
      exportBrainstormToIdea: (sessionId: string, messageId: string) => Promise<Idea>;
      ```

      ## 4. AI Provider — streamGenerate + resolveTaskModel extraction (src/main/services/ai-provider.ts)

      This step extracts `resolveTaskModel` from meetingIntelligenceService.ts into ai-provider.ts
      where it logically belongs (provider resolution is a provider concern), and adds the new
      streaming function.

      ### 4a. Add imports

      Add `streamText` to the existing import:
      ```typescript
      import { generateText, streamText, type LanguageModel } from 'ai';
      ```

      Add new imports for resolveTaskModel:
      ```typescript
      import { eq } from 'drizzle-orm';
      import { aiProviders, settings } from '../db/schema';
      import type { TaskModelConfig } from '../../shared/types';
      ```

      Note: `AIProviderName` is already imported.

      ### 4b. Add ResolvedProvider interface + DEFAULT_MODELS + resolveTaskModel

      Copy these exactly from meetingIntelligenceService.ts (lines 68-178):

      ```typescript
      // ---------------------------------------------------------------------------
      // Provider Resolution (shared by all AI features)
      // ---------------------------------------------------------------------------

      export interface ResolvedProvider {
        providerId: string;
        providerName: AIProviderName;
        apiKeyEncrypted: string | null;
        baseUrl: string | null;
        model: string;
        temperature?: number;
        maxTokens?: number;
      }

      const DEFAULT_MODELS: Record<AIProviderName, string> = {
        openai: 'gpt-4o-mini',
        anthropic: 'claude-haiku-4-5-20251001',
        ollama: 'llama3.2',
      };

      /**
       * Resolve which AI provider + model to use for a given task type.
       * 1. Check the `task_models` setting (JSON map of taskType -> TaskModelConfig).
       * 2. If config exists, look up the provider row.
       * 3. If no config (or provider is gone/disabled), fall back to first enabled provider.
       * 4. Returns null if no provider is available.
       */
      export async function resolveTaskModel(taskType: string): Promise<ResolvedProvider | null> {
        const db = getDb();

        // 1. Try task_models setting
        const [settingRow] = await db
          .select()
          .from(settings)
          .where(eq(settings.key, 'task_models'));

        if (settingRow) {
          try {
            const taskModels: Record<string, TaskModelConfig> = JSON.parse(settingRow.value);
            const config = taskModels[taskType];
            if (config) {
              const [provider] = await db
                .select()
                .from(aiProviders)
                .where(eq(aiProviders.id, config.providerId));
              if (provider && provider.enabled) {
                return {
                  providerId: provider.id,
                  providerName: provider.name as AIProviderName,
                  apiKeyEncrypted: provider.apiKeyEncrypted,
                  baseUrl: provider.baseUrl,
                  model: config.model,
                  temperature: config.temperature,
                  maxTokens: config.maxTokens,
                };
              }
            }
          } catch {
            // Malformed JSON — fall through to default
          }
        }

        // 2. Fallback: first enabled provider
        const [fallbackProvider] = await db
          .select()
          .from(aiProviders)
          .where(eq(aiProviders.enabled, true))
          .limit(1);

        if (!fallbackProvider) return null;

        return {
          providerId: fallbackProvider.id,
          providerName: fallbackProvider.name as AIProviderName,
          apiKeyEncrypted: fallbackProvider.apiKeyEncrypted,
          baseUrl: fallbackProvider.baseUrl,
          model: DEFAULT_MODELS[fallbackProvider.name as AIProviderName] ?? 'gpt-4o-mini',
        };
      }
      ```

      Note: The existing `TEST_MODELS` constant in ai-provider.ts and the new `DEFAULT_MODELS`
      have overlapping values. Keep both — TEST_MODELS is for connection testing, DEFAULT_MODELS
      is for task model fallback. Different purposes.

      ### 4c. Add logUsage helper

      Add after the `generate` function:

      ```typescript
      /**
       * Log AI token usage to the ai_usage table. Fire-and-forget — never throws.
       */
      export async function logUsage(
        providerId: string,
        model: string,
        taskType: string,
        usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null,
      ): Promise<void> {
        try {
          const db = getDb();
          await db.insert(aiUsage).values({
            providerId,
            model,
            taskType,
            promptTokens: usage?.inputTokens ?? 0,
            completionTokens: usage?.outputTokens ?? 0,
            totalTokens: usage?.totalTokens ?? 0,
          });
        } catch (error) {
          console.error('[AI] Failed to log usage:', error);
        }
      }
      ```

      ### 4d. Add streamGenerate function

      Add after `logUsage`:

      ```typescript
      /**
       * Stream text generation using a configured provider + model.
       * Returns a StreamTextResult — caller iterates textStream and logs usage after.
       *
       * Usage pattern:
       *   const result = streamGenerate({ ... });
       *   for await (const chunk of result.textStream) { /* send to renderer */ }
       *   const usage = await result.usage;
       *   await logUsage(providerId, model, taskType, usage);
       */
      export function streamGenerate(options: {
        providerId: string;
        providerName: AIProviderName;
        apiKeyEncrypted: string | null;
        baseUrl: string | null;
        model: string;
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
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

        return streamText({
          model: factory(options.model) as LanguageModel,
          messages: options.messages,
          system: options.system,
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
        });
      }
      ```

      ## 5. Update meetingIntelligenceService.ts

      Remove the local `ResolvedProvider` interface (lines 68-76), the `DEFAULT_MODELS`
      constant (lines 82-86), and the `resolveTaskModel` function (lines 125-178).

      Add/update import from ai-provider:
      ```typescript
      import { generate, resolveTaskModel, type ResolvedProvider } from './ai-provider';
      ```

      The existing `import { generate } from './ai-provider';` should be updated to also
      import `resolveTaskModel` and `ResolvedProvider`.

      Verify that all references to `resolveTaskModel` and `ResolvedProvider` in
      meetingIntelligenceService.ts still resolve correctly after the change.

      ## 6. brainstormService.ts (src/main/services/brainstormService.ts, ~220-260 lines)

      ```typescript
      // === FILE PURPOSE ===
      // Brainstorming service — session CRUD, message management, context building,
      // and export-to-idea functionality.
      //
      // === DEPENDENCIES ===
      // drizzle-orm, DB schema (brainstorming, projects, boards, meetings, ideas), connection
      //
      // === LIMITATIONS ===
      // - Context injection is read-only (project data -> system prompt, no tool calls)
      // - No message editing or deletion (append-only conversation)
      // - buildContext queries are sequential (could be parallelized for perf)
      //
      // === VERIFICATION STATUS ===
      // - DB schema: brainstorming.ts created in this task
      // - streamText API: verified from node_modules/ai/dist/index.d.ts
      // - Shared types: updated in types.ts
      ```

      Imports:
      ```typescript
      import { eq, desc, asc } from 'drizzle-orm';
      import { getDb } from '../db/connection';
      import {
        brainstormSessions, brainstormMessages,
        projects, boards, meetings, ideas,
      } from '../db/schema';
      import type {
        BrainstormSession, BrainstormMessage, BrainstormSessionWithMessages,
        CreateBrainstormSessionInput, BrainstormSessionStatus, Idea,
      } from '../../shared/types';
      ```

      Row mappers:
      ```typescript
      function toSession(row: typeof brainstormSessions.$inferSelect): BrainstormSession {
        return {
          id: row.id,
          projectId: row.projectId,
          title: row.title,
          status: row.status as BrainstormSessionStatus,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }

      function toMessage(row: typeof brainstormMessages.$inferSelect): BrainstormMessage {
        return {
          id: row.id,
          sessionId: row.sessionId,
          role: row.role as 'user' | 'assistant',
          content: row.content,
          createdAt: row.createdAt.toISOString(),
        };
      }
      ```

      Exported functions (9 total):

      **getSessions()** — List all sessions ordered by updatedAt desc:
      ```typescript
      export async function getSessions(): Promise<BrainstormSession[]> {
        const db = getDb();
        const rows = await db.select().from(brainstormSessions)
          .orderBy(desc(brainstormSessions.updatedAt));
        return rows.map(toSession);
      }
      ```

      **getSession(id)** — Get session with all messages:
      ```typescript
      export async function getSession(id: string): Promise<BrainstormSessionWithMessages | null> {
        const db = getDb();
        const [sessionRow] = await db.select().from(brainstormSessions)
          .where(eq(brainstormSessions.id, id));
        if (!sessionRow) return null;

        const messageRows = await db.select().from(brainstormMessages)
          .where(eq(brainstormMessages.sessionId, id))
          .orderBy(asc(brainstormMessages.createdAt));

        return {
          ...toSession(sessionRow),
          messages: messageRows.map(toMessage),
        };
      }
      ```

      **createSession(data)** — Create new brainstorm session:
      ```typescript
      export async function createSession(data: CreateBrainstormSessionInput): Promise<BrainstormSession> {
        const db = getDb();
        const [row] = await db.insert(brainstormSessions).values({
          title: data.title,
          projectId: data.projectId ?? null,
        }).returning();
        return toSession(row);
      }
      ```

      **updateSession(id, data)** — Update title or status:
      ```typescript
      export async function updateSession(
        id: string,
        data: { title?: string; status?: BrainstormSessionStatus },
      ): Promise<BrainstormSession> {
        const db = getDb();
        const updateObj: Record<string, unknown> = { updatedAt: new Date() };
        if (data.title !== undefined) updateObj.title = data.title;
        if (data.status !== undefined) updateObj.status = data.status;

        const [row] = await db.update(brainstormSessions)
          .set(updateObj)
          .where(eq(brainstormSessions.id, id))
          .returning();
        if (!row) throw new Error(`Session not found: ${id}`);
        return toSession(row);
      }
      ```

      **deleteSession(id)** — Delete session (cascade deletes messages):
      ```typescript
      export async function deleteSession(id: string): Promise<void> {
        const db = getDb();
        await db.delete(brainstormSessions).where(eq(brainstormSessions.id, id));
      }
      ```

      **addMessage(sessionId, role, content)** — Append message to session:
      ```typescript
      export async function addMessage(
        sessionId: string,
        role: 'user' | 'assistant',
        content: string,
      ): Promise<BrainstormMessage> {
        const db = getDb();
        const [row] = await db.insert(brainstormMessages).values({
          sessionId,
          role,
          content,
        }).returning();

        // Touch session updatedAt
        await db.update(brainstormSessions)
          .set({ updatedAt: new Date() })
          .where(eq(brainstormSessions.id, sessionId));

        return toMessage(row);
      }
      ```

      **getMessages(sessionId)** — Get ordered message history:
      ```typescript
      export async function getMessages(sessionId: string): Promise<BrainstormMessage[]> {
        const db = getDb();
        const rows = await db.select().from(brainstormMessages)
          .where(eq(brainstormMessages.sessionId, sessionId))
          .orderBy(asc(brainstormMessages.createdAt));
        return rows.map(toMessage);
      }
      ```

      **buildContext(sessionId)** — Build system prompt with project context:
      ```typescript
      export async function buildContext(sessionId: string): Promise<string> {
        const db = getDb();

        const [session] = await db.select().from(brainstormSessions)
          .where(eq(brainstormSessions.id, sessionId));
        if (!session) return getBaseSystemPrompt();

        let context = getBaseSystemPrompt();

        if (session.projectId) {
          const [project] = await db.select().from(projects)
            .where(eq(projects.id, session.projectId));

          if (project) {
            context += `\n\n## Current Project: ${project.name}`;
            if (project.description) {
              context += `\nDescription: ${project.description}`;
            }

            // Load board names
            const projectBoards = await db.select().from(boards)
              .where(eq(boards.projectId, project.id));
            if (projectBoards.length > 0) {
              context += `\nBoards: ${projectBoards.map(b => b.name).join(', ')}`;
            }

            // Load recent meeting titles
            const projectMeetings = await db.select({ title: meetings.title })
              .from(meetings)
              .where(eq(meetings.projectId, project.id))
              .orderBy(desc(meetings.createdAt))
              .limit(5);
            if (projectMeetings.length > 0) {
              context += `\nRecent meetings: ${projectMeetings.map(m => m.title).join(', ')}`;
            }
          }
        }

        return context;
      }

      function getBaseSystemPrompt(): string {
        return `You are a creative brainstorming assistant. Help the user explore ideas, think through problems, and develop concepts.

Guidelines:
- Be creative and open-minded
- Ask clarifying questions when needed
- Suggest multiple perspectives and approaches
- Help structure thoughts into actionable items
- Reference project context when relevant
- Keep responses focused and practical`;
      }
      ```

      **exportToIdea(sessionId, messageId)** — Create idea from a chat message:
      ```typescript
      export async function exportToIdea(
        sessionId: string,
        messageId: string,
      ): Promise<Idea> {
        const db = getDb();

        const [msg] = await db.select().from(brainstormMessages)
          .where(eq(brainstormMessages.id, messageId));
        if (!msg) throw new Error(`Message not found: ${messageId}`);

        const [session] = await db.select().from(brainstormSessions)
          .where(eq(brainstormSessions.id, sessionId));

        const [ideaRow] = await db.insert(ideas).values({
          title: msg.content.slice(0, 100).replace(/\n/g, ' ').trim(),
          description: msg.content,
          projectId: session?.projectId ?? null,
          status: 'new',
        }).returning();

        return {
          id: ideaRow.id,
          projectId: ideaRow.projectId,
          title: ideaRow.title,
          description: ideaRow.description,
          status: ideaRow.status as 'new',
          effort: ideaRow.effort as null,
          impact: ideaRow.impact as null,
          tags: [],
          createdAt: ideaRow.createdAt.toISOString(),
          updatedAt: ideaRow.updatedAt.toISOString(),
        };
      }
      ```

      ## 7. IPC Handlers (src/main/ipc/brainstorm.ts, ~80-100 lines)

      This is the first IPC handler with streaming. The `send-message` handler iterates
      the text stream and pushes chunks to the renderer via `event.sender.send()`.

      ```typescript
      // === FILE PURPOSE ===
      // IPC handlers for brainstorming — CRUD + streaming AI chat.

      import { ipcMain } from 'electron';
      import * as brainstormService from '../services/brainstormService';
      import { resolveTaskModel, streamGenerate, logUsage } from '../services/ai-provider';

      export function registerBrainstormHandlers(): void {
        ipcMain.handle('brainstorm:list-sessions', async () => {
          return brainstormService.getSessions();
        });

        ipcMain.handle('brainstorm:get-session', async (_event, id: string) => {
          return brainstormService.getSession(id);
        });

        ipcMain.handle('brainstorm:create-session', async (_event, data: any) => {
          return brainstormService.createSession(data);
        });

        ipcMain.handle('brainstorm:update-session', async (_event, id: string, data: any) => {
          return brainstormService.updateSession(id, data);
        });

        ipcMain.handle('brainstorm:delete-session', async (_event, id: string) => {
          return brainstormService.deleteSession(id);
        });

        // Streaming handler — saves user msg, streams AI response, saves assistant msg
        ipcMain.handle('brainstorm:send-message', async (event, sessionId: string, content: string) => {
          // 1. Save user message
          await brainstormService.addMessage(sessionId, 'user', content);

          // 2. Load conversation history + context
          const messages = await brainstormService.getMessages(sessionId);
          const context = await brainstormService.buildContext(sessionId);

          // 3. Resolve AI provider
          const provider = await resolveTaskModel('brainstorming');
          if (!provider) {
            throw new Error('No AI provider configured. Go to Settings to add one.');
          }

          // 4. Stream AI response
          const result = streamGenerate({
            providerId: provider.providerId,
            providerName: provider.providerName,
            apiKeyEncrypted: provider.apiKeyEncrypted,
            baseUrl: provider.baseUrl,
            model: provider.model,
            messages: messages.map(m => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
            system: context,
            temperature: provider.temperature ?? 0.7,
            maxTokens: provider.maxTokens ?? 2048,
          });

          let fullText = '';
          for await (const chunk of result.textStream) {
            fullText += chunk;
            event.sender.send('brainstorm:stream-chunk', { sessionId, chunk });
          }

          // 5. Log usage (fire-and-forget)
          try {
            const usage = await result.usage;
            await logUsage(provider.providerId, provider.model, 'brainstorming', usage);
          } catch (err) {
            console.error('[Brainstorm] Failed to log usage:', err);
          }

          // 6. Save and return assistant message
          const assistantMsg = await brainstormService.addMessage(sessionId, 'assistant', fullText);
          return assistantMsg;
        });

        ipcMain.handle('brainstorm:export-to-idea', async (_event, sessionId: string, messageId: string) => {
          return brainstormService.exportToIdea(sessionId, messageId);
        });
      }
      ```

      ## 8. Register in ipc/index.ts

      Add import:
      ```typescript
      import { registerBrainstormHandlers } from './brainstorm';
      ```

      Add call inside registerIpcHandlers():
      ```typescript
      registerBrainstormHandlers();
      ```

      ## 9. Preload Bridge (src/preload/preload.ts)

      Add after the Ideas section:

      ```typescript
      // Brainstorm
      getBrainstormSessions: () => ipcRenderer.invoke('brainstorm:list-sessions'),
      getBrainstormSession: (id: string) => ipcRenderer.invoke('brainstorm:get-session', id),
      createBrainstormSession: (data: any) => ipcRenderer.invoke('brainstorm:create-session', data),
      updateBrainstormSession: (id: string, data: any) =>
        ipcRenderer.invoke('brainstorm:update-session', id, data),
      deleteBrainstormSession: (id: string) => ipcRenderer.invoke('brainstorm:delete-session', id),
      sendBrainstormMessage: (sessionId: string, content: string) =>
        ipcRenderer.invoke('brainstorm:send-message', sessionId, content),
      onBrainstormChunk: (callback: (data: { sessionId: string; chunk: string }) => void) => {
        const handler = (_event: any, data: { sessionId: string; chunk: string }) => callback(data);
        ipcRenderer.on('brainstorm:stream-chunk', handler);
        return () => { ipcRenderer.removeListener('brainstorm:stream-chunk', handler); };
      },
      exportBrainstormToIdea: (sessionId: string, messageId: string) =>
        ipcRenderer.invoke('brainstorm:export-to-idea', sessionId, messageId),
      ```

      ## 10. Generate and run Drizzle migration

      After all files are created and TypeScript compiles:
      ```bash
      npm run db:generate
      npm run db:migrate
      ```
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. src/main/db/schema/brainstorming.ts: exports brainstormSessions + brainstormMessages tables
         + brainstormSessionStatusEnum + brainstormMessageRoleEnum
      3. src/main/db/schema/index.ts: exports brainstorming module
      4. src/shared/types.ts: exports BrainstormSession, BrainstormMessage,
         BrainstormSessionWithMessages, CreateBrainstormSessionInput,
         BrainstormSessionStatus, BrainstormMessageRole
      5. src/shared/types.ts: ElectronAPI includes 8 brainstorm methods
      6. src/main/services/ai-provider.ts: exports streamGenerate, resolveTaskModel,
         logUsage, ResolvedProvider
      7. src/main/services/meetingIntelligenceService.ts: imports resolveTaskModel from
         ai-provider (no longer has local copy of ResolvedProvider/DEFAULT_MODELS/resolveTaskModel)
      8. src/main/services/brainstormService.ts: exports getSessions, getSession,
         createSession, updateSession, deleteSession, addMessage, getMessages,
         buildContext, exportToIdea (9 exports)
      9. src/main/ipc/brainstorm.ts: exports registerBrainstormHandlers with 7 handlers
      10. src/main/ipc/index.ts: calls registerBrainstormHandlers()
      11. src/preload/preload.ts: includes 8 brainstorm bridge methods including
          onBrainstormChunk with cleanup return function
      12. Run `npm run db:generate` — generates migration SQL for brainstorm tables
      13. Run `npm run db:migrate` — applies migration successfully
    </verify>
    <done>
      Full brainstorm backend created: schema with 2 tables + 2 enums, 6 shared types,
      streamGenerate + resolveTaskModel + logUsage extracted to ai-provider.ts,
      brainstormService with 9 exports (CRUD + messages + context + export),
      7 IPC handlers with streaming via event.sender.send(), 8 preload bridge methods.
      meetingIntelligenceService refactored to use shared resolveTaskModel.
      TypeScript compiles clean, Drizzle migration applied.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - streamText from 'ai' v6.0.84 accepts { model, messages, system, temperature, maxOutputTokens }
        and returns StreamTextResult with textStream AsyncIterable (verified from .d.ts)
      - event.sender.send() in ipcMain.handle works for pushing real-time chunks to renderer
        (standard Electron IPC pattern — sender is the webContents of the calling renderer)
      - Drizzle Kit generates correct migration for new tables with pgEnum types
      - resolveTaskModel extraction is a safe refactoring (same function, new location)
      - 'brainstorming' task type already exists in AITaskType union (confirmed types.ts line 128)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Create brainstorm store and replace BrainstormPage with chat UI</n>
    <files>
      src/renderer/stores/brainstormStore.ts (create)
      src/renderer/pages/BrainstormPage.tsx (replace stub)
    </files>
    <preconditions>
      - Task 1 complete (schema, service, IPC, preload all working)
      - Drizzle migration applied, brainstorm tables exist in DB
      - ElectronAPI has brainstorm methods including onBrainstormChunk with cleanup
    </preconditions>
    <action>
      Create the Zustand store with streaming state and replace the BrainstormPage stub
      with a full chat interface featuring session management and AI conversation.

      WHY: Users need a conversational interface to brainstorm with AI. The page needs to
      manage multiple sessions, display message history, handle streaming responses in
      real-time, and provide session-project linking.

      ## 1. brainstormStore.ts (src/renderer/stores/brainstormStore.ts, ~180-220 lines)

      This store manages sessions, messages, and the streaming state for live AI responses.

      ```typescript
      // === FILE PURPOSE ===
      // Zustand store for brainstorming state — sessions, messages, and streaming.
      // Handles real-time streaming accumulator pattern for AI responses.

      import { create } from 'zustand';
      import type {
        BrainstormSession, BrainstormMessage, BrainstormSessionWithMessages,
        CreateBrainstormSessionInput, BrainstormSessionStatus, Idea,
      } from '../../shared/types';

      interface BrainstormStore {
        // Session state
        sessions: BrainstormSession[];
        activeSession: BrainstormSessionWithMessages | null;
        loadingSessions: boolean;
        loadingSession: boolean;
        error: string | null;

        // Streaming state
        streaming: boolean;
        streamingText: string;

        // Session actions
        loadSessions: () => Promise<void>;
        loadSession: (id: string) => Promise<void>;
        createSession: (data: CreateBrainstormSessionInput) => Promise<BrainstormSession>;
        updateSession: (id: string, data: { title?: string; status?: BrainstormSessionStatus }) => Promise<void>;
        deleteSession: (id: string) => Promise<void>;
        clearActiveSession: () => void;

        // Chat actions
        sendMessage: (content: string) => Promise<void>;

        // Export actions
        exportToIdea: (messageId: string) => Promise<Idea>;
      }

      export const useBrainstormStore = create<BrainstormStore>((set, get) => ({
        sessions: [],
        activeSession: null,
        loadingSessions: false,
        loadingSession: false,
        error: null,
        streaming: false,
        streamingText: '',

        loadSessions: async () => {
          set({ loadingSessions: true, error: null });
          try {
            const sessions = await window.electronAPI.getBrainstormSessions();
            set({ sessions, loadingSessions: false });
          } catch (error) {
            set({
              error: error instanceof Error ? error.message : 'Failed to load sessions',
              loadingSessions: false,
            });
          }
        },

        loadSession: async (id: string) => {
          set({ loadingSession: true, error: null });
          try {
            const session = await window.electronAPI.getBrainstormSession(id);
            set({ activeSession: session, loadingSession: false });
          } catch (error) {
            set({
              error: error instanceof Error ? error.message : 'Failed to load session',
              loadingSession: false,
            });
          }
        },

        createSession: async (data: CreateBrainstormSessionInput) => {
          const session = await window.electronAPI.createBrainstormSession(data);
          set({ sessions: [session, ...get().sessions] });
          return session;
        },

        updateSession: async (id: string, data) => {
          const updated = await window.electronAPI.updateBrainstormSession(id, data);
          set({
            sessions: get().sessions.map(s => s.id === id ? updated : s),
            activeSession: get().activeSession?.id === id
              ? { ...get().activeSession!, ...updated }
              : get().activeSession,
          });
        },

        deleteSession: async (id: string) => {
          await window.electronAPI.deleteBrainstormSession(id);
          set({
            sessions: get().sessions.filter(s => s.id !== id),
            activeSession: get().activeSession?.id === id ? null : get().activeSession,
          });
        },

        clearActiveSession: () => set({ activeSession: null }),

        sendMessage: async (content: string) => {
          const session = get().activeSession;
          if (!session || get().streaming) return;

          // Optimistically add user message
          const tempUserMsg: BrainstormMessage = {
            id: `temp-${Date.now()}`,
            sessionId: session.id,
            role: 'user',
            content,
            createdAt: new Date().toISOString(),
          };

          set({
            activeSession: {
              ...session,
              messages: [...session.messages, tempUserMsg],
            },
            streaming: true,
            streamingText: '',
            error: null,
          });

          // Subscribe to stream chunks
          const cleanup = window.electronAPI.onBrainstormChunk((data) => {
            if (data.sessionId === session.id) {
              set({ streamingText: get().streamingText + data.chunk });
            }
          });

          try {
            await window.electronAPI.sendBrainstormMessage(session.id, content);

            // Reload session to get server-assigned message IDs
            const updatedSession = await window.electronAPI.getBrainstormSession(session.id);
            set({
              activeSession: updatedSession,
              streaming: false,
              streamingText: '',
              sessions: get().sessions.map(s =>
                s.id === session.id ? { ...s, updatedAt: new Date().toISOString() } : s
              ),
            });
          } catch (error) {
            set({
              streaming: false,
              streamingText: '',
              error: error instanceof Error ? error.message : 'Failed to send message',
            });
          } finally {
            cleanup();
          }
        },

        exportToIdea: async (messageId: string) => {
          const session = get().activeSession;
          if (!session) throw new Error('No active session');
          return window.electronAPI.exportBrainstormToIdea(session.id, messageId);
        },
      }));
      ```

      ## 2. BrainstormPage.tsx (src/renderer/pages/BrainstormPage.tsx, ~350-420 lines)

      Replace the stub entirely. This is a split-panel layout: session sidebar + chat area.

      Layout:
      ```
      +-------------------------------------------------------------+
      | Brainstorm                                                   |
      | AI-powered ideation sessions                                 |
      |                                                              |
      | +----------------+------------------------------------------+|
      | | Sessions       | Session Title           [project badge]  ||
      | |                |                                          ||
      | | [+ New]        |   (user message, right-aligned)          ||
      | |                |   What if we add dark mode?              ||
      | | > Session 1    |                                          ||
      | |   Session 2    |   (assistant message, left-aligned)      ||
      | |   Session 3    |   Great idea! Here are some approaches...||
      | |                |   1. Theme system with CSS vars    [Bulb]||
      | |                |                                          ||
      | |                |   (streaming message with cursor)        ||
      | |                |   The best approach would be...#         ||
      | |                |                                          ||
      | |                |   [Type your message...         ] [Send] ||
      | +----------------+------------------------------------------+|
      +-------------------------------------------------------------+
      ```

      Imports:
      ```typescript
      import { useState, useEffect, useRef } from 'react';
      import {
        Brain, Plus, Send, Loader2, Trash2, Archive,
        Lightbulb, MessageSquare, User, Bot,
      } from 'lucide-react';
      import { useBrainstormStore } from '../stores/brainstormStore';
      import { useProjectStore } from '../stores/projectStore';
      import type { BrainstormMessage } from '../../shared/types';
      ```

      State:
      ```typescript
      const {
        sessions, activeSession, loadingSessions, loadingSession,
        streaming, streamingText, error,
        loadSessions, loadSession, createSession, updateSession,
        deleteSession, sendMessage, clearActiveSession, exportToIdea,
      } = useBrainstormStore();
      const { projects, loadProjects } = useProjectStore();
      const [input, setInput] = useState('');
      const [newSessionTitle, setNewSessionTitle] = useState('');
      const [showNewSession, setShowNewSession] = useState(false);
      const [selectedProjectId, setSelectedProjectId] = useState<string>('');
      const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
      const messagesEndRef = useRef<HTMLDivElement>(null);
      ```

      Effects:
      ```typescript
      // Load sessions on mount
      useEffect(() => {
        loadSessions();
        loadProjects();
      }, []);

      // Auto-scroll to bottom when new messages or streaming text changes
      useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, [activeSession?.messages, streamingText]);
      ```

      Handlers:
      ```typescript
      const handleCreateSession = async () => {
        if (!newSessionTitle.trim()) return;
        const session = await createSession({
          title: newSessionTitle.trim(),
          projectId: selectedProjectId || undefined,
        });
        setNewSessionTitle('');
        setSelectedProjectId('');
        setShowNewSession(false);
        loadSession(session.id);
      };

      const handleSendMessage = async () => {
        if (!input.trim() || streaming) return;
        const content = input.trim();
        setInput('');
        await sendMessage(content);
      };

      const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSendMessage();
        }
      };

      const handleExportToIdea = async (messageId: string) => {
        try {
          await exportToIdea(messageId);
        } catch (err) {
          console.error('Failed to export to idea:', err);
        }
      };

      const handleDeleteSession = async (id: string) => {
        await deleteSession(id);
        setConfirmDeleteId(null);
      };
      ```

      Helper — relative time formatter:
      ```typescript
      function formatRelativeTime(isoDate: string): string {
        const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
      }
      ```

      JSX structure:

      **Page header**: h1 "Brainstorm" + p subtitle, same as other pages.

      **Main container**: `flex h-[calc(100vh-10rem)] gap-0 border border-surface-700 rounded-xl overflow-hidden`

      **Left sidebar** (`w-64 flex-shrink-0 border-r border-surface-700 bg-surface-900 flex flex-col`):
      - Header: "Sessions" label with Plus button (toggles showNewSession)
      - If showNewSession: form with title input, project select dropdown (optional, "No project" default),
        Create + Cancel buttons
      - Scrollable session list (`flex-1 overflow-y-auto`):
        - Each session: clickable row, shows title (truncated), relative date
        - Active session: `bg-surface-700/50 border-l-2 border-primary-500`
        - Inactive: `hover:bg-surface-800/50`
        - Show linked project name as small badge if projectId is set
        - On hover: delete icon (Trash2, size 14)
        - Delete: click shows inline "Delete?" confirm, confirm click deletes
      - Empty state: "No sessions" + "Create one to start brainstorming"

      **Right panel** (`flex-1 flex flex-col bg-surface-900/50`):
      - If no active session: centered empty state (Brain icon + "Select or create a session")
      - If loadingSession: centered Loader2 spinner
      - If active session:
        - **Header bar** (`px-4 py-3 border-b border-surface-700`):
          - Session title (text-lg font-medium)
          - Project badge if linked (bg-surface-700 text-xs px-2 py-0.5 rounded-full)
        - **Messages area** (`flex-1 overflow-y-auto p-4 space-y-3`):
          - User messages: right-aligned (`ml-auto max-w-[80%]`)
            - bg-primary-600/20 border border-primary-500/30 rounded-2xl rounded-br-sm p-3
            - Small User icon + "You" label at top
            - Content: whitespace-pre-wrap, text-sm text-surface-200
          - Assistant messages: left-aligned (`mr-auto max-w-[80%]`)
            - bg-surface-800 border border-surface-700 rounded-2xl rounded-bl-sm p-3
            - Small Bot icon + "AI" label at top
            - Content: whitespace-pre-wrap, text-sm text-surface-200
            - Export button on hover: Lightbulb icon, "Save as Idea"
          - Streaming message (if streaming && streamingText):
            - Same styling as assistant but with `animate-pulse` cursor at end
            - Content: streamingText + pulsing block character
          - Streaming indicator (if streaming && !streamingText):
            - Three animated dots or Loader2 spinner with "AI is thinking..."
          - messagesEndRef div at bottom for auto-scroll
        - **Input area** (`border-t border-surface-700 p-3`):
          - Flex row: textarea + send button
          - textarea: bg-surface-800 border border-surface-700 rounded-xl px-4 py-2.5
            text-sm resize-none, placeholder "Type your message... (Shift+Enter for new line)"
            onKeyDown for Enter to send
          - Send button: bg-primary-600 hover:bg-primary-500 disabled when empty or streaming
            Send icon
          - Error display below input if error exists (text-red-400 text-sm)

      Messages are rendered with simple whitespace-pre-wrap for now. Task 3 will
      add proper markdown rendering via a ChatMessage component.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. brainstormStore.ts: exports useBrainstormStore hook
      3. brainstormStore.ts: has loadSessions, loadSession, createSession, updateSession,
         deleteSession, clearActiveSession, sendMessage, exportToIdea (8 actions)
      4. brainstormStore.ts: streaming state (streaming boolean + streamingText accumulator)
      5. brainstormStore.ts: sendMessage subscribes to chunks via onBrainstormChunk,
         accumulates text, cleans up listener on completion or error
      6. BrainstormPage.tsx: page header with title and subtitle
      7. BrainstormPage.tsx: session sidebar with list, new session form, delete with confirm
      8. BrainstormPage.tsx: new session form has title input + optional project dropdown
      9. BrainstormPage.tsx: chat area shows messages with user/assistant visual distinction
      10. BrainstormPage.tsx: streaming message appears during AI response with cursor animation
      11. BrainstormPage.tsx: textarea input with Enter to send, Shift+Enter for newline
      12. BrainstormPage.tsx: auto-scroll to bottom on new messages and during streaming
      13. BrainstormPage.tsx: export-to-idea button on assistant messages
      14. BrainstormPage.tsx: empty states for no sessions and no active session
      15. BrainstormPage.tsx: error state display
    </verify>
    <done>
      brainstormStore.ts created with session/message/streaming state and 8 actions including
      optimistic user message display and streaming chunk accumulation. BrainstormPage.tsx
      replaced with full split-panel chat UI: session sidebar (create with project link,
      list with relative dates, delete with confirm), chat area with message history
      (user right-aligned, assistant left-aligned), real-time streaming display with
      animated cursor, textarea input with keyboard shortcuts, auto-scroll, and
      export-to-idea on assistant messages. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - onBrainstormChunk cleanup function correctly removes IPC listener
      - scrollIntoView({ behavior: 'smooth' }) works during rapid streaming updates
      - textarea with onKeyDown for Enter/Shift+Enter is standard React pattern
      - Session sidebar at w-64 provides sufficient space for titles
      - Reloading full session after send (rather than optimistic insert) is acceptable
        for keeping message IDs in sync with the database
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Add ChatMessage component with markdown, context indicator, and session polish</n>
    <files>
      src/renderer/components/ChatMessage.tsx (create)
      src/renderer/pages/BrainstormPage.tsx (modify — use ChatMessage, add context + session rename/archive)
    </files>
    <preconditions>
      - Task 2 complete (brainstormStore and BrainstormPage working)
      - Sessions can be created, messages sent, streaming works
      - Messages currently render with whitespace-pre-wrap (no markdown)
    </preconditions>
    <action>
      Extract message rendering into a reusable ChatMessage component with lightweight
      markdown support, add a context indicator, and polish session management.

      WHY: AI responses often contain markdown (headings, lists, code blocks) that should
      render properly. Users also need to see what context is being injected into their
      brainstorming session, and session management benefits from rename and archive.

      ## 1. ChatMessage.tsx (src/renderer/components/ChatMessage.tsx, ~150-180 lines)

      Extract message rendering from BrainstormPage into a standalone component.

      ```typescript
      // === FILE PURPOSE ===
      // Renders a single brainstorm chat message with role-based styling
      // and lightweight markdown rendering for AI responses.
      //
      // === DEPENDENCIES ===
      // lucide-react
      //
      // === LIMITATIONS ===
      // - Markdown rendering is regex-based, not a full parser
      // - Handles: headings, bullets, numbered lists, code blocks, inline code, bold, italic
      // - Does NOT handle: nested lists, tables, images, links

      import { useState } from 'react';
      import { Lightbulb, Check, User, Bot } from 'lucide-react';
      import type { BrainstormMessage } from '../../shared/types';

      interface ChatMessageProps {
        message: BrainstormMessage;
        onExportToIdea?: (messageId: string) => void;
      }
      ```

      Lightweight markdown renderer — `renderMarkdown(content: string): React.ReactNode`:
      - Split content by code blocks first (``` ... ```)
      - For code blocks: render as `<pre className="bg-surface-950 border border-surface-700
        rounded-lg p-3 text-xs font-mono overflow-x-auto my-2"><code>{content}</code></pre>`
      - For text sections, process line by line:
        - Lines starting with `## ` or `### `: render as styled headings
          `<div className="font-semibold text-surface-100 mt-3 mb-1">`
        - Lines starting with `- ` or `* `: collect consecutive, wrap in `<ul className="list-disc pl-4 space-y-0.5">`
        - Lines starting with `\d+. `: collect consecutive, wrap in `<ol className="list-decimal pl-4 space-y-0.5">`
        - Empty lines: `<div className="h-2" />` (spacing)
        - Other lines: `<p className="my-0.5">`
      - Within text: apply inline formatting:
        - `**text**` -> `<strong>`
        - `*text*` (not **) -> `<em>`
        - `` `code` `` -> `<code className="bg-surface-700 px-1 py-0.5 rounded text-xs font-mono">`

      Implement as a function component, NOT a full markdown parser. Keep it simple:
      use string.split() and regex, return JSX elements with keys.

      User messages:
      - Container: `ml-auto max-w-[80%]`
      - Bubble: `bg-primary-600/20 border border-primary-500/30 rounded-2xl rounded-br-sm p-3`
      - Header: User icon (size 14) + "You" label, text-xs text-surface-500
      - Content: `whitespace-pre-wrap text-sm text-surface-200` (no markdown for user msgs)
      - Timestamp: bottom-right, text-xs text-surface-600

      Assistant messages:
      - Container: `mr-auto max-w-[80%] group` (group for hover actions)
      - Bubble: `bg-surface-800 border border-surface-700 rounded-2xl rounded-bl-sm p-3`
      - Header: Bot icon (size 14, text-primary-400) + "AI" label, text-xs text-surface-500
      - Content: rendered via renderMarkdown(), `text-sm text-surface-200`
      - Hover action bar: `opacity-0 group-hover:opacity-100 transition-opacity`
        flex items-center gap-1 mt-2 pt-2 border-t border-surface-700
        - Export button: Lightbulb icon + "Save as Idea", text-xs, rounded-md px-2 py-1
          hover:bg-surface-700 text-surface-400 hover:text-amber-400
        - On click: calls onExportToIdea, shows Check icon + "Saved!" for 2 seconds
      - Timestamp: bottom-right, text-xs text-surface-600

      ```typescript
      export default function ChatMessage({ message, onExportToIdea }: ChatMessageProps) {
        const [exported, setExported] = useState(false);

        const handleExport = () => {
          if (onExportToIdea && !exported) {
            onExportToIdea(message.id);
            setExported(true);
            setTimeout(() => setExported(false), 2000);
          }
        };

        // ... render based on message.role
      }
      ```

      ## 2. Update BrainstormPage.tsx

      ### 2a. Replace inline message rendering with ChatMessage

      Add import:
      ```typescript
      import ChatMessage from '../components/ChatMessage';
      ```

      Replace the inline message map in the messages area with:
      ```tsx
      {activeSession.messages.map(msg => (
        <ChatMessage
          key={msg.id}
          message={msg}
          onExportToIdea={msg.role === 'assistant' ? handleExportToIdea : undefined}
        />
      ))}
      ```

      Keep the streaming message as inline JSX (it uses streamingText, not a BrainstormMessage):
      ```tsx
      {streaming && streamingText && (
        <div className="mr-auto max-w-[80%] bg-surface-800 border border-surface-700 rounded-2xl rounded-bl-sm p-3">
          <div className="flex items-center gap-2 mb-1">
            <Bot size={14} className="text-primary-400" />
            <span className="text-xs text-surface-500">AI</span>
          </div>
          <div className="text-sm text-surface-200 whitespace-pre-wrap">
            {streamingText}<span className="animate-pulse text-primary-400">|</span>
          </div>
        </div>
      )}
      ```

      ### 2b. Add context indicator to chat header

      In the header bar of the active session, below the title, add:
      ```tsx
      <div className="flex items-center gap-2 text-xs text-surface-500 mt-0.5">
        <span>Context:</span>
        {activeSession.projectId ? (
          <span className="bg-surface-700 px-2 py-0.5 rounded-full text-surface-300">
            {projects.find(p => p.id === activeSession.projectId)?.name ?? 'Project'}
          </span>
        ) : (
          <span className="text-surface-600">General (no project linked)</span>
        )}
      </div>
      ```

      ### 2c. Add session rename (inline edit)

      In the session sidebar, add double-click to rename:
      - State: `const [renamingId, setRenamingId] = useState<string | null>(null);`
        `const [renameTitle, setRenameTitle] = useState('');`
      - On double-click on session title: set renamingId and renameTitle
      - Show input instead of title text when renamingId matches
      - Enter: save via updateSession(id, { title: renameTitle }), clear renamingId
      - Escape: cancel rename, clear renamingId
      - Blur: save (same as Enter)

      ### 2d. Add archive toggle

      In session sidebar hover actions (next to delete icon):
      - Archive icon button (Archive from lucide-react, size 14)
      - On click: updateSession(id, { status: 'archived' })
      - Add state: `const [showArchived, setShowArchived] = useState(false);`
      - Filter sessions in sidebar:
        `const filteredSessions = showArchived ? sessions : sessions.filter(s => s.status === 'active');`
      - Toggle at top of session list: "Show archived" checkbox/toggle
      - Archived sessions: `opacity-50` styling
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. ChatMessage.tsx: renders user messages right-aligned with primary bubble styling
      3. ChatMessage.tsx: renders assistant messages left-aligned with surface bubble styling
      4. ChatMessage.tsx: markdown handles headings (## and ###), bullets, numbered lists,
         code blocks, inline code, bold, and italic
      5. ChatMessage.tsx: assistant messages show export-to-idea on hover
      6. ChatMessage.tsx: export shows "Saved!" confirmation for 2 seconds
      7. BrainstormPage.tsx: uses ChatMessage component for all messages
      8. BrainstormPage.tsx: streaming message shows with animated cursor
      9. BrainstormPage.tsx: context indicator in chat header shows project name or "General"
      10. BrainstormPage.tsx: session rename via double-click inline edit
      11. BrainstormPage.tsx: archive toggle on session hover
      12. BrainstormPage.tsx: "Show archived" filter toggle in sidebar
    </verify>
    <done>
      ChatMessage.tsx created (~150-180 lines) with role-based styling and lightweight
      regex-based markdown rendering (headings, lists, code blocks, inline formatting).
      BrainstormPage.tsx updated: uses ChatMessage for message display, context indicator
      in chat header, session rename via double-click, archive toggle, and session list
      filtering. Plan 6.2 delivers complete R10: AI Brainstorming Agent with conversational
      streaming interface, context injection, session management, markdown rendering,
      and export to ideas. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Lightweight regex-based markdown rendering covers most AI response formatting
        (full library like react-markdown not needed for MVP)
      - Double-click for inline rename is discoverable (common pattern in file managers)
      - group-hover for export button action bar works with Tailwind (standard Tailwind pattern)
      - Code block detection via ``` split is reliable for AI-generated content
    </assumptions>
  </task>
</phase>
