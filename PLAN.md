# Plan 7.4 — AI Task Structuring Engine

**Requirement:** R11 — Task Structuring Engine (8 points)
**Scope:** AI-assisted project planning with pillars, task breakdown, dependencies, and production-focused templates
**Approach:** Transient AI output (not persisted in new DB tables) — user reviews suggestions and applies them as real boards/columns/cards

## Phase 7 Overview

Phase 7 covers R11, R13, R14, R15, R16, R17 (31 pts total, v2 features).
Planned as 8 sequential plans:

| Plan | Requirement | Focus |
|------|-------------|-------|
| 7.1 | R16 (backend) | Card comments, relationships, activity log — schema + services + IPC |
| 7.2 | R16 (UI) | Comments UI, relationships UI, activity log, card templates in CardDetailModal |
| 7.3 | R15 | Database backup/restore (pg_dump), JSON/CSV export, backup UI |
| **7.4** | **R11** | **AI task structuring — service, IPC, store, project planning modal, card breakdown** |
| 7.5 | R13+R17 | Meeting templates, notifications, daily digest |
| 7.6 | R14 | API transcription providers (Deepgram, AssemblyAI), fallback |
| 7.7 | R13 | Meeting analytics, speaker diarization, advanced features |
| 7.8 | R16 (rest) | Card attachments, due dates, reminders |

## Architecture Decisions

1. **Transient AI output (no new DB tables):** The AI generates project plans and task breakdowns as JSON that the user reviews in a modal. Accepted suggestions are converted to real boards/columns/cards via existing services. This follows the idea analysis pattern — keeps things simple, avoids schema bloat for ephemeral data.

2. **Two AI operations:**
   - `generateProjectPlan(projectId, description)` — Generates production-focused pillars (e.g., Architecture, Security, Scalability, Testing, DevOps), each with suggested tasks. Also generates milestones with task groupings.
   - `generateTaskBreakdown(cardId)` — Breaks a single card into subtasks with effort estimates and dependency suggestions.

3. **Non-streaming generation:** Both operations use `generate()` (not `streamGenerate()`) because the output must be parsed as structured JSON. User sees a loading spinner, then the full result. This matches the idea analysis and meeting brief patterns.

4. **New task type: `task_structuring`** — Added to `AITaskType` union and `resolveTaskModel`. Users can assign a specific provider/model for task structuring via the existing per-task model config UI in Settings.

5. **Apply actions use existing services:** Applying a plan creates boards/columns/cards through the existing `boardStore` actions and IPC handlers. No new DB operations needed.

6. **System prompts are production-focused:** The AI is instructed to think about architecture, security, scalability, testing, CI/CD, monitoring — not just feature work. This is R11's key differentiator from generic task management.

---

