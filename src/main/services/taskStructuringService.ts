// === FILE PURPOSE ===
// AI task structuring service — generates project plans with production-focused
// pillars and breaks down cards into subtasks. Uses the generate() wrapper from
// ai-provider.ts for structured JSON output.
//
// === DEPENDENCIES ===
// - ai-provider.ts (generate, resolveTaskModel)
// - Database connection for loading project/card context
//
// === LIMITATIONS ===
// - Generated plans are transient (not persisted in DB)
// - JSON parsing has fallback but may fail on very malformed AI output
// - Depends on AI provider being configured for 'task_structuring' task type
//
// === VERIFICATION STATUS ===
// - generate() API: verified from ai-provider.ts (same pattern as ideaService.analyzeIdea)
// - resolveTaskModel: verified — accepts any string taskType
// - DB schema: verified — projects, boards, columns, cards tables with expected fields

import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { projects, boards, columns, cards } from '../db/schema';
import { generate, resolveTaskModel } from './ai-provider';
import { createLogger } from './logger';
import type { ProjectPlan, ProjectPillar, TaskBreakdown, SubtaskSuggestion } from '../../shared/types';

const log = createLogger('TaskStructuring');

// ---------------------------------------------------------------------------
// System Prompts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const VALID_EFFORTS = ['small', 'medium', 'large'] as const;

function isValidPriority(v: unknown): v is 'low' | 'medium' | 'high' | 'urgent' {
  return typeof v === 'string' && (VALID_PRIORITIES as readonly string[]).includes(v);
}

function isValidEffort(v: unknown): v is 'small' | 'medium' | 'large' {
  return typeof v === 'string' && (VALID_EFFORTS as readonly string[]).includes(v);
}

/**
 * Strip markdown code fences and parse JSON from AI response text.
 */
function parseJsonResponse(text: string): unknown {
  const jsonStr = text.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(jsonStr);
}

/**
 * Validate and normalize a ProjectPlan from parsed JSON.
 * Throws descriptive errors for invalid structure.
 */
function validateProjectPlan(parsed: unknown): ProjectPlan {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI response is not a valid object.');
  }

  const obj = parsed as Record<string, unknown>;

  // Validate summary
  const summary = typeof obj.summary === 'string' ? obj.summary : 'AI-generated project plan';

  // Validate pillars
  if (!Array.isArray(obj.pillars) || obj.pillars.length === 0) {
    throw new Error('AI response missing valid "pillars" array.');
  }

  const pillars: ProjectPillar[] = obj.pillars.map((p: unknown, i: number) => {
    if (!p || typeof p !== 'object') {
      throw new Error(`Pillar at index ${i} is not a valid object.`);
    }
    const pillar = p as Record<string, unknown>;

    if (typeof pillar.name !== 'string' || !pillar.name) {
      throw new Error(`Pillar at index ${i} is missing a "name" field.`);
    }

    if (!Array.isArray(pillar.tasks)) {
      throw new Error(`Pillar "${pillar.name}" is missing a "tasks" array.`);
    }

    const tasks = pillar.tasks.map((t: unknown, j: number) => {
      if (!t || typeof t !== 'object') {
        throw new Error(`Task at index ${j} in pillar "${pillar.name}" is not a valid object.`);
      }
      const task = t as Record<string, unknown>;

      return {
        title: typeof task.title === 'string' ? task.title : `Task ${j + 1}`,
        description: typeof task.description === 'string' ? task.description : '',
        priority: isValidPriority(task.priority) ? task.priority : 'medium' as const,
        effort: isValidEffort(task.effort) ? task.effort : 'medium' as const,
        dependencies: Array.isArray(task.dependencies)
          ? task.dependencies.filter((d): d is string => typeof d === 'string')
          : undefined,
      };
    });

    return {
      name: pillar.name as string,
      description: typeof pillar.description === 'string' ? pillar.description : '',
      tasks,
    };
  });

  // Validate milestones (optional — not every response may include them)
  const milestones = Array.isArray(obj.milestones)
    ? obj.milestones.map((m: unknown) => {
        if (!m || typeof m !== 'object') return { name: 'Milestone', description: '', taskTitles: [] };
        const ms = m as Record<string, unknown>;
        return {
          name: typeof ms.name === 'string' ? ms.name : 'Milestone',
          description: typeof ms.description === 'string' ? ms.description : '',
          taskTitles: Array.isArray(ms.taskTitles)
            ? ms.taskTitles.filter((t): t is string => typeof t === 'string')
            : [],
        };
      })
    : [];

  return { summary, pillars, milestones };
}

