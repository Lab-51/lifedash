# Phase 5 — Plan 1 of 2: Meeting Intelligence Service & IPC

## Coverage
- **R6: Meeting Intelligence — AI Brief & Actions** (backend service, IPC layer, types)

## Plan Overview
Phase 5 delivers AI-generated meeting summaries and actionable item extraction (R6). It requires 2 plans:

- **Plan 5.1** (this plan): Backend — intelligence service, IPC handlers, shared types, preload bridge, store extensions.
- **Plan 5.2** (next plan): Frontend — brief display in MeetingDetailModal, action item review/edit UI, convert-to-card flow, meeting history search.

## Architecture Decisions for Plan 5.1

1. **meetingIntelligenceService.ts** — New service in `src/main/services/`. Contains all AI
   generation logic (brief + actions), action item CRUD, and convert-to-card logic. Uses
   the existing `generate()` function from `ai-provider.ts` for all AI calls.

2. **Provider resolution** — A helper function `resolveProvider(taskType)` checks the settings
   table for a `task_models` JSON config. If found, uses the specified provider/model for
   that task type. Falls back to the first enabled provider with sensible defaults.

3. **Structured AI output** — For action item extraction, the AI is instructed to return
   JSON array of `{ description: string }` objects. We parse this with JSON.parse wrapped
   in try/catch, with a regex fallback to extract bullet points if JSON parsing fails.

4. **Prompt templates** — Two system prompts: one for meeting summarization (structured
   bullet-point format) and one for action item extraction (JSON array output). These are
   constants in the service file.

5. **Action item lifecycle** — `pending` → `approved`/`dismissed` (user decision) →
   `converted` (when approved action is turned into a card). The `convertActionToCard`
   function creates a card in the specified column and links it back to the action item.

6. **IPC channels** — New `meeting-intelligence.ts` handler file with 6 channels:
   `meetings:generate-brief`, `meetings:generate-actions`, `meetings:get-brief`,
   `meetings:get-actions`, `meetings:update-action-status`, `meetings:convert-action-to-card`.

7. **MeetingWithTranscript extension** — The `getMeeting` service and store will be extended
   to include `brief` and `actionItems` alongside `segments`, so the detail modal has all
   data in one fetch.

---

