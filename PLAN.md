# Plan 8.6 — Types Module Split, Test Coverage Expansion & BoardStore Decomposition

**Source:** REVIEW.md findings. Plans 8.1-8.5 addressed the top 5 review priorities (N+1 fix, test framework, README, IPC validation, card reordering) plus structured logging, CSP, component decomposition. Remaining high-impact items: monolithic types.ts (847 lines, 55 importers), low test coverage (12 tests), and bloated boardStore (375 lines, 26 methods).
**Scope:** 3 tasks — all independent (different file domains), safe for parallel execution.
**Approach:** Task 1 splits types.ts into domain modules with barrel re-export (zero import changes). Task 2 adds 20+ tests for schemas, validators, and utilities. Task 3 extracts card detail state from boardStore into a dedicated cardDetailStore.

## Scope Rationale

`shared/types.ts` at 847 lines is the largest file exceeding the 500-line guideline and was flagged as a "merge conflict magnet" and scalability concern. Barrel re-export means all 55 importing files need ZERO changes — the module resolution handles it transparently.

Test coverage at 12 tests (2 files) is still the #1 risk from the review. The Zod validation rollout (Plans 8.3-8.5) created 48 schemas and a validator function — all highly testable pure functions with no Electron dependencies.

boardStore at 375 lines manages 7 entity types (boards, columns, cards, labels, comments, relationships, attachments + activities). The card detail concern (comments, relationships, activities, attachments, breakdown) is cleanly separable.

---