/**
 * Validate and normalize a TaskBreakdown from parsed JSON.
 * Throws descriptive errors for invalid structure.
 */
function validateTaskBreakdown(parsed: unknown): TaskBreakdown {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI response is not a valid object.');
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.subtasks) || obj.subtasks.length === 0) {
    throw new Error('AI response missing valid "subtasks" array.');
  }

  const subtasks: SubtaskSuggestion[] = obj.subtasks.map((s: unknown, i: number) => {
    if (!s || typeof s !== 'object') {
      throw new Error(`Subtask at index ${i} is not a valid object.`);
    }
    const sub = s as Record<string, unknown>;

    return {
      title: typeof sub.title === 'string' ? sub.title : `Subtask ${i + 1}`,
      description: typeof sub.description === 'string' ? sub.description : '',
      priority: isValidPriority(sub.priority) ? sub.priority : 'medium' as const,
      effort: isValidEffort(sub.effort) ? sub.effort : 'medium' as const,
      order: typeof sub.order === 'number' ? sub.order : i + 1,
    };
  });

  const notes = typeof obj.notes === 'string' ? obj.notes : '';

  return { subtasks, notes };
}

// ---------------------------------------------------------------------------
// Exported Functions
// ---------------------------------------------------------------------------

/**
 * Generate a production-focused project plan for an existing project.
 * Loads project + boards + columns + cards from DB to provide context to the AI.
 */
export async function generateProjectPlan(
  projectId: string,
  additionalDescription?: string,
): Promise<ProjectPlan> {
  const db = getDb();

  // Load project
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error(`Project not found: ${projectId}`);

  // Load boards for this project
  const projectBoards = await db.select().from(boards).where(eq(boards.projectId, projectId));

  // Build context with existing board/column/card structure
  let contextParts: string[] = [
    `Project: ${project.name}`,
  ];

  if (project.description) {
    contextParts.push(`Description: ${project.description}`);
  }

  if (additionalDescription) {
    contextParts.push(`Additional context: ${additionalDescription}`);
  }

  // Load columns and cards for each board (for richer context)
  if (projectBoards.length > 0) {
    const boardDescriptions: string[] = [];

    for (const board of projectBoards) {
      const boardColumns = await db.select().from(columns).where(eq(columns.boardId, board.id));
      const columnDescriptions: string[] = [];

      for (const col of boardColumns) {
        const colCards = await db
          .select({ title: cards.title, priority: cards.priority })
          .from(cards)
          .where(eq(cards.columnId, col.id));

        // Limit to 10 cards per column for context size
        const cardTitles = colCards.slice(0, 10).map((c) => c.title);
        if (cardTitles.length > 0) {
          columnDescriptions.push(`  ${col.name}: ${cardTitles.join(', ')}`);
        } else {
          columnDescriptions.push(`  ${col.name}: (empty)`);
        }
      }

      boardDescriptions.push(`Board "${board.name}":\n${columnDescriptions.join('\n')}`);
    }

    contextParts.push(`\nExisting structure:\n${boardDescriptions.join('\n\n')}`);
  }

  const contextString = contextParts.join('\n');

  return generatePlanFromContext(contextString);
}

/**
 * Generate a project plan without loading from DB.
 * Used for planning a project before it's created.
 */
