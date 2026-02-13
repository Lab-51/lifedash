# Plan 8.4 — Zod IPC Validation Rollout (Schemas + 5 Handler Files)

**Source:** Plan 8.3 established Zod validation infrastructure (schemas.ts, ipc-validator.ts) and validated projects.ts as a pilot. This plan extends validation to the 5 largest remaining IPC handler files.
**Scope:** Create all remaining Zod schemas (~21 input types), then apply validation to cards.ts (23 handlers), ai-providers.ts (8), ideas.ts (8), meetings.ts (5), and meeting-intelligence.ts (6) — 50 handlers total.
**Approach:** Schema creation first (Task 1), then two parallel-safe handler file batches (Task 2: cards.ts, Task 3: 4 smaller files).

## Scope Rationale

Plan 8.3 validated projects.ts (13 handlers) as a pilot. There are ~95 remaining handlers across 16 files. This plan targets the 5 largest/most critical files (50 handlers), leaving 11 smaller files (~40 handlers) for Plan 8.5. IdeaDetailModal decomposition also deferred to Plan 8.5 to keep this plan focused on validation.

**Remaining for Plan 8.5:**
- Zod validation for 11 smaller IPC files (brainstorm, backup, settings, recording, task-structuring, notifications, whisper, diarization, transcription-provider, window-controls, database)
- IdeaDetailModal decomposition (815 → ~575 lines)
- Renderer-side console cleanup (2 debug logs)

---