<phase n="8.6" name="Types Module Split, Test Coverage Expansion & BoardStore Decomposition">
  <context>
    Plans 8.1-8.5 completed. Remaining high-impact review items:
    - shared/types.ts: 847 lines, imported by 55 files (architecture concern #2)
    - Test coverage: only 12 tests in 2 files (review priority #1)
    - boardStore.ts: 375 lines, 26+ methods spanning 7 entity types (architecture concern #6)

    Key reference files:
    @src/shared/types.ts — 847 lines, monolithic types file to split
    @src/shared/validation/schemas.ts — 321 lines, 48 schema exports to test
    @src/shared/validation/ipc-validator.ts — validateInput function to test
    @src/renderer/utils/date-utils.ts — getDueDateBadge utility to test
    @src/shared/utils/card-utils.ts — buildCardLabelMap (already tested)
    @src/renderer/stores/boardStore.ts — 375 lines, store to decompose
    @src/renderer/components/CardDetailModal.tsx — primary consumer of card detail state
    @src/renderer/components/CommentsSection.tsx — uses boardStore card detail state
    @src/renderer/components/RelationshipsSection.tsx — uses boardStore card detail state
    @src/renderer/components/AttachmentsSection.tsx — uses boardStore card detail state
    @src/renderer/components/ActivityLog.tsx — uses boardStore card detail state
    @src/renderer/components/TaskBreakdownSection.tsx — uses boardStore card detail state
  </context>

  <task type="auto" n="1">
    <n>Split shared/types.ts into domain-specific modules with barrel re-export</n>
    <files>
      src/shared/types.ts (DELETE after extraction)
      src/shared/types/index.ts (CREATE — barrel re-export)
      src/shared/types/common.ts (CREATE — DatabaseStatus, shared primitives)
      src/shared/types/projects.ts (CREATE — Project, Board, Column, Card, Label + inputs)
      src/shared/types/cards.ts (CREATE — CardComment, CardRelationship, CardActivity, CardAttachment, CardTemplate + inputs)
      src/shared/types/ai.ts (CREATE — AI provider types, AITaskType, generate/stream types)
      src/shared/types/meetings.ts (CREATE — Meeting, Transcript, Recording, Meeting templates + inputs)
      src/shared/types/intelligence.ts (CREATE — ActionItem, MeetingWithTranscript, Diarization, Analytics)
      src/shared/types/ideas.ts (CREATE — Idea, IdeaAnalysis, convert types + inputs)
      src/shared/types/brainstorm.ts (CREATE — BrainstormSession, BrainstormMessage + inputs)
      src/shared/types/backup.ts (CREATE — BackupInfo, ExportOptions, AutoBackupSettings)
      src/shared/types/tasks.ts (CREATE — ProjectPlan, TaskBreakdown, Pillar, Milestone)
      src/shared/types/notifications.ts (CREATE — NotificationPreferences)
      src/shared/types/transcription.ts (CREATE — TranscriptionProvider types)
      src/shared/types/electron-api.ts (CREATE — ElectronAPI interface + Window global)
    </files>
    <action>
      ## WHY
      shared/types.ts at 847 lines is 70% over the 500-line guideline. It's a merge
      conflict magnet and makes it hard to understand type domains. The review flagged it
      as architecture concern #2 and a scalability blocker at 2x features.

      ## WHAT

      1. READ src/shared/types.ts FULLY. Identify all type sections by the existing
         `// === DOMAIN TYPES ===` comments.

      2. Create directory: src/shared/types/

      3. Create domain files. Each file gets:
         - A brief header comment explaining domain
         - The types from that section of the original file
         - Any cross-domain imports (e.g., electron-api.ts imports from all domains)

      Domain mapping (verify against actual file — these are estimates):

      | File | Types (approximate) |
      |------|---------------------|
      | common.ts | DatabaseStatus |
      | projects.ts | Project, Board, Column, Card, CardPriority, Label, Create/Update inputs for all |
      | cards.ts | CardComment, CardRelationship, CardRelationshipType, CardActivity, CardActivityAction, CardAttachment, CardTemplate, CARD_TEMPLATES, Create inputs |
      | ai.ts | AIProviderName, AIProvider, AITaskType, AIUsageLog, TaskModelConfig, DEFAULT_MODELS, CreateAIProviderInput, UpdateAIProviderInput |
      | meetings.ts | Meeting, CreateMeetingInput, UpdateMeetingInput, TranscriptSegment, RecordingState, MeetingTemplateType, MeetingTemplate, MEETING_TEMPLATES, MeetingBrief |
      | intelligence.ts | ActionItem, ActionItemStatus, MeetingWithTranscript, DiarizationWord, DiarizationResult, SpeakerStats, MeetingAnalytics |
      | ideas.ts | Idea, IdeaStatus, EffortLevel, ImpactLevel, IdeaAnalysis, Create/Update/Convert inputs and results |
      | brainstorm.ts | BrainstormSession, BrainstormMessage, BrainstormSessionStatus, BrainstormMessageRole, BrainstormSessionWithMessages, CreateBrainstormSessionInput |
      | backup.ts | BackupInfo, BackupProgress, ExportFormat, ExportOptions, ExportResult, AutoBackupFrequency, AutoBackupSettings |
      | tasks.ts | ProjectPillar, PillarTask, ProjectMilestone, ProjectPlan, SubtaskSuggestion, TaskBreakdown |
      | notifications.ts | NotificationPreferences |
      | transcription.ts | TranscriptionProviderType, TranscriptionProviderConfig, TranscriptionProviderStatus, TranscriberResult |
      | electron-api.ts | ElectronAPI interface + `declare global { interface Window { electronAPI: ElectronAPI } }` |

      4. Create barrel re-export: src/shared/types/index.ts
         ```typescript
         // Barrel re-export — all types available via `from '../../shared/types'`
         export * from './common';
         export * from './projects';
         export * from './cards';
         export * from './ai';
         export * from './meetings';
         export * from './intelligence';
         export * from './ideas';
         export * from './brainstorm';
         export * from './backup';
         export * from './tasks';
         export * from './notifications';
         export * from './transcription';
         export * from './electron-api';
         ```

      5. DELETE the original src/shared/types.ts file.

      6. Verify all 55 importing files resolve correctly. The import path
         `from '../../shared/types'` resolves to `types/index.ts` when `types.ts`
         no longer exists. TypeScript module resolution checks types.ts first,
         then types/index.ts.

      IMPORTANT:
      - DO NOT change any import paths in consuming files. The barrel re-export
        ensures backward compatibility.
      - The electron-api.ts file must import types from sibling domain files
        (e.g., `import type { Project } from './projects'`) to define ElectronAPI.
      - MEETING_TEMPLATES and CARD_TEMPLATES are runtime values (const arrays),
        not just types — they must be in their respective domain files.
      - Handle cross-references carefully. Some types reference others:
        ActionItem references Card-like fields, MeetingWithTranscript references
        Meeting + TranscriptSegment + ActionItem, etc.
      - The existing test file `src/shared/__tests__/types.test.ts` imports from
        `../../shared/types` — it should still work without changes.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. `npm test` — all 12 tests pass (types.test.ts still works)
      3. src/shared/types.ts no longer exists (deleted)
      4. src/shared/types/index.ts exists (barrel re-export)
      5. 12-14 domain type files in src/shared/types/ directory
      6. No file in the project imports from individual domain files
         (all imports go through barrel: `from '../../shared/types'`)
    </verify>
    <done>
      shared/types.ts (847 lines) split into 12-14 domain modules with barrel
      re-export. All 55 importing files continue working without changes. Each
      domain file is under 100 lines. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - TypeScript module resolution resolves `shared/types` → `shared/types/index.ts` when types.ts is deleted
      - Vite/Electron Forge bundler handles the same resolution
      - Cross-domain type references are limited (most types are self-contained within domains)
      - MEETING_TEMPLATES and CARD_TEMPLATES can move to domain files without issues
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Expand test coverage — Zod schemas, IPC validator, and utility tests</n>
    <files>
      src/shared/validation/__tests__/schemas.test.ts (CREATE — ~200 lines)
      src/shared/validation/__tests__/ipc-validator.test.ts (CREATE — ~80 lines)
      src/renderer/utils/__tests__/date-utils.test.ts (CREATE — ~60 lines)
    </files>
    <action>
      ## WHY
      Test coverage at 12 tests (2 files) is still the #1 review risk. Plans 8.3-8.5
      added 48 Zod schemas and a validation wrapper — all pure functions that are
      highly testable without Electron mocking. Adding schema tests ensures the
      validation we rolled out actually rejects bad input correctly.

      ## WHAT

      ### 1. Schema validation tests (schemas.test.ts, ~200 lines)

      Test each important schema for both valid and invalid inputs:

      **Primitive/common schemas:**
      - idParamSchema: valid UUID passes, non-UUID rejects, empty string rejects
      - settingKeySchema: valid passes, empty rejects, 201+ chars rejects
      - filePathSchema: valid passes, empty rejects

      **Enum schemas (sample 3-4):**
      - cardPrioritySchema: 'low'/'medium'/'high'/'urgent' pass, 'invalid' rejects
      - ideaStatusSchema: valid values pass, invalid rejects
      - meetingTemplateTypeSchema: all 6 values pass, invalid rejects
      - aiProviderNameSchema: 'openai'/'anthropic'/'ollama' pass, 'invalid' rejects

      **Object schemas (sample 5-6 most important):**
      - createProjectInputSchema: valid passes, missing name rejects, name too long rejects
      - createCardInputSchema: valid passes, missing columnId rejects, non-UUID columnId rejects
      - updateCardInputSchema: empty object passes (all optional), invalid priority rejects
      - createIdeaInputSchema: valid passes, too many tags rejects (>20)
      - createMeetingInputSchema: valid passes, invalid template rejects
      - exportOptionsSchema: valid JSON format passes, invalid format rejects

      **New schemas from Plan 8.5:**
      - taskStructuringNameSchema: valid passes, empty rejects, 501+ chars rejects
      - taskStructuringDescriptionSchema: valid passes, 10001+ chars rejects
      - whisperModelNameSchema: valid passes, empty rejects

      ### 2. IPC validator tests (ipc-validator.test.ts, ~80 lines)

      - validateInput with valid data returns parsed result
      - validateInput with invalid data throws Error
      - Error message contains field path
      - Error message contains validation issue description
      - Nested object validation works (e.g., object with UUID field)
      - Optional fields work (undefined passes, null fails where not nullable)

      ### 3. Date utility tests (date-utils.test.ts, ~60 lines)

      - getDueDateBadge with past date returns overdue (red)
      - getDueDateBadge with today returns "Due today" (yellow)
      - getDueDateBadge with future date returns "Due in Nd" (blue)
      - getDueDateBadge with null returns null
      - getDueDateBadge boundary: yesterday, tomorrow

      IMPORTANT:
      - Use Vitest (already configured): `import { describe, it, expect } from 'vitest'`
      - Import schemas and validateInput directly (pure functions, no Electron deps)
      - For date-utils, may need to mock Date.now() for deterministic tests
      - Create __tests__ directories as needed
      - Target: 25-30 new tests minimum
    </action>
    <verify>
      1. `npm test` — all tests pass (12 existing + 25-30 new = 37-42 total)
      2. `npx tsc --noEmit` — zero TypeScript errors
      3. 3 new test files exist in correct directories
      4. At least 25 new tests added (verify with test count output)
    </verify>
    <done>
      Test count tripled from 12 to 37-42. Schema validation tests ensure the
      Zod rollout actually catches bad input. Utility tests cover date formatting.
      IPC validator tests confirm error messaging.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Vitest is configured and working (verified in Plan 8.1)
      - Zod schemas are importable without Electron environment
      - date-utils getDueDateBadge is a pure function (or needs minimal mocking)
      - Schema tests can use inline test data (no external fixtures needed)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Decompose boardStore — extract cardDetailStore for card sub-entity state</n>
    <files>
      src/renderer/stores/boardStore.ts (MODIFY — 375 → ~220 lines)
      src/renderer/stores/cardDetailStore.ts (CREATE — ~170 lines)
      src/renderer/components/CardDetailModal.tsx (MODIFY — update store import)
      src/renderer/components/CommentsSection.tsx (MODIFY — update store import)
      src/renderer/components/RelationshipsSection.tsx (MODIFY — update store import)
      src/renderer/components/AttachmentsSection.tsx (MODIFY — update store import)
      src/renderer/components/ActivityLog.tsx (MODIFY — update store import)
      src/renderer/components/TaskBreakdownSection.tsx (MODIFY — update store import)
    </files>
    <action>
      ## WHY
      boardStore at 375 lines with 26+ methods manages 7 entity types across 2 concerns:
      1. Board-level: project, board, columns, cards, labels (core Kanban)
      2. Card detail: comments, relationships, activities, attachments (selected card)

      The review flagged it as architecture concern #6: "2-6x more complex than other
      stores." Splitting along this natural boundary makes each store focused and testable.

      ## WHAT

      ### 1. Create cardDetailStore.ts (~170 lines)

      Move from boardStore to cardDetailStore:

      **State fields:**
      - selectedCardComments: CardComment[]
      - selectedCardRelationships: CardRelationship[]
      - selectedCardActivities: CardActivity[]
      - selectedCardAttachments: CardAttachment[]
      - loadingCardDetails: boolean

      **Actions (move entirely):**
      - loadCardDetails(cardId: string) — loads all 4 collections in parallel
      - clearCardDetails() — resets all to empty/false
      - addComment(input) — creates comment via IPC, refreshes list
      - updateComment(id, content) — updates via IPC, refreshes list
      - deleteComment(id) — deletes via IPC, refreshes list
      - addRelationship(input) — creates via IPC, refreshes list
      - deleteRelationship(id) — deletes via IPC, refreshes list
      - addAttachment(cardId) — adds via IPC (file dialog), refreshes list
      - deleteAttachment(id) — deletes via IPC, refreshes list
      - openAttachment(filePath) — opens via IPC

      Store interface:
      ```typescript
      interface CardDetailStore {
        selectedCardComments: CardComment[];
        selectedCardRelationships: CardRelationship[];
        selectedCardActivities: CardActivity[];
        selectedCardAttachments: CardAttachment[];
        loadingCardDetails: boolean;

        loadCardDetails: (cardId: string) => Promise<void>;
        clearCardDetails: () => void;
        addComment: (input: CreateCardCommentInput) => Promise<void>;
        updateComment: (id: string, content: string) => Promise<void>;
        deleteComment: (id: string) => Promise<void>;
        addRelationship: (input: CreateCardRelationshipInput) => Promise<void>;
        deleteRelationship: (id: string) => Promise<void>;
        addAttachment: (cardId: string) => Promise<void>;
        deleteAttachment: (id: string) => Promise<void>;
        openAttachment: (filePath: string) => Promise<void>;
      }

      export const useCardDetailStore = create<CardDetailStore>((set, get) => ({
        // ... move implementations from boardStore
      }));
      ```

      ### 2. Update boardStore.ts (~220 lines)

      Remove all card detail state and actions. boardStore keeps:
      - project, board, columns, cards, labels, loading, error
      - loadBoard, addColumn, updateColumn, deleteColumn, reorderColumns
      - addCard, updateCard, deleteCard, moveCard
      - loadLabels, createLabel, deleteLabel, attachLabel, detachLabel

      Remove from interface and implementation:
      - selectedCardComments, selectedCardRelationships, selectedCardActivities,
        selectedCardAttachments, loadingCardDetails
      - loadCardDetails, clearCardDetails
      - addComment, updateComment, deleteComment
      - addRelationship, deleteRelationship
      - addAttachment, deleteAttachment, openAttachment

      ### 3. Update consuming components

      READ each component before modifying. Replace `useBoardStore` with
      `useCardDetailStore` for card detail operations:

      - **CardDetailModal.tsx**: Change imports. `useBoardStore` for board-level
        state (cards, columns, labels, updateCard, deleteCard, attachLabel, etc.).
        `useCardDetailStore` for loadCardDetails, clearCardDetails, and all
        card detail sub-entity state.

      - **CommentsSection.tsx**: Change to `useCardDetailStore` for
        selectedCardComments, addComment, updateComment, deleteComment.

      - **RelationshipsSection.tsx**: Change to `useCardDetailStore` for
        selectedCardRelationships, addRelationship, deleteRelationship.

      - **AttachmentsSection.tsx**: Change to `useCardDetailStore` for
        selectedCardAttachments, addAttachment, deleteAttachment, openAttachment.

      - **ActivityLog.tsx**: Change to `useCardDetailStore` for
        selectedCardActivities.

      - **TaskBreakdownSection.tsx**: Check if it uses any card detail state.
        If so, update. If it only uses boardStore for addCard/board-level ops, leave.

      IMPORTANT:
      - DO NOT change any behavior — this is a pure structural refactor
      - Preserve the exact same IPC calls and state management patterns
      - The two stores are independent (no cross-store communication needed)
      - loadCardDetails in the new store should be a standalone implementation
        (copy from boardStore, don't import from it)
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. `npm test` — all tests pass
      3. boardStore.ts is under 250 lines
      4. cardDetailStore.ts exists and is under 200 lines
      5. No card detail state remains in boardStore (grep for selectedCard)
      6. All 6 consumer components import from correct store
    </verify>
    <done>
      boardStore decomposed from 375 to ~220 lines. cardDetailStore (~170 lines)
      manages comments, relationships, activities, and attachments independently.
      All consumer components updated. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Card detail state has no cross-dependencies with board-level state
      - loadCardDetails implementation can be copied (no shared helper needed)
      - CommentsSection, RelationshipsSection, AttachmentsSection, ActivityLog use
        only card detail state from boardStore (no board-level state mixed in)
      - TaskBreakdownSection may use boardStore for addCard — needs verification
    </assumptions>
  </task>
</phase>