<phase n="7.4" name="AI Task Structuring Engine">
  <context>
    Phase 7, Plan 4 of 8. Implements R11: Task Structuring Engine (8 pts).

    R11 requirements:
    - AI-assisted project planning when starting new projects
    - Generates project pillars (architecture, security, scalability, etc.)
    - Suggests task breakdown and dependencies
    - Production-focused templates and checklists
    - Sprint/milestone planning assistance

    Existing AI infrastructure:
    - ai-provider.ts: generate(), streamGenerate(), resolveTaskModel(), logUsage()
    - AITaskType: 'summarization' | 'brainstorming' | 'task_generation' | 'idea_analysis'
    - Pattern: resolveTaskModel(taskType) → generate({...provider, prompt, system}) → parse JSON → logUsage()
    - IPC handlers follow modular pattern: src/main/ipc/[feature].ts → registerXyzHandlers()
    - Zustand stores in src/renderer/stores/
    - Modals follow CardDetailModal/IdeaDetailModal patterns

    Key files for context injection:
    - projects table: id, name, description, color, archived
    - boards table: id, projectId, name, position
    - columns table: id, boardId, name, position
    - cards table: id, columnId, title, description, position, priority, dueDate, archived

    @src/main/services/ai-provider.ts (generate, resolveTaskModel, logUsage)
    @src/main/services/ideaService.ts (analyzeIdea pattern — JSON AI response with fallback parsing)
    @src/main/services/meetingIntelligenceService.ts (generateBrief + generateActions patterns)
    @src/main/ipc/index.ts (handler registration)
    @src/shared/types.ts (AITaskType, ElectronAPI)
    @src/preload/preload.ts (bridge pattern)
    @src/renderer/pages/ProjectsPage.tsx (project list — add "Plan with AI" button)
    @src/renderer/components/CardDetailModal.tsx (card detail — add "Break Down" button)
    @src/renderer/stores/boardStore.ts (existing card/board actions for applying plan)
    @src/renderer/stores/projectStore.ts (project CRUD)
  </context>

  <task type="auto" n="1">
    <n>Task structuring types, service, IPC handlers, and preload bridge</n>
    <files>
      src/shared/types.ts (MODIFY — add task structuring types + 3 ElectronAPI methods)
      src/main/services/taskStructuringService.ts (NEW ~250 lines)
      src/main/ipc/task-structuring.ts (NEW ~60 lines)
      src/main/ipc/index.ts (MODIFY — register new handlers)
      src/preload/preload.ts (MODIFY — add 3 bridge methods)
    </files>
    <action>
      ## WHY
      R11 requires AI-assisted project planning with production-focused pillars and task breakdown.
      This task builds the backend: AI service with two generation functions, IPC handlers,
      shared types, and preload bridge. Following the established ideaService.analyzeIdea pattern
      for structured JSON generation with fallback parsing.

      ## WHAT

      ### 1a. Types — add to src/shared/types.ts

      Update the AITaskType union to include 'task_structuring':
      ```typescript
      export type AITaskType = 'summarization' | 'brainstorming' | 'task_generation' | 'idea_analysis' | 'task_structuring';
      ```

      Add these types (place before the ElectronAPI interface, after existing AI types):

      ```typescript
      // === TASK STRUCTURING TYPES ===

      export interface ProjectPillar {
        name: string;           // e.g. "Architecture", "Security", "Testing"
        description: string;    // Brief explanation of pillar's focus
        tasks: PillarTask[];    // Suggested tasks under this pillar
      }

      export interface PillarTask {
        title: string;
        description: string;
        priority: 'low' | 'medium' | 'high' | 'urgent';
        effort: 'small' | 'medium' | 'large';  // T-shirt sizing
        dependencies?: string[];  // titles of other tasks this depends on
      }

      export interface ProjectMilestone {
        name: string;
        description: string;
        taskTitles: string[];   // references to PillarTask titles
      }

      export interface ProjectPlan {
        pillars: ProjectPillar[];
        milestones: ProjectMilestone[];
        summary: string;        // High-level plan overview
      }

      export interface SubtaskSuggestion {
        title: string;
        description: string;
        priority: 'low' | 'medium' | 'high' | 'urgent';
        effort: 'small' | 'medium' | 'large';
        order: number;          // suggested execution order
      }

      export interface TaskBreakdown {
        subtasks: SubtaskSuggestion[];
        notes: string;          // Additional context/reasoning from AI
      }
      ```

      Add to ElectronAPI interface:
      ```typescript
      // Task Structuring
      taskStructuringGeneratePlan: (projectId: string, description: string) => Promise<ProjectPlan>;
      taskStructuringBreakdown: (cardId: string) => Promise<TaskBreakdown>;
      taskStructuringQuickPlan: (projectName: string, projectDescription: string) => Promise<ProjectPlan>;
      ```

      The third method (`quickPlan`) allows generating a plan for a new project that doesn't
      exist yet — user provides name+description directly, no projectId needed. This supports
      the "plan before creating" workflow.

      ### 1b. Create src/main/services/taskStructuringService.ts

      File header:
      ```
      // === FILE PURPOSE ===
      // AI task structuring service — generates project plans with production-focused
      // pillars and breaks down cards into subtasks. Uses the generate() wrapper from
      // ai-provider.ts for structured JSON output.
      //
      // === DEPENDENCIES ===
      // - ai-provider.ts (generate, resolveTaskModel, logUsage)
      // - Database connection for loading project/card context
      //
      // === LIMITATIONS ===
      // - Generated plans are transient (not persisted in DB)
      // - JSON parsing has fallback but may fail on very malformed AI output
      // - Depends on AI provider being configured for 'task_structuring' task type
      ```

      Imports:
      ```typescript
      import { eq } from 'drizzle-orm';
      import { getDb } from '../db/connection';
      import { projects, boards, columns, cards } from '../db/schema';
      import { generate, resolveTaskModel, logUsage } from './ai-provider';
      import type { ProjectPlan, TaskBreakdown } from '../../shared/types';
      ```

      System prompts (define as constants at module level):

      ```typescript
      const PROJECT_PLAN_SYSTEM_PROMPT = `You are a senior software architect and project planner.
      Your job is to create a production-focused project plan with clear pillars, tasks, and milestones.

      You MUST focus on production-readiness pillars:
      - Architecture: System design, data models, API design, scalability patterns
      - Security: Authentication, authorization, input validation, data protection
      - Testing: Unit tests, integration tests, E2E tests, test infrastructure
      - DevOps: CI/CD pipeline, deployment, monitoring, logging, alerting
      - Performance: Optimization, caching, load handling, resource management
      - Documentation: API docs, architecture docs, onboarding guides

      Not every project needs all pillars. Choose the relevant ones based on the project description.
      Typically 3-5 pillars are appropriate.

      Each task should be specific and actionable (not vague like "implement security").
      Include effort estimates (small/medium/large) and priority levels.
      Identify dependencies between tasks where they exist.

      Group tasks into 2-4 milestones representing logical delivery phases.

      Respond with ONLY valid JSON matching this structure:
      {
        "summary": "Brief plan overview",
        "pillars": [
          {
            "name": "Pillar Name",
            "description": "What this pillar covers",
            "tasks": [
              {
                "title": "Specific task title",
                "description": "What needs to be done and why",
                "priority": "high",
                "effort": "medium",
                "dependencies": ["Other task title if any"]
              }
            ]
          }
        ],
        "milestones": [
          {
            "name": "Milestone 1: Foundation",
            "description": "What this milestone achieves",
            "taskTitles": ["Task title 1", "Task title 2"]
          }
        ]
      }`;

      const TASK_BREAKDOWN_SYSTEM_PROMPT = `You are a senior developer breaking down a task into subtasks.
      Given a card title, description, and project context, create specific, actionable subtasks.

      Each subtask should be:
      - Small enough to complete in one focused session (1-4 hours)
      - Specific and testable (not vague)
      - Ordered logically (dependencies reflected in order)

      Include effort estimates (small = <1h, medium = 1-4h, large = 4-8h).

      Respond with ONLY valid JSON matching this structure:
      {
        "subtasks": [
          {
            "title": "Specific subtask title",
            "description": "What to do",
            "priority": "medium",
            "effort": "small",
            "order": 1
          }
        ],
        "notes": "Additional context or considerations"
      }`;
      ```

      Exports:

      **`generateProjectPlan(projectId: string, additionalDescription?: string): Promise<ProjectPlan>`**
      1. Load project from DB: `db.select().from(projects).where(eq(projects.id, projectId))`
      2. If not found, throw Error('Project not found')
      3. Load boards for project: `db.select().from(boards).where(eq(boards.projectId, projectId))`
      4. For each board, load columns: `db.select().from(columns).where(eq(columns.boardId, board.id))`
      5. For each column, load non-archived cards (titles only, for context)
      6. Build context string:
         ```
         Project: {name}
         Description: {description}
         {additionalDescription ? `Additional context: ${additionalDescription}` : ''}
         Existing boards: {board names with column names}
         Existing cards: {card titles per column, up to 10 per board}
         ```
      7. Resolve provider: `const provider = await resolveTaskModel('task_structuring')`
      8. If null, throw Error('No AI provider configured. Please set up an AI provider in Settings.')
      9. Call generate:
         ```typescript
         const result = await generate({
           providerId: provider.providerId,
           providerName: provider.providerName,
           apiKeyEncrypted: provider.apiKeyEncrypted,
           baseUrl: provider.baseUrl,
           model: provider.model,
           taskType: 'task_structuring',
           system: PROJECT_PLAN_SYSTEM_PROMPT,
           prompt: contextString,
           temperature: provider.temperature ?? 0.4,
           maxTokens: provider.maxTokens ?? 4096,
         });
         ```
      10. Parse JSON response with fallback:
          ```typescript
          let plan: ProjectPlan;
          try {
            // Try to extract JSON from response (may have markdown fences)
            const jsonStr = result.text.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
            plan = JSON.parse(jsonStr);
          } catch {
            throw new Error('Failed to parse AI response as project plan. Please try again.');
          }
          ```
      11. Validate structure: ensure pillars is array, each has name+tasks, etc.
          If invalid, throw Error with descriptive message.
      12. Log usage (fire-and-forget):
          ```typescript
          logUsage(provider.providerId, provider.model, 'task_structuring', result.usage).catch(() => {});
          ```
      13. Return plan

      **`generateQuickPlan(projectName: string, projectDescription: string): Promise<ProjectPlan>`**
      1. Same as generateProjectPlan but doesn't load from DB
      2. Build context: `Project: ${projectName}\nDescription: ${projectDescription}`
      3. Same generate + parse + validate + logUsage flow
      4. Return plan

      **`generateTaskBreakdown(cardId: string): Promise<TaskBreakdown>`**
      1. Load card from DB: `db.select().from(cards).where(eq(cards.id, cardId))`
      2. If not found, throw Error('Card not found')
      3. Load column → board → project for context
      4. Load sibling cards (same column) for context
      5. Build context:
         ```
         Project: {projectName}
         Board: {boardName}
         Column: {columnName}

         Card: {card.title}
         Description: {card.description || 'No description'}
         Priority: {card.priority}

         Other cards in this column: {sibling card titles}
         ```
      6. Resolve provider, generate, parse JSON, validate, logUsage
      7. Return TaskBreakdown

      ### 1c. Create src/main/ipc/task-structuring.ts

      ```typescript
      import { ipcMain } from 'electron';
      import { generateProjectPlan, generateQuickPlan, generateTaskBreakdown } from '../services/taskStructuringService';

      export function registerTaskStructuringHandlers(): void {
        ipcMain.handle('task-structuring:generate-plan', async (_event, projectId: string, description?: string) => {
          return generateProjectPlan(projectId, description);
        });

        ipcMain.handle('task-structuring:quick-plan', async (_event, name: string, description: string) => {
          return generateQuickPlan(name, description);
        });

        ipcMain.handle('task-structuring:breakdown', async (_event, cardId: string) => {
          return generateTaskBreakdown(cardId);
        });
      }
      ```

      ### 1d. Register in src/main/ipc/index.ts

      Add import: `import { registerTaskStructuringHandlers } from './task-structuring';`
      Add call: `registerTaskStructuringHandlers();` in registerIpcHandlers

      ### 1e. Extend src/preload/preload.ts

      Add to the electronAPI object:
      ```typescript
      // Task Structuring
      taskStructuringGeneratePlan: (projectId: string, description: string) =>
        ipcRenderer.invoke('task-structuring:generate-plan', projectId, description),
      taskStructuringBreakdown: (cardId: string) =>
        ipcRenderer.invoke('task-structuring:breakdown', cardId),
      taskStructuringQuickPlan: (name: string, description: string) =>
        ipcRenderer.invoke('task-structuring:quick-plan', name, description),
      ```
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. 'task_structuring' is in AITaskType union
      3. taskStructuringService.ts exports: generateProjectPlan, generateQuickPlan, generateTaskBreakdown
      4. System prompts explicitly mention production-focused pillars
      5. JSON parsing includes markdown fence stripping and error handling
      6. task-structuring.ts IPC handlers: 3 channels registered
      7. ElectronAPI has 3 new methods
      8. preload.ts has 3 matching bridge methods
      9. ipc/index.ts imports and calls registerTaskStructuringHandlers()
    </verify>
    <done>Complete backend for AI task structuring: service with two AI generation functions (project plan + card breakdown), 3 IPC channels, types, and preload bridge. TypeScript compiles cleanly.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - generate() from ai-provider.ts works for task_structuring task type (same as summarization/idea_analysis)
      - AI providers return valid JSON when prompted with structured instructions (with fallback parsing)
      - 4096 max tokens is sufficient for project plans (typical plan is ~2000 tokens)
      - Temperature 0.4 balances creativity with structure (lower than brainstorming's 0.7)
      - Column → board → project traversal via Drizzle joins works (standard foreign key relationships)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Task structuring store and project planning modal UI</n>
    <files>
      src/renderer/stores/taskStructuringStore.ts (NEW ~80 lines)
      src/renderer/components/ProjectPlanningModal.tsx (NEW ~400 lines)
      src/renderer/pages/ProjectsPage.tsx (MODIFY — add "Plan with AI" button to project cards)
    </files>
    <action>
      ## WHY
      Users need a visual interface to trigger AI project planning, review the generated
      pillars/milestones/tasks, and apply suggestions as real boards and cards. The modal
      should present the plan clearly and allow selective application.

      ## WHAT

      ### 2a. Create src/renderer/stores/taskStructuringStore.ts

      Zustand store for task structuring state:

      ```typescript
      interface TaskStructuringState {
        // Project plan
        plan: ProjectPlan | null;
        planLoading: boolean;
        planError: string | null;
        // Card breakdown
        breakdown: TaskBreakdown | null;
        breakdownLoading: boolean;
        breakdownError: string | null;
        // Actions
        generatePlan: (projectId: string, description?: string) => Promise<void>;
        generateQuickPlan: (name: string, description: string) => Promise<void>;
        generateBreakdown: (cardId: string) => Promise<void>;
        clearPlan: () => void;
        clearBreakdown: () => void;
      }
      ```

      Implementation:
      - generatePlan: sets planLoading=true, calls electronAPI.taskStructuringGeneratePlan,
        sets plan on success, sets planError on failure, planLoading=false
      - generateQuickPlan: same flow but calls electronAPI.taskStructuringQuickPlan
      - generateBreakdown: sets breakdownLoading=true, calls electronAPI.taskStructuringBreakdown,
        sets breakdown on success, sets breakdownError on failure
      - clearPlan: resets plan/planLoading/planError to initial values
      - clearBreakdown: resets breakdown/breakdownLoading/breakdownError to initial values
      - Error messages: extract from error (e.message or 'Failed to generate plan')

      ### 2b. Create src/renderer/components/ProjectPlanningModal.tsx

      Full-screen overlay modal for AI project planning. Triggered from ProjectsPage.

      Props:
      ```typescript
      interface ProjectPlanningModalProps {
        projectId: string;
        projectName: string;
        onClose: () => void;
        onApply: (pillars: ProjectPillar[]) => Promise<void>;
      }
      ```

      Structure (visual layout):
      ```
      ┌─ AI Project Planning ────────────────────────────────[×]─┐
      │                                                           │
      │  Planning for: {projectName}                              │
      │  ┌──────────────────────────────────────────────────────┐ │
      │  │ Additional context (optional):                        │ │
      │  │ [textarea for extra instructions to AI]               │ │
      │  └──────────────────────────────────────────────────────┘ │
      │  [Generate Plan] (or [Regenerate] if plan exists)         │
      │                                                           │
      │  ── Loading State ──                                      │
      │  ◐ Generating project plan... (with spinner)              │
      │                                                           │
      │  ── Error State ──                                        │
      │  ⚠ Error message. Check AI provider settings. [Retry]    │
      │                                                           │
      │  ── Plan Results (when plan loaded) ──                    │
      │                                                           │
      │  Summary: {plan.summary}                                  │
      │                                                           │
      │  ┌─ Pillars (tabs or accordion) ───────────────────────┐ │
      │  │ [Architecture] [Security] [Testing] [DevOps]         │ │
      │  │                                                       │ │
      │  │ Architecture — System design and data models          │ │
      │  │                                                       │ │
      │  │  ☑ Design database schema        HIGH  Medium         │ │
      │  │  ☑ Set up API layer              HIGH  Large          │ │
      │  │  ☑ Define data models            MED   Small          │ │
      │  │    → depends on: Design database schema               │ │
      │  └───────────────────────────────────────────────────────┘ │
      │                                                           │
      │  ┌─ Milestones ───────────────────────────────────────┐   │
      │  │ M1: Foundation — Core infrastructure                │   │
      │  │   • Design database schema                          │   │
      │  │   • Set up API layer                                │   │
      │  │                                                     │   │
      │  │ M2: Features — Main functionality                   │   │
      │  │   • Implement user flows                            │   │
      │  └─────────────────────────────────────────────────────┘   │
      │                                                           │
      │  [Apply Plan — Create Board & Cards]         [Cancel]     │
      └───────────────────────────────────────────────────────────┘
      ```

      State (local):
      - `additionalContext: string` — textarea value for extra context to AI
      - `selectedTasks: Set<string>` — task titles that are selected for apply (all selected by default)

      Behavior:
      - **On mount**: Don't auto-generate. Wait for user to click Generate.
      - **Generate/Regenerate button**: calls taskStructuringStore.generatePlan(projectId, additionalContext).
        Text changes to "Regenerate" after first plan is loaded.
      - **Pillars display**: Tab-based navigation between pillars.
        Each pillar shows its name, description, and task list.
        Each task has a checkbox (for selective apply), title, priority badge, effort badge.
        Dependencies shown as small text below task: "→ depends on: X, Y"
      - **Milestones**: Read-only section showing milestone names and their task groupings.
        Informational only (milestones don't map to DB entities).
      - **Apply button**: Creates a new board named "AI Plan — {date}" on the project.
        For each pillar: creates a column named after the pillar.
        For each selected task in that pillar: creates a card in the column.
        Card priority = task.priority, description = task.description.
        After apply: close modal.
        The onApply callback handles the actual creation:
        ```typescript
        // In ProjectsPage, the onApply handler:
        async function handleApplyPlan(pillars: ProjectPillar[]) {
          const board = await boardStore.createBoard(projectId, 'AI Plan');
          for (const pillar of pillars) {
            const column = await boardStore.createColumn(board.id, pillar.name);
            for (const task of pillar.tasks) {
              if (selectedTasks.has(task.title)) {
                await boardStore.createCard(column.id, {
                  title: task.title,
                  description: task.description,
                  priority: task.priority,
                });
              }
            }
          }
        }
        ```
        Wait — the apply logic with selected tasks should live inside the modal since
        it knows which tasks are selected. Actually, make onApply simpler: the modal
        filters to selected tasks and passes filtered pillars to onApply. The parent
        (ProjectsPage) handles board/column/card creation.

        Actually, it's cleaner if the modal does the apply itself since it has access to
        boardStore and knows selected tasks. Change props to not need onApply:
        ```typescript
        interface ProjectPlanningModalProps {
          projectId: string;
          projectName: string;
          onClose: () => void;
        }
        ```
        The modal imports boardStore directly and handles apply internally.

      - **Cancel/Close**: Calls clearPlan() + onClose(). Escape key and overlay click also close.
      - **Empty state**: "Generate an AI-powered project plan with production-focused pillars."
      - **Priority badges**: Same color coding as CardDetailModal (emerald=low, blue=med, amber=high, red=urgent)
      - **Effort badges**: Small grey badges: "S" / "M" / "L"

      Styling:
      - Modal: `fixed inset-0 z-50 bg-black/50` overlay, `max-w-4xl max-h-[85vh] overflow-y-auto`
      - Section headers: `text-lg font-semibold text-surface-100`
      - Tabs: horizontal button row with active state (underline or bg highlight)
      - Task rows: `bg-surface-800/50 rounded-lg px-4 py-2` with flex layout
      - Apply button: `bg-primary-600 hover:bg-primary-500` (primary action)
      - Cancel: `text-surface-400 hover:text-surface-200` (text button)

      Lucide icons to import: X (close), Brain or Sparkles (AI indicator), Check (apply),
      RefreshCw (regenerate), AlertCircle (error), Loader2 (spinner)

      ### 2c. Modify ProjectsPage.tsx

      Add "Plan with AI" button to each project card in the grid:
      1. Import: `ProjectPlanningModal`, `Brain` (or `Sparkles`) from lucide-react
      2. Add local state: `planningProjectId: string | null` (which project's modal is open)
      3. On each project card, add a small button: sparkle/brain icon + "Plan" tooltip
         Position: top-right corner of the card, or in the card footer action row
      4. On click: `setPlanningProjectId(project.id)`
      5. When planningProjectId is set, render:
         ```tsx
         {planningProjectId && (
           <ProjectPlanningModal
             projectId={planningProjectId}
             projectName={projects.find(p => p.id === planningProjectId)?.name || ''}
             onClose={() => setPlanningProjectId(null)}
           />
         )}
         ```
      6. Also add "Plan with AI" to the project creation flow: after creating a new project,
         offer to open the planning modal. This can be a simple button in the create confirmation
         or auto-open if the user checks a box.

         Simpler approach: just add the button on the card. Users can click it right after creating.

      Note: The modal needs access to boardStore for creating boards/columns/cards.
      Import useBoardStore or use window.electronAPI directly in the modal.
      Prefer using boardStore for consistency with existing patterns.
      BUT boardStore.createBoard/createColumn/createCard may not exist directly...

      Check: boardStore currently has createCard, moveCard, updateCard, deleteCard,
      and board/column operations are likely in projectStore or via IPC.
      The modal should use electronAPI directly for board/column creation since boardStore
      is scoped to the currently loaded board view.

      Actually, looking at the architecture:
      - Board CRUD goes through IPC: 'boards:create', 'boards:list', etc.
      - Column CRUD: 'columns:create', etc.
      - Card CRUD: 'cards:create', etc.

      The modal should call electronAPI.boardCreate, electronAPI.columnCreate,
      electronAPI.cardCreate directly (these exist in the preload bridge).

      Verify these methods exist in ElectronAPI:
      - boardCreate(projectId, name): creates board
      - columnCreate(boardId, name): creates column
      - cardCreate(columnId, data): creates card

      If not, the modal calls the existing store methods or goes through
      whatever pattern is used. Check the actual ElectronAPI methods.

      Rather than guessing, instruct the executor to verify what board/column/card
      creation methods exist on electronAPI and use those.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. taskStructuringStore.ts exists with plan/breakdown state + 5 actions
      3. ProjectPlanningModal.tsx renders: context textarea, generate button,
         loading/error states, pillar tabs with task checkboxes, milestones, apply button
      4. ProjectsPage has "Plan with AI" button on each project card
      5. Clicking "Plan with AI" opens ProjectPlanningModal with correct projectId
      6. Apply creates board + columns + cards via electronAPI
      7. Modal closes properly (Escape, overlay click, close button, after apply)
      8. Selected tasks can be toggled via checkboxes
    </verify>
    <done>Project planning modal with pillar tabs, task selection, and apply action. Users can generate AI project plans from ProjectsPage and create boards/columns/cards from the suggestions.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - electronAPI has methods for board/column/card creation (verify during execution)
      - boardStore or direct electronAPI calls work for creating boards/columns/cards
      - Lucide has Brain or Sparkles icon (standard lucide icons)
      - Zustand stores can be imported and used in modal components
      - 400 lines is within acceptable range for a feature-rich modal
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Card task breakdown UI and integration into CardDetailModal</n>
    <files>
      src/renderer/components/TaskBreakdownSection.tsx (NEW ~200 lines)
      src/renderer/components/CardDetailModal.tsx (MODIFY — add breakdown section)
    </files>
    <action>
      ## WHY
      R11 also requires task breakdown for individual cards — "suggests task breakdown and
      dependencies." This adds an AI-powered "Break into subtasks" feature to the card detail
      modal, complementing the project-level planning from Task 2.

      ## WHAT

      ### 3a. Create src/renderer/components/TaskBreakdownSection.tsx

      A section component for the CardDetailModal that generates and displays subtask
      suggestions, with an "Apply" action to create the subtasks as new cards.

      Props:
      ```typescript
      interface TaskBreakdownSectionProps {
        cardId: string;
        columnId: string;  // For creating subtask cards in the same column
      }
      ```

      Structure:
      ```
      ── AI Task Breakdown ──────────────────────────────────
      [Break into Subtasks]  (button, or [Regenerate] if breakdown exists)

      ◐ Analyzing task...  (loading state)

      ⚠ Error message  (error state)

      Suggested subtasks:
      ☑ 1. Set up database migration       MED  S
      ☑ 2. Create API endpoint             HIGH M
      ☑ 3. Add input validation            HIGH S
      ☐ 4. Write unit tests                MED  M

      Notes: Consider adding error handling for edge cases...

      [Create Selected as Cards]
      ─────────────────────────────────────────────────────
      ```

      State (local):
      - `selectedSubtasks: Set<number>` — indices of selected subtasks (all selected by default)
      - `applying: boolean` — loading state during apply

      Behavior:
      - **Generate button**: calls taskStructuringStore.generateBreakdown(cardId)
        Uses the store's breakdownLoading/breakdownError/breakdown state.
      - **Subtask list**: Each subtask has checkbox, order number, title, priority badge, effort badge.
        Description shown as tooltip or small text below title.
      - **Select all / deselect all**: Optional toggle at top of list.
      - **Apply button**: "Create Selected as Cards"
        For each selected subtask (in order):
        - Creates a new card in the same column via electronAPI.cardCreate(columnId, {
            title: subtask.title,
            description: subtask.description,
            priority: subtask.priority,
          })
        After all created: show brief success message, clear breakdown.
      - **Notes**: Display the AI's notes section in a muted text block.
      - **Empty state**: Just the "Break into Subtasks" button with a brief description:
        "Use AI to break this task into smaller, actionable subtasks."

      Styling:
      - Section wrapper: same pattern as CommentsSection (collapsible section style)
      - Section title: `text-sm text-surface-400` with Sparkles or ListTodo icon
      - Subtask rows: compact, similar to action items in ActionItemList
      - Priority badges: same color coding as elsewhere
      - Apply button: `bg-primary-600 text-sm`

      Lucide icons: Sparkles (or ListChecks), Check, Loader2

      ### 3b. Modify CardDetailModal.tsx

      1. Import TaskBreakdownSection
      2. Add after the CommentsSection (or after RelationshipsSection):
         ```tsx
         <div className="mb-5">
           <TaskBreakdownSection cardId={card.id} columnId={card.columnId} />
         </div>
         ```

         Note: card.columnId — verify this field exists on the Card type. The card is passed
         as a prop. If columnId isn't on the Card type, it may need to be derived from the
         card's position in the board. Check Card type in shared/types.ts.

         If Card doesn't have columnId, the parent (BoardView) knows which column the card
         is in. In that case, add columnId to CardDetailModalProps:
         ```typescript
         interface CardDetailModalProps {
           card: Card;
           columnId: string;  // Add this
           onUpdate: (id: string, data: UpdateCardInput) => Promise<void>;
           onClose: () => void;
         }
         ```
         And pass it from wherever CardDetailModal is rendered.

      3. Also clean up: when card detail modal closes, call clearBreakdown() from
         taskStructuringStore to reset state.

      ### Integration notes

      - The breakdown feature is contextual to a single card. It loads the card + project
        context automatically via the backend service.
      - Created subtask cards appear in the same column, so the user sees them immediately
        when they close the modal and return to the board view.
      - No new IPC channels needed — Task 1's 'task-structuring:breakdown' handles this.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. TaskBreakdownSection.tsx renders: generate button, loading/error states,
         subtask list with checkboxes and badges, apply button, notes section
      3. CardDetailModal includes TaskBreakdownSection with correct props
      4. Clicking "Break into Subtasks" calls the AI and displays results
      5. "Create Selected as Cards" creates cards in the same column
      6. Subtask selection (checkboxes) works correctly
      7. Breakdown state is cleared when modal closes
      8. New cards appear in the board after apply (verify card creation IPC works)
    </verify>
    <done>TaskBreakdownSection integrated into CardDetailModal. Users can generate AI subtask suggestions for any card and create them as new cards with one click.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Card type has columnId or it can be passed as a prop to CardDetailModal
      - electronAPI.cardCreate (or equivalent) exists for creating cards in a column
      - Creating multiple cards sequentially is acceptable (no batch create needed)
      - The board view auto-refreshes or the user navigates back to see new cards
      - TaskBreakdownSection at ~200 lines keeps CardDetailModal additions minimal (~5 lines)
    </assumptions>
  </task>
</phase>