<phase n="8.4" name="Zod IPC Validation Rollout — Schemas + 5 Handler Files">
  <context>
    Plan 8.3 created the validation infrastructure:
    - src/shared/validation/schemas.ts — 8 schemas (project/board/column CRUD + idParam + columnReorder)
    - src/shared/validation/ipc-validator.ts — validateInput(schema, data) wrapper
    - projects.ts — fully validated (13 handlers, reference implementation)

    This plan extends coverage. Task 1 creates all remaining schemas. Tasks 2-3 apply them.

    Key files:
    @src/shared/validation/schemas.ts — extend with ~21 new schemas
    @src/shared/validation/ipc-validator.ts — already done, reuse as-is
    @src/shared/types.ts — source of truth for all input interfaces
    @src/main/ipc/cards.ts — 23 handlers (largest IPC file, 459 lines)
    @src/main/ipc/ai-providers.ts — 8 handlers (180 lines)
    @src/main/ipc/ideas.ts — 8 handlers (39 lines)
    @src/main/ipc/meetings.ts — 5 handlers (35 lines)
    @src/main/ipc/meeting-intelligence.ts — 6 handlers (45 lines)

    Reference: projects.ts shows the validated pattern — import validateInput + schemas,
    change param types to `unknown`, call validateInput at top of handler body.
  </context>

  <task type="auto" n="1">
    <n>Create all remaining Zod schemas for IPC input types</n>
    <files>
      src/shared/validation/schemas.ts (MODIFY — extend with ~21 new schemas)
    </files>
    <action>
      ## WHY
      Plan 8.3 created schemas for 6 project/board/column input types + id + reorder.
      The remaining ~21 input types in types.ts have no schemas yet. All schemas must
      exist before Tasks 2-3 can apply validation to handler files.

      ## WHAT

      Read src/shared/types.ts to verify each interface, then extend schemas.ts with:

      ### Enum schemas (reusable across multiple input types)

      ```typescript
      // --- Enums ---
      export const cardPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
      export const cardRelationshipTypeSchema = z.enum(['blocks', 'depends_on', 'related_to']);
      export const actionItemStatusSchema = z.enum(['pending', 'approved', 'dismissed', 'converted']);
      export const aiProviderNameSchema = z.enum(['openai', 'anthropic', 'ollama']);
      export const ideaStatusSchema = z.enum(['new', 'exploring', 'active', 'archived']);
      export const effortLevelSchema = z.enum(['trivial', 'small', 'medium', 'large', 'epic']);
      export const impactLevelSchema = z.enum(['minimal', 'low', 'medium', 'high', 'critical']);
      export const meetingStatusSchema = z.enum(['recording', 'processing', 'completed']);
      export const meetingTemplateTypeSchema = z.enum(['none', 'standup', 'retro', 'planning', 'brainstorm', 'one_on_one']);
      export const exportFormatSchema = z.enum(['json', 'csv']);
      ```

      ### Card schemas (for cards.ts)

      ```typescript
      // --- Cards ---
      export const createCardInputSchema = z.object({
        columnId: uuid,
        title: z.string().min(1).max(500),
        description: z.string().max(10000).optional(),
        priority: cardPrioritySchema.optional(),
      });

      export const updateCardInputSchema = z.object({
        title: z.string().min(1).max(500).optional(),
        description: z.string().max(10000).nullable().optional(),
        priority: cardPrioritySchema.optional(),
        dueDate: z.string().nullable().optional(),
        archived: z.boolean().optional(),
        columnId: uuid.optional(),
        position: z.number().int().min(0).optional(),
      });

      export const cardMoveSchema = z.object({
        columnId: uuid,
        position: z.number().int().min(0),
      });

      // --- Labels ---
      export const createLabelInputSchema = z.object({
        projectId: uuid,
        name: z.string().min(1).max(100),
        color: z.string().min(1).max(50),
      });

      export const updateLabelInputSchema = z.object({
        name: z.string().min(1).max(100).optional(),
        color: z.string().min(1).max(50).optional(),
      });

      // --- Card Comments ---
      export const createCardCommentInputSchema = z.object({
        cardId: uuid,
        content: z.string().min(1).max(5000),
      });

      export const commentContentSchema = z.string().min(1).max(5000);

      // --- Card Relationships ---
      export const createCardRelationshipInputSchema = z.object({
        sourceCardId: uuid,
        targetCardId: uuid,
        type: cardRelationshipTypeSchema,
      });

      // --- Card Attachment (filePath validation) ---
      export const filePathSchema = z.string().min(1);
      ```

      ### AI Provider schemas (for ai-providers.ts)

      ```typescript
      // --- AI Providers ---
      export const createAIProviderInputSchema = z.object({
        name: aiProviderNameSchema,
        displayName: z.string().max(200).optional(),
        apiKey: z.string().optional(),
        baseUrl: z.string().url().optional(),
      });

      export const updateAIProviderInputSchema = z.object({
        displayName: z.string().max(200).optional(),
        apiKey: z.string().optional(),
        baseUrl: z.string().url().nullable().optional(),
        enabled: z.boolean().optional(),
      });
      ```

      ### Idea schemas (for ideas.ts)

      ```typescript
      // --- Ideas ---
      export const createIdeaInputSchema = z.object({
        title: z.string().min(1).max(500),
        description: z.string().max(10000).optional(),
        projectId: uuid.optional(),
        tags: z.array(z.string().max(100)).optional(),
      });

      export const updateIdeaInputSchema = z.object({
        title: z.string().min(1).max(500).optional(),
        description: z.string().max(10000).nullable().optional(),
        projectId: uuid.nullable().optional(),
        status: ideaStatusSchema.optional(),
        effort: effortLevelSchema.nullable().optional(),
        impact: impactLevelSchema.nullable().optional(),
        tags: z.array(z.string().max(100)).optional(),
      });
      ```

      ### Meeting schemas (for meetings.ts)

      ```typescript
      // --- Meetings ---
      export const createMeetingInputSchema = z.object({
        title: z.string().min(1).max(500),
        projectId: uuid.optional(),
        template: meetingTemplateTypeSchema.optional(),
      });

      export const updateMeetingInputSchema = z.object({
        title: z.string().min(1).max(500).optional(),
        projectId: uuid.nullable().optional(),
        endedAt: z.string().optional(),
        audioPath: z.string().optional(),
        status: meetingStatusSchema.optional(),
      });
      ```

      ### Meeting intelligence schemas (for meeting-intelligence.ts)

      ```typescript
      // --- Meeting Intelligence ---
      export const updateActionItemInputSchema = z.object({
        status: actionItemStatusSchema,
      });
      ```

      IMPORTANT: Read types.ts BEFORE writing schemas to verify all field names,
      optional/nullable patterns, and types match exactly. The schemas above are
      derived from reading types.ts but verify each one against the actual code.

      NOTE: baseUrl in CreateAIProviderInput — check if the actual field allows
      empty strings or only valid URLs. If the code sends `''` to clear it,
      use `z.string().optional()` instead of `z.string().url().optional()`.
      Read ai-providers.ts to verify.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. schemas.ts has 10+ enum schemas and 15+ object schemas
      3. All schemas match the corresponding TypeScript interfaces in types.ts
      4. `npm test` — all tests pass
    </verify>
    <done>
      All ~21 remaining Zod schemas created in schemas.ts. Enum schemas defined
      for all union types (CardPriority, IdeaStatus, etc.). Ready for handler
      file validation in Tasks 2-3.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Zod z.enum() works with TypeScript string literal unions
      - UUID validation via z.string().uuid() matches the actual ID format (Drizzle gen_random_uuid)
      - Max lengths (500 for titles, 10000 for descriptions) are reasonable defaults
      - The schemas provided above match types.ts — but agent MUST verify by reading types.ts
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Apply Zod validation to cards.ts (23 handlers)</n>
    <files>
      src/main/ipc/cards.ts (MODIFY)
    </files>
    <action>
      ## WHY
      cards.ts is the largest IPC handler file (459 lines, 23 handlers). It manages
      cards, labels, comments, relationships, and attachments — all user data that
      benefits from runtime validation. This is the highest-priority file for validation.

      ## WHAT

      Read src/main/ipc/cards.ts fully, then apply the same pattern used in projects.ts:

      1. Add imports:
      ```typescript
      import { validateInput } from '../../shared/validation/ipc-validator';
      import {
        createCardInputSchema, updateCardInputSchema, cardMoveSchema,
        createLabelInputSchema, updateLabelInputSchema,
        createCardCommentInputSchema, commentContentSchema,
        createCardRelationshipInputSchema, filePathSchema,
        idParamSchema,
      } from '../../shared/validation/schemas';
      ```

      2. Remove old type imports that are replaced by Zod schemas (CreateCardInput,
         UpdateCardInput, CreateLabelInput, UpdateLabelInput). KEEP type imports that
         are used for return types or other purposes (Card, Label).

      3. Change param types from specific to `unknown` and add validateInput:

      **Handler-by-handler guide (read the actual file to confirm signatures):**

      | Handler | Params | Validation |
      |---------|--------|------------|
      | cards:list-by-board | boardId | idParamSchema |
      | cards:create | data: CreateCardInput | createCardInputSchema |
      | cards:update | id, data: UpdateCardInput | idParamSchema + updateCardInputSchema |
      | cards:delete | id | idParamSchema |
      | cards:move | id, columnId, position | idParamSchema for id; for columnId+position, validate individually OR create a compound schema. Actually, the handler takes 3 separate args: `(id: string, columnId: string, position: number)`. Validate each: `validateInput(idParamSchema, id)`, `validateInput(idParamSchema, columnId)`, `validateInput(z.number().int().min(0), position)`. Or use the cardMoveSchema if you restructure. Recommend individual validation for minimal change. |
      | labels:list | projectId | idParamSchema |
      | labels:create | data: CreateLabelInput | createLabelInputSchema |
      | labels:update | id, data: UpdateLabelInput | idParamSchema + updateLabelInputSchema |
      | labels:delete | id | idParamSchema |
      | labels:attach | cardId, labelId | idParamSchema for both |
      | labels:detach | cardId, labelId | idParamSchema for both |
      | card:getComments | cardId | idParamSchema |
      | card:addComment | input: {cardId, content} | createCardCommentInputSchema |
      | card:updateComment | id, content | idParamSchema + commentContentSchema |
      | card:deleteComment | id | idParamSchema |
      | card:getRelationships | cardId | idParamSchema |
      | card:addRelationship | input: {sourceCardId, targetCardId, type} | createCardRelationshipInputSchema |
      | card:deleteRelationship | id | idParamSchema |
      | card:getActivities | cardId | idParamSchema |
      | card:getAttachments | cardId | idParamSchema |
      | card:addAttachment | cardId | idParamSchema |
      | card:deleteAttachment | id | idParamSchema |
      | card:openAttachment | filePath | filePathSchema |

      IMPORTANT:
      - cards:move takes 3 separate primitive params, not an object. Validate each individually.
      - card:addComment receives a plain object `{ cardId, content }`, not a typed input.
        Change to `(input: unknown)` and validate with createCardCommentInputSchema.
      - card:addRelationship similarly receives a plain object `{ sourceCardId, targetCardId, type }`.
        Change to `(input: unknown)` and validate with createCardRelationshipInputSchema.
      - card:openAttachment receives a filePath (string), not a UUID.
        Use filePathSchema (not idParamSchema).
      - Keep Card, Label type imports if used for return types or casts.
      - The logCardActivity helper function does NOT need validation (internal call).
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. `npm test` — all tests pass
      3. Every handler in cards.ts that takes params calls validateInput()
      4. No handler uses specific types for incoming data (all params are `unknown`)
      5. Grep for `validateInput` in cards.ts — should find 25+ calls
    </verify>
    <done>
      All 23 handlers in cards.ts validated with Zod schemas. Parameter types changed
      to `unknown` where validation added. TypeScript compiles clean. Pattern consistent
      with projects.ts reference.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - cards:move's 3 separate params can each be validated individually
      - card:addComment and card:addRelationship use plain objects (not typed inputs)
      - filePathSchema for openAttachment is sufficient (path traversal already validated in service)
      - logCardActivity internal helper doesn't need validation
      - buildCardLabelMap import and Card/Label type imports stay (used for return types)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Apply Zod validation to ai-providers.ts, ideas.ts, meetings.ts, and meeting-intelligence.ts</n>
    <files>
      src/main/ipc/ai-providers.ts (MODIFY)
      src/main/ipc/ideas.ts (MODIFY)
      src/main/ipc/meetings.ts (MODIFY)
      src/main/ipc/meeting-intelligence.ts (MODIFY)
    </files>
    <action>
      ## WHY
      These 4 files contain 27 handlers combined. After cards.ts (Task 2), they are
      the next highest-priority files — managing AI providers, ideas, meetings, and
      meeting intelligence. Validating these brings total coverage to 63/112 handlers (~56%).

      ## WHAT

      Apply the same Zod validation pattern to all 4 files. For each file:
      1. Add imports for validateInput + relevant schemas
      2. Remove old type imports replaced by Zod
      3. Change param types to `unknown` and add validateInput()

      ### ai-providers.ts (8 handlers)

      Read the file first. Handlers and their validation:

      | Handler | Params | Validation |
      |---------|--------|------------|
      | ai:list-providers | none | skip |
      | ai:create-provider | data: CreateAIProviderInput | createAIProviderInputSchema |
      | ai:update-provider | id, data: UpdateAIProviderInput | idParamSchema + updateAIProviderInputSchema |
      | ai:delete-provider | id | idParamSchema |
      | ai:test-connection | id | idParamSchema |
      | ai:encryption-available | none | skip |
      | ai:get-usage | none | skip |
      | ai:get-usage-summary | none | skip |

      Remove old type imports: CreateAIProviderInput, UpdateAIProviderInput.
      Keep AIProviderName if used elsewhere in the file (check toAIProvider usage).

      ### ideas.ts (8 handlers)

      | Handler | Params | Validation |
      |---------|--------|------------|
      | ideas:list | none | skip |
      | ideas:get | id: string | idParamSchema |
      | ideas:create | data: any | createIdeaInputSchema |
      | ideas:update | id: string, data: any | idParamSchema + updateIdeaInputSchema |
      | ideas:delete | id: string | idParamSchema |
      | ideas:convert-to-project | id: string | idParamSchema |
      | ideas:convert-to-card | ideaId: string, columnId: string | idParamSchema for both |
      | idea:analyze | id: string | idParamSchema |

      NOTE: ideas:create and ideas:update already use `data: any` — change to `unknown`.

      ### meetings.ts (5 handlers)

      | Handler | Params | Validation |
      |---------|--------|------------|
      | meetings:list | none | skip |
      | meetings:get | id: string | idParamSchema |
      | meetings:create | data: CreateMeetingInput | createMeetingInputSchema |
      | meetings:update | id, data: UpdateMeetingInput | idParamSchema + updateMeetingInputSchema |
      | meetings:delete | id: string | idParamSchema |

      Remove old type imports: CreateMeetingInput, UpdateMeetingInput.

      ### meeting-intelligence.ts (6 handlers)

      | Handler | Params | Validation |
      |---------|--------|------------|
      | meetings:generate-brief | meetingId | idParamSchema |
      | meetings:generate-actions | meetingId | idParamSchema |
      | meetings:get-brief | meetingId | idParamSchema |
      | meetings:get-actions | meetingId | idParamSchema |
      | meetings:update-action-status | id, status: ActionItemStatus | idParamSchema + updateActionItemInputSchema |
      | meetings:convert-action-to-card | actionItemId, columnId | idParamSchema for both |

      For meetings:update-action-status: the second param is a string enum value.
      Wrap it: `const input = validateInput(updateActionItemInputSchema, { status: rawStatus })`.
      Or validate directly: `validateInput(actionItemStatusSchema, status)`.
      The simpler approach (direct enum validation) is preferred.

      Remove old type import: ActionItemStatus.

      IMPORTANT: Read each file BEFORE modifying. The handler signatures above are
      based on my reading but verify against the actual code.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. `npm test` — all tests pass
      3. Grep for `validateInput` in each modified file — confirm all param handlers call it
      4. No handler in these 4 files uses specific types for incoming data
      5. All old type imports removed where replaced by Zod schemas
    </verify>
    <done>
      All 27 handlers across 4 files validated with Zod schemas. Combined with
      projects.ts (13) and cards.ts (23), total validated handlers: 63 of ~112 (~56%).
      Remaining ~49 handlers in 11 smaller files deferred to Plan 8.5.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Handler signatures match what was read during planning (agent verifies)
      - ideas.ts already uses `any` for create/update data (just change to `unknown`)
      - meeting-intelligence.ts update-action-status: direct enum validation is cleaner than wrapping in object
      - AIProviderName type import may still be needed in ai-providers.ts (used in testConnection call)
      - All 4 files are small enough for safe in-place editing
    </assumptions>
  </task>
</phase>