<phase n="5.1" name="Meeting Intelligence Service and IPC">
  <context>
    Phase 4 is complete. The app has:
    - AI provider system: generate() in ai-provider.ts (providerName, model, system, prompt, taskType → text + usage)
    - Meeting system: meetingService.ts (getMeeting returns MeetingWithTranscript with segments)
    - DB schema: meetingBriefs table (id, meetingId, summary), actionItems table (id, meetingId, cardId, description, status)
    - Card system: cards:create IPC handler creates cards with columnId, title, description, position
    - Types: MeetingBrief, ActionItem, ActionItemStatus already defined in shared/types.ts
    - Settings: key-value table via getSetting/setSetting
    - TaskModelConfig type exists: { providerId, model, temperature?, maxTokens? }
    - aiProviders table: id, name, displayName, enabled, apiKeyEncrypted, baseUrl
    - Pattern: services in src/main/services/, IPC in src/main/ipc/, types in src/shared/types.ts

    Key files to reference:
    @src/main/services/ai-provider.ts (generate function signature)
    @src/main/services/meetingService.ts (getMeeting, addTranscriptSegment)
    @src/main/db/schema/meetings.ts (meetingBriefs, actionItems tables)
    @src/main/db/schema/ai-providers.ts (aiProviders table)
    @src/main/ipc/meetings.ts (existing meeting handlers)
    @src/main/ipc/cards.ts (card creation pattern)
    @src/main/ipc/index.ts (handler registration)
    @src/shared/types.ts (MeetingBrief, ActionItem, TaskModelConfig, ElectronAPI)
    @src/preload/preload.ts (bridge pattern)
    @src/renderer/stores/meetingStore.ts (Zustand store)
  </context>

  <task type="auto" n="1">
    <n>Create meeting intelligence service with AI prompts and action item management</n>
    <files>
      src/main/services/meetingIntelligenceService.ts (create)
    </files>
    <preconditions>
      - Phase 4 complete (meeting service, transcripts, AI provider system all working)
      - meetingBriefs and actionItems DB tables exist (created in Phase 1 migration)
      - generate() function available from ai-provider.ts
      - aiProviders and settings tables queryable via Drizzle
    </preconditions>
    <action>
      Create `src/main/services/meetingIntelligenceService.ts` — the core intelligence service
      that generates meeting briefs and action items using AI, and manages action item lifecycle.

      WHY: This is the central piece of Phase 5. All AI-powered meeting analysis flows through
      this service. It needs to resolve which AI provider to use, format prompts, parse
      responses, and persist results. Keeping it in a separate service (not inline in IPC
      handlers) keeps the code organized and testable.

      ## Exports (8 functions):

      ### 1. `resolveTaskModel(taskType: string)` — Helper
      Internal helper to determine which AI provider + model to use for a given task type.
      - Query settings table for key `task_models` — expected value is JSON: `{ "summarization": { "providerId": "...", "model": "...", "temperature": 0.3 }, ... }`
      - Parse JSON, look up the entry for `taskType`
      - If found, fetch the provider row from aiProviders by providerId to get apiKeyEncrypted/baseUrl
      - If NOT found (or no settings), fall back to first `enabled: true` provider from aiProviders table
      - Default models by provider: openai → 'gpt-4o-mini', anthropic → 'claude-haiku-4-5-20251001', ollama → 'llama3.2'
      - Return `{ providerId, providerName, apiKeyEncrypted, baseUrl, model, temperature, maxTokens }` or `null` if no provider configured
      - Type the return as `ResolvedProvider | null`

      ### 2. `generateBrief(meetingId: string): Promise<MeetingBrief>`
      - Fetch meeting with transcripts via `getMeeting(meetingId)` from meetingService
      - If no segments, throw Error('No transcript available for this meeting')
      - Combine transcript: segments sorted by startTime, joined with newlines, each prefixed with `[MM:SS]`
      - Resolve provider via `resolveTaskModel('summarization')`
      - If no provider available, throw Error('No AI provider configured. Add one in Settings.')
      - Call `generate()` with summarization system prompt and the full transcript as user prompt
      - Insert result into meetingBriefs table (meetingId, summary: result.text)
      - Return the mapped MeetingBrief

      ### 3. `generateActionItems(meetingId: string): Promise<ActionItem[]>`
      - Same transcript preparation as generateBrief
      - Resolve provider via `resolveTaskModel('summarization')` (same task type — action extraction is part of meeting intelligence)
      - Call `generate()` with action extraction system prompt, instructing JSON array output
      - Parse response: try JSON.parse first, fallback to line-by-line extraction (split on newlines, filter lines starting with `-` or `*` or numbered)
      - For each extracted description: insert into actionItems table (meetingId, description, status: 'pending')
      - Return array of mapped ActionItem objects

      ### 4. `getBrief(meetingId: string): Promise<MeetingBrief | null>`
      - Query meetingBriefs where meetingId matches, order by createdAt desc, limit 1
      - Return mapped MeetingBrief or null

      ### 5. `getActionItems(meetingId: string): Promise<ActionItem[]>`
      - Query actionItems where meetingId matches, order by createdAt asc
      - Return mapped ActionItem array

      ### 6. `updateActionItemStatus(id: string, status: ActionItemStatus): Promise<ActionItem>`
      - Update actionItems set status where id matches
      - Return mapped ActionItem

      ### 7. `convertActionToCard(actionItemId: string, columnId: string): Promise<{ actionItem: ActionItem; cardId: string }>`
      - Get action item by id
      - Get current max position in target column (count cards in that column)
      - Insert new card: title = first 100 chars of description, description = full description, priority = 'medium', position = count
      - Update action item: status = 'converted', cardId = new card id
      - Return updated action item and card id

      ### 8. `deleteActionItem(id: string): Promise<void>`
      - Delete from actionItems where id matches (for cleanup)

      ## Prompt Templates (constants):

      ```
      SUMMARIZATION_SYSTEM_PROMPT:
      "You are a meeting summarization assistant. Given a meeting transcript, produce a structured summary.

      Format your response as:

      ## Key Points
      - [Main discussion points as bullet items]

      ## Decisions Made
      - [Any decisions that were reached]

      ## Follow-ups
      - [Items that need follow-up action]

      Be concise. Focus on substance, not filler. If the transcript is short or unclear, summarize what's available."
      ```

      ```
      ACTION_EXTRACTION_SYSTEM_PROMPT:
      "You are a meeting action item extractor. Given a meeting transcript, identify concrete action items — tasks, assignments, and follow-ups that someone needs to do.

      Respond ONLY with a JSON array of objects, each with a 'description' field:
      [
        { "description": "Schedule follow-up meeting with design team" },
        { "description": "Update the Q4 budget spreadsheet with new numbers" }
      ]

      Rules:
      - Each action item should be a specific, actionable task
      - Start each description with a verb (Schedule, Update, Review, Create, Send, etc.)
      - If no clear action items exist, return an empty array: []
      - Do NOT include general observations or discussion summaries
      - Maximum 10 action items"
      ```

      ## Mapper functions:

      ```typescript
      function toBrief(row: typeof meetingBriefs.$inferSelect): MeetingBrief {
        return {
          id: row.id,
          meetingId: row.meetingId,
          summary: row.summary,
          createdAt: row.createdAt.toISOString(),
        };
      }

      function toActionItem(row: typeof actionItems.$inferSelect): ActionItem {
        return {
          id: row.id,
          meetingId: row.meetingId,
          cardId: row.cardId,
          description: row.description,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
        };
      }
      ```

      ## Imports needed:
      - `eq, desc, asc` from drizzle-orm
      - `getDb` from ../db/connection
      - `meetingBriefs, actionItems, aiProviders, cards` from ../db/schema
      - `settings` from ../db/schema (for task model config)
      - `generate` from ./ai-provider
      - `getMeeting` from ./meetingService
      - Types: MeetingBrief, ActionItem, ActionItemStatus, AIProviderName from shared/types
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify file exports: resolveTaskModel, generateBrief, generateActionItems, getBrief, getActionItems, updateActionItemStatus, convertActionToCard, deleteActionItem
      3. Verify prompt constants exist: SUMMARIZATION_SYSTEM_PROMPT, ACTION_EXTRACTION_SYSTEM_PROMPT
      4. Verify mapper functions: toBrief and toActionItem correctly map DB rows to shared types
      5. Verify resolveTaskModel checks settings table then falls back to first enabled provider
      6. Verify generateBrief throws on empty transcript and missing provider
      7. Verify generateActionItems has JSON parse + line fallback
      8. Verify convertActionToCard creates a card AND updates the action item status/cardId
    </verify>
    <done>
      meetingIntelligenceService.ts exists with 8 exported functions covering AI brief generation,
      action item extraction, action lifecycle management, and convert-to-card. Prompt templates
      are well-structured. Provider resolution falls back gracefully. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - generate() from ai-provider.ts returns { text, usage } — verified from reading the file
      - meetingBriefs and actionItems tables use the schema from meetings.ts — verified
      - cards table accepts columnId, title, description, position, priority — verified from cards.ts IPC
      - settings table stores string values — task_models will be stored as JSON string
      - AI providers return valid text that can be parsed — fallback parsing handles edge cases
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Create IPC handlers, shared types, and preload bridge for meeting intelligence</n>
    <files>
      src/main/ipc/meeting-intelligence.ts (create — 6 IPC handlers)
      src/main/ipc/index.ts (modify — register new handlers)
      src/shared/types.ts (modify — add input types + extend ElectronAPI)
      src/preload/preload.ts (modify — add 6 bridge methods)
    </files>
    <preconditions>
      - Task 1 complete (meetingIntelligenceService.ts exists with all exports)
      - Existing IPC registration pattern in index.ts understood
      - Existing preload bridge pattern understood
    </preconditions>
    <action>
      Create the IPC communication layer for meeting intelligence and extend the shared types
      and preload bridge.

      WHY: The renderer process needs to trigger AI generation and manage action items.
      This task creates the complete communication bridge following the established patterns.

      ## Step 1: Add shared types to src/shared/types.ts

      Add these new types AFTER the existing ActionItem interface (around line 229):

      ```typescript
      // === MEETING INTELLIGENCE TYPES ===

      export interface GenerateBriefInput {
        meetingId: string;
      }

      export interface GenerateActionsInput {
        meetingId: string;
      }

      export interface UpdateActionItemInput {
        status: ActionItemStatus;
      }

      export interface ConvertActionToCardInput {
        actionItemId: string;
        columnId: string;
      }

      export interface ConvertActionToCardResult {
        actionItem: ActionItem;
        cardId: string;
      }
      ```

      Extend the `MeetingWithTranscript` interface to include brief and action items:

      ```typescript
      /** Meeting with its transcript segments, brief, and action items (for detail view) */
      export interface MeetingWithTranscript extends Meeting {
        segments: TranscriptSegment[];
        brief: MeetingBrief | null;
        actionItems: ActionItem[];
      }
      ```

      NOTE: This changes the MeetingWithTranscript type. The meetingService.getMeeting() must
      also be updated to include brief and actionItems. Add this update to meetingService.ts:
      - Import meetingBriefs and actionItems from schema
      - Import MeetingBrief and ActionItem types
      - Add toBrief and toActionItem mappers (or import from meetingIntelligenceService)
      - In getMeeting(): after fetching segments, also fetch the latest brief and all action items
      - Return them as part of MeetingWithTranscript

      Extend ElectronAPI interface with 6 new methods (add after the Meetings section):

      ```typescript
      // Meeting Intelligence
      generateBrief: (meetingId: string) => Promise<MeetingBrief>;
      generateActionItems: (meetingId: string) => Promise<ActionItem[]>;
      getMeetingBrief: (meetingId: string) => Promise<MeetingBrief | null>;
      getMeetingActionItems: (meetingId: string) => Promise<ActionItem[]>;
      updateActionItemStatus: (id: string, status: ActionItemStatus) => Promise<ActionItem>;
      convertActionToCard: (actionItemId: string, columnId: string) => Promise<ConvertActionToCardResult>;
      ```

      ## Step 2: Create src/main/ipc/meeting-intelligence.ts

      New IPC handler file following the same pattern as meetings.ts:

      ```typescript
      // === FILE PURPOSE ===
      // IPC handlers for AI-powered meeting intelligence — brief generation,
      // action item extraction, and action-to-card conversion.

      import { ipcMain } from 'electron';
      import * as intelligence from '../services/meetingIntelligenceService';
      import type { ActionItemStatus } from '../../shared/types';

      export function registerMeetingIntelligenceHandlers(): void {
        // Generate AI brief for a completed meeting
        ipcMain.handle('meetings:generate-brief', async (_event, meetingId: string) => {
          return intelligence.generateBrief(meetingId);
        });

        // Generate AI-extracted action items from transcript
        ipcMain.handle('meetings:generate-actions', async (_event, meetingId: string) => {
          return intelligence.generateActionItems(meetingId);
        });

        // Get existing brief for a meeting
        ipcMain.handle('meetings:get-brief', async (_event, meetingId: string) => {
          return intelligence.getBrief(meetingId);
        });

        // Get action items for a meeting
        ipcMain.handle('meetings:get-actions', async (_event, meetingId: string) => {
          return intelligence.getActionItems(meetingId);
        });

        // Update action item status (approve/dismiss)
        ipcMain.handle(
          'meetings:update-action-status',
          async (_event, id: string, status: ActionItemStatus) => {
            return intelligence.updateActionItemStatus(id, status);
          },
        );

        // Convert an action item to a project card
        ipcMain.handle(
          'meetings:convert-action-to-card',
          async (_event, actionItemId: string, columnId: string) => {
            return intelligence.convertActionToCard(actionItemId, columnId);
          },
        );
      }
      ```

      ## Step 3: Register in src/main/ipc/index.ts

      - Import `registerMeetingIntelligenceHandlers` from './meeting-intelligence'
      - Add `registerMeetingIntelligenceHandlers();` call in `registerIpcHandlers()`
      - No mainWindow parameter needed (intelligence handlers don't send events to renderer)

      ## Step 4: Extend src/preload/preload.ts

      Add 6 new bridge methods in the Meeting Intelligence section:

      ```typescript
      // Meeting Intelligence
      generateBrief: (meetingId: string) =>
        ipcRenderer.invoke('meetings:generate-brief', meetingId),
      generateActionItems: (meetingId: string) =>
        ipcRenderer.invoke('meetings:generate-actions', meetingId),
      getMeetingBrief: (meetingId: string) =>
        ipcRenderer.invoke('meetings:get-brief', meetingId),
      getMeetingActionItems: (meetingId: string) =>
        ipcRenderer.invoke('meetings:get-actions', meetingId),
      updateActionItemStatus: (id: string, status: string) =>
        ipcRenderer.invoke('meetings:update-action-status', id, status),
      convertActionToCard: (actionItemId: string, columnId: string) =>
        ipcRenderer.invoke('meetings:convert-action-to-card', actionItemId, columnId),
      ```

      ## Step 5: Update meetingService.ts getMeeting() to include brief + actionItems

      Modify `src/main/services/meetingService.ts`:
      - Import `meetingBriefs, actionItems` from schema
      - Import `MeetingBrief, ActionItem` types
      - Add `toBrief()` and `toActionItem()` mapper functions
      - In `getMeeting(id)`: after fetching segments, also query:
        - `meetingBriefs` where meetingId = id, order by createdAt desc, limit 1
        - `actionItems` where meetingId = id, order by createdAt asc
      - Return: `{ ...toMeeting(row), segments, brief: briefRow ? toBrief(briefRow) : null, actionItems: actionRows.map(toActionItem) }`
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify shared/types.ts: new input types exist, MeetingWithTranscript has brief + actionItems, ElectronAPI has 6 new methods
      3. Verify meeting-intelligence.ts: 6 IPC handlers registered, all calling the service
      4. Verify ipc/index.ts: imports and calls registerMeetingIntelligenceHandlers
      5. Verify preload.ts: 6 new bridge methods match the ElectronAPI interface
      6. Verify meetingService.ts: getMeeting returns MeetingWithTranscript with brief and actionItems
      7. Grep for 'meetings:generate-brief' — should appear in IPC handler + preload
    </verify>
    <done>
      Complete IPC bridge for meeting intelligence: 6 handlers in meeting-intelligence.ts,
      registered in index.ts. Shared types extended with input/result types and MeetingWithTranscript
      now includes brief + actionItems. Preload bridge has 6 new methods. meetingService.getMeeting()
      returns the extended type. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - meetingIntelligenceService exports match what IPC handlers call (Task 1 complete)
      - MeetingWithTranscript type change is backwards-compatible (brief defaults to null, actionItems to [])
      - Existing code that uses MeetingWithTranscript only accesses .segments — adding new fields won't break it
      - Drizzle schema barrel export already includes meetingBriefs and actionItems
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Extend meeting store with brief and action item state management</n>
    <files>
      src/renderer/stores/meetingStore.ts (modify — add brief/actions state + actions)
    </files>
    <preconditions>
      - Task 2 complete (IPC bridge, types, preload all in place)
      - MeetingWithTranscript now includes brief and actionItems
      - ElectronAPI has generateBrief, generateActionItems, updateActionItemStatus, convertActionToCard
    </preconditions>
    <action>
      Extend the existing meeting Zustand store with state and actions for briefs and action items.

      WHY: Plan 5.2 will build the UI components that display briefs and manage action items.
      Having the store ready means the UI can simply call store actions and read store state.
      This keeps the UI components thin and the data flow clean.

      ## Changes to meetingStore.ts:

      ### 1. Add new state fields to the interface:

      ```typescript
      interface MeetingStore {
        // Existing state
        meetings: Meeting[];
        selectedMeeting: MeetingWithTranscript | null;
        loading: boolean;
        error: string | null;

        // New: intelligence generation state
        generatingBrief: boolean;
        generatingActions: boolean;

        // Existing actions (unchanged)
        loadMeetings: () => Promise<void>;
        loadMeeting: (id: string) => Promise<void>;
        updateMeeting: (id: string, data: UpdateMeetingInput) => Promise<void>;
        deleteMeeting: (id: string) => Promise<void>;
        clearSelectedMeeting: () => void;
        addTranscriptSegment: (segment: TranscriptSegment) => void;

        // New actions
        generateBrief: (meetingId: string) => Promise<void>;
        generateActionItems: (meetingId: string) => Promise<void>;
        updateActionItemStatus: (id: string, status: ActionItemStatus) => Promise<void>;
        convertActionToCard: (actionItemId: string, columnId: string) => Promise<string>;
      }
      ```

      ### 2. Add initial state for new fields:

      ```typescript
      generatingBrief: false,
      generatingActions: false,
      ```

      ### 3. Implement new actions:

      **generateBrief**: Calls the IPC, sets the brief on selectedMeeting.
      ```typescript
      generateBrief: async (meetingId) => {
        set({ generatingBrief: true, error: null });
        try {
          const brief = await window.electronAPI.generateBrief(meetingId);
          const selected = get().selectedMeeting;
          if (selected && selected.id === meetingId) {
            set({ selectedMeeting: { ...selected, brief } });
          }
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to generate brief' });
        } finally {
          set({ generatingBrief: false });
        }
      },
      ```

      **generateActionItems**: Calls the IPC, sets action items on selectedMeeting.
      ```typescript
      generateActionItems: async (meetingId) => {
        set({ generatingActions: true, error: null });
        try {
          const actionItems = await window.electronAPI.generateActionItems(meetingId);
          const selected = get().selectedMeeting;
          if (selected && selected.id === meetingId) {
            set({ selectedMeeting: { ...selected, actionItems } });
          }
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to generate action items' });
        } finally {
          set({ generatingActions: false });
        }
      },
      ```

      **updateActionItemStatus**: Updates a single action item's status in the store.
      ```typescript
      updateActionItemStatus: async (id, status) => {
        try {
          const updated = await window.electronAPI.updateActionItemStatus(id, status);
          const selected = get().selectedMeeting;
          if (selected) {
            set({
              selectedMeeting: {
                ...selected,
                actionItems: selected.actionItems.map(a =>
                  a.id === id ? updated : a
                ),
              },
            });
          }
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to update action item' });
        }
      },
      ```

      **convertActionToCard**: Converts action to card, updates action item in store, returns cardId.
      ```typescript
      convertActionToCard: async (actionItemId, columnId) => {
        try {
          const result = await window.electronAPI.convertActionToCard(actionItemId, columnId);
          const selected = get().selectedMeeting;
          if (selected) {
            set({
              selectedMeeting: {
                ...selected,
                actionItems: selected.actionItems.map(a =>
                  a.id === actionItemId ? result.actionItem : a
                ),
              },
            });
          }
          return result.cardId;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to convert action to card' });
          throw error;
        }
      },
      ```

      ### 4. Import new types:

      Add `ActionItemStatus` to the import from shared/types.ts.
      The `MeetingBrief` and `ActionItem` types are already imported via MeetingWithTranscript.

      ### 5. Note on existing loadMeeting:

      The existing `loadMeeting` action already calls `window.electronAPI.getMeeting(id)`,
      which now returns MeetingWithTranscript with brief and actionItems. So loadMeeting
      automatically loads the brief and action items — no change needed there.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify meetingStore interface: has generatingBrief, generatingActions state flags
      3. Verify meetingStore actions: generateBrief, generateActionItems, updateActionItemStatus, convertActionToCard
      4. Verify generateBrief sets selectedMeeting.brief on success
      5. Verify generateActionItems sets selectedMeeting.actionItems on success
      6. Verify updateActionItemStatus replaces the specific action item in the array
      7. Verify convertActionToCard returns cardId and updates the action item in the array
      8. Verify error handling: all new actions catch errors and set error state
    </verify>
    <done>
      Meeting store extended with brief/action item state management. Four new actions:
      generateBrief, generateActionItems, updateActionItemStatus, convertActionToCard.
      Two new state flags: generatingBrief, generatingActions. All actions properly update
      selectedMeeting state and handle errors. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - MeetingWithTranscript now includes brief and actionItems (Task 2 changes)
      - window.electronAPI methods match the preload bridge from Task 2
      - selectedMeeting is loaded before intelligence actions are called (UI will enforce this)
      - convertActionToCard result includes the updated actionItem with status='converted' and cardId set
    </assumptions>
  </task>
</phase>