export async function generateQuickPlan(
  projectName: string,
  projectDescription: string,
): Promise<ProjectPlan> {
  const contextString = `Project: ${projectName}\nDescription: ${projectDescription}`;
  return generatePlanFromContext(contextString);
}

/**
 * Break down a single card into subtasks using AI.
 * Loads card + column + board + project context for the AI.
 */
export async function generateTaskBreakdown(cardId: string): Promise<TaskBreakdown> {
  const db = getDb();

  // Load card
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
  if (!card) throw new Error(`Card not found: ${cardId}`);

  // Load column -> board -> project for context
  const [column] = await db.select().from(columns).where(eq(columns.id, card.columnId));
  const [board] = column
    ? await db.select().from(boards).where(eq(boards.id, column.boardId))
    : [undefined];
  const [project] = board
    ? await db.select().from(projects).where(eq(projects.id, board.projectId))
    : [undefined];

  // Load sibling cards in the same column for context
  const siblingCards = await db
    .select({ title: cards.title })
    .from(cards)
    .where(eq(cards.columnId, card.columnId));
  const siblingTitles = siblingCards
    .filter((c) => c.title !== card.title)
    .slice(0, 10)
    .map((c) => c.title);

  // Build context string
  const contextParts: string[] = [];
  if (project) contextParts.push(`Project: ${project.name}`);
  if (board) contextParts.push(`Board: ${board.name}`);
  if (column) contextParts.push(`Column: ${column.name}`);
  contextParts.push('');
  contextParts.push(`Card: ${card.title}`);
  contextParts.push(`Description: ${card.description || 'No description'}`);
  contextParts.push(`Priority: ${card.priority}`);

  if (siblingTitles.length > 0) {
    contextParts.push(`\nOther cards in this column: ${siblingTitles.join(', ')}`);
  }

  const contextString = contextParts.join('\n');

  // Resolve AI provider
  const provider = await resolveTaskModel('task_structuring');
  if (!provider) {
    throw new Error('No AI provider configured. Please set up an AI provider in Settings.');
  }

  // Generate breakdown
  let result;
  try {
    result = await generate({
      providerId: provider.providerId,
      providerName: provider.providerName,
      apiKeyEncrypted: provider.apiKeyEncrypted,
      baseUrl: provider.baseUrl,
      model: provider.model,
      taskType: 'task_structuring',
      system: TASK_BREAKDOWN_SYSTEM_PROMPT,
      prompt: contextString,
      temperature: provider.temperature ?? 0.4,
      maxTokens: provider.maxTokens ?? 4096,
    });
  } catch (err) {
    log.error('Task breakdown generation failed:', err);
    throw new Error('Failed to generate task breakdown. Please check your AI provider configuration and try again.');
  }

  // Parse and validate JSON response
  let breakdown: TaskBreakdown;
  try {
    const parsed = parseJsonResponse(result.text);
    breakdown = validateTaskBreakdown(parsed);
  } catch {
    throw new Error('Failed to parse AI response as task breakdown. Please try again.');
  }

  return breakdown;
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Shared logic for generating a project plan from a context string.
 * Resolves the AI provider, generates, parses, and validates.
 */
async function generatePlanFromContext(contextString: string): Promise<ProjectPlan> {
  // Resolve AI provider
  const provider = await resolveTaskModel('task_structuring');
  if (!provider) {
    throw new Error('No AI provider configured. Please set up an AI provider in Settings.');
  }

  // Generate plan
  let result;
  try {
    result = await generate({
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
  } catch (err) {
    log.error('Project plan generation failed:', err);
    throw new Error('Failed to generate project plan. Please check your AI provider configuration and try again.');
  }

  // Parse and validate JSON response
  let plan: ProjectPlan;
  try {
    const parsed = parseJsonResponse(result.text);
    plan = validateProjectPlan(parsed);
  } catch {
    throw new Error('Failed to parse AI response as project plan. Please try again.');
  }

  return plan;
}
