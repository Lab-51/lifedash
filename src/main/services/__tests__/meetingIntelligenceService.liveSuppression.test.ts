// === FILE PURPOSE ===
// Unit tests for the LIVE.2 Task 2 anti-duplication wiring: generateActionItems
// suppresses live-accepted action items from re-extraction, and generateBrief
// injects live-accepted decisions/questions as "confirmed during the meeting"
// context. Also covers the pure char-budget helpers directly.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

// Spy on drizzle's eq/inArray (call-through) so we can prove the brief-context
// queries are TYPE-SCOPED — structurally excluding accepted 'project' rows.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return { ...actual, eq: vi.fn(actual.eq), inArray: vi.fn(actual.inArray) };
});

vi.mock('../../db/schema', () => ({
  meetingBriefs: { meetingId: 'meetingId', summary: 'summary', createdAt: 'createdAt' },
  actionItems: {
    id: 'id',
    meetingId: 'meetingId',
    status: 'status',
    cardId: 'cardId',
    description: 'description',
    createdAt: 'createdAt',
  },
  cards: {},
  meetings: { id: 'id', projectId: 'projectId' },
  projects: { id: 'id', archived: 'archived', system: 'system', name: 'name', description: 'description' },
  liveSuggestions: {
    id: 'id',
    meetingId: 'meetingId',
    type: 'type',
    title: 'title',
    description: 'description',
    status: 'status',
  },
}));

vi.mock('../meetingService', () => ({
  getMeeting: vi.fn(),
  updateMeeting: vi.fn().mockResolvedValue({}),
}));

vi.mock('../ai-provider', () => ({
  generate: vi.fn(),
  resolveTaskModel: vi.fn(),
}));

vi.mock('../autoPushService', () => ({
  autoPushActionItems: vi.fn().mockResolvedValue({ pushedCount: 0, skippedCount: 0, cards: [] }),
  readAutoPushSetting: vi.fn().mockResolvedValue(true),
}));

vi.mock('../unassignedProjectService', () => ({
  ensureUnassignedProject: vi.fn().mockResolvedValue({ id: 'unassigned-id', name: 'Unassigned', system: true }),
}));

vi.mock('../projectDetectionService', () => ({
  detectProjectFromTranscript: vi.fn(),
}));

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../shared/utils/action-item-parser', () => ({
  parseActionItems: vi.fn().mockReturnValue(['Follow up on the proposal']),
}));

vi.mock('../../../shared/types', () => ({
  MEETING_TEMPLATES: [],
}));

vi.mock('../twinProfileService', () => ({ buildProfileContext: vi.fn().mockResolvedValue('') }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  generateActionItems,
  generateBrief,
  buildSuppressionInstruction,
  buildConfirmedPreamble,
} from '../meetingIntelligenceService';
import { getMeeting } from '../meetingService';
import { generate, resolveTaskModel } from '../ai-provider';
import { getDb } from '../../db/connection';
import { eq, inArray } from 'drizzle-orm';

const MEETING_ID = 'meeting-1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: MEETING_ID,
    projectId: null,
    title: 'Test Meeting',
    template: 'none',
    transcriptionLanguage: null,
    segments: [
      {
        id: 's1',
        meetingId: MEETING_ID,
        startTime: 0,
        endTime: 5000,
        content: 'discuss the launch plan',
        speaker: null,
        createdAt: '2025-01-01T00:00:00Z',
      },
    ],
    brief: null,
    actionItems: [],
    status: 'completed',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    audioPath: null,
    prepBriefing: null,
    unassignedPending: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

type SelectShape = 'system' | 'summary' | 'confirmed' | 'suppression' | 'unknown';

/** Classify a select({...fields}) call by which columns it asked for. */
function classifyFields(fields?: Record<string, unknown>): SelectShape {
  if (!fields) return 'unknown';
  if ('system' in fields) return 'system';
  if ('summary' in fields) return 'summary';
  if ('type' in fields && 'title' in fields) return 'confirmed';
  if ('title' in fields) return 'suppression';
  return 'unknown';
}

/**
 * Dispatches select() responses by the shape of the selected-fields object so
 * call order doesn't matter — distinguishes the suppression-titles query
 * ({title}), the confirmed decisions/questions query ({type,title,description}),
 * the Unassigned system-flag check ({system}), and the prior-briefs join
 * ({summary,createdAt}).
 */
function buildDb(opts: {
  acceptedActionTitles?: string[];
  confirmedItems?: Array<{ type: string; title: string; description: string | null }>;
  priorBriefs?: unknown[];
  systemFlag?: boolean;
  insertReturning?: unknown[];
  throwOnActionSuppressionLookup?: boolean;
  throwOnConfirmedLookup?: boolean;
}) {
  const defaultActionItemRow = {
    id: 'action-1',
    meetingId: MEETING_ID,
    cardId: null,
    description: 'Follow up on the proposal',
    status: 'pending',
    createdAt: new Date('2025-01-01T00:00:00Z'),
  };
  const insertReturning = vi.fn().mockResolvedValue(opts.insertReturning ?? [defaultActionItemRow]);
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insertFn = vi.fn(() => ({ values: insertValues }));

  const responsesByShape: Record<SelectShape, () => unknown[]> = {
    system: () => [{ system: opts.systemFlag ?? false }],
    summary: () => opts.priorBriefs ?? [],
    confirmed: () => opts.confirmedItems ?? [],
    suppression: () => (opts.acceptedActionTitles ?? []).map((title) => ({ title })),
    unknown: () => [],
  };

  const selectFn = vi.fn((fields?: Record<string, unknown>) => {
    const shape = classifyFields(fields);
    if (shape === 'suppression' && opts.throwOnActionSuppressionLookup) {
      throw new Error('suppression lookup failed');
    }
    if (shape === 'confirmed' && opts.throwOnConfirmedLookup) {
      throw new Error('confirmed lookup failed');
    }

    const response = responsesByShape[shape]();
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.innerJoin = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue(response);
    chain.where = vi.fn().mockReturnValue({ ...chain, then: (resolve: (v: unknown) => void) => resolve(response) });
    return chain;
  });

  const db = { select: selectFn, insert: insertFn };
  vi.mocked(getDb).mockReturnValue(db as never);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTaskModel).mockResolvedValue({
    providerId: 'p1',
    providerName: 'openai',
    apiKeyEncrypted: 'enc',
    baseUrl: null,
    model: 'gpt-4o-mini',
    temperature: 0,
    maxTokens: 500,
  } as never);
});

// ---------------------------------------------------------------------------
// generateActionItems — suppression
// ---------------------------------------------------------------------------

describe('generateActionItems — LIVE.2 suppression', () => {
  it('includes accepted live action item titles as a "do NOT re-extract" list', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: '- Follow up on the proposal' } as never);
    buildDb({ acceptedActionTitles: ['Ship the beta', 'Hire a QA engineer'] });

    await generateActionItems(MEETING_ID);

    const callArg = vi.mocked(generate).mock.calls[0][0];
    expect(callArg.system).toContain('do NOT re-extract');
    expect(callArg.system).toContain('Ship the beta');
    expect(callArg.system).toContain('Hire a QA engineer');
  });

  it('omits the suppression block when no live action items were accepted', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: '- Follow up on the proposal' } as never);
    buildDb({ acceptedActionTitles: [] });

    await generateActionItems(MEETING_ID);

    const callArg = vi.mocked(generate).mock.calls[0][0];
    expect(callArg.system).not.toContain('do NOT re-extract');
  });

  it('does not block extraction when the suppression lookup throws', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: '- Follow up on the proposal' } as never);
    buildDb({
      throwOnActionSuppressionLookup: true,
      insertReturning: [
        {
          id: 'action-1',
          meetingId: MEETING_ID,
          cardId: null,
          description: 'Follow up on the proposal',
          status: 'pending',
          createdAt: new Date('2025-01-01T00:00:00Z'),
        },
      ],
    });

    await expect(generateActionItems(MEETING_ID)).resolves.toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// generateBrief — confirmed live context
// ---------------------------------------------------------------------------

describe('generateBrief — LIVE.2 confirmed context', () => {
  const briefRow = {
    id: 'brief-1',
    meetingId: MEETING_ID,
    summary: 'Generated brief content',
    createdAt: new Date('2025-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    vi.mocked(generate).mockResolvedValue({ text: 'Generated brief content' } as never);
  });

  it('injects accepted live decisions/questions as confirmed context', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: 'real-proj' }) as never);
    buildDb({
      systemFlag: false,
      priorBriefs: [],
      confirmedItems: [
        { type: 'decision', title: 'Push launch to April', description: null },
        { type: 'question', title: 'Who owns QA sign-off?', description: 'Raised by Sarah' },
      ],
      insertReturning: [briefRow],
    });

    await generateBrief(MEETING_ID);

    const callArg = vi.mocked(generate).mock.calls[0][0];
    expect(callArg.prompt).toContain('Confirmed during the meeting');
    expect(callArg.prompt).toContain('Push launch to April');
    expect(callArg.prompt).toContain('Who owns QA sign-off?');
  });

  it('omits the confirmed-context preamble when nothing was accepted live', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: 'real-proj' }) as never);
    buildDb({ systemFlag: false, priorBriefs: [], confirmedItems: [], insertReturning: [briefRow] });

    await generateBrief(MEETING_ID);

    const callArg = vi.mocked(generate).mock.calls[0][0];
    expect(callArg.prompt).not.toContain('Confirmed during the meeting');
  });

  it('does not block brief generation when the confirmed-context lookup throws', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: 'real-proj' }) as never);
    buildDb({
      systemFlag: false,
      priorBriefs: [],
      throwOnConfirmedLookup: true,
      insertReturning: [
        {
          id: 'brief-1',
          meetingId: MEETING_ID,
          summary: 'Generated brief content',
          createdAt: new Date('2025-01-01T00:00:00Z'),
        },
      ],
    });

    const result = await generateBrief(MEETING_ID);
    expect(result.id).toBe('brief-1');
  });
});

// ---------------------------------------------------------------------------
// Pure char-budget helpers
// ---------------------------------------------------------------------------

describe('buildSuppressionInstruction', () => {
  it('returns empty string for no titles', () => {
    expect(buildSuppressionInstruction([])).toBe('');
  });

  it('includes all titles when under budget', () => {
    const out = buildSuppressionInstruction(['Ship the beta', 'Hire QA'], 1000);
    expect(out).toContain('Ship the beta');
    expect(out).toContain('Hire QA');
  });

  it('drops titles once the char budget is exceeded', () => {
    const big = 'x'.repeat(50);
    const titles = [`FIRST ${big}`, `SECOND ${big}`, `THIRD ${big}`];
    const out = buildSuppressionInstruction(titles, 80);
    expect(out).toContain('FIRST');
    expect(out).not.toContain('THIRD');
  });
});

describe('buildConfirmedPreamble', () => {
  it('returns empty string for no items', () => {
    expect(buildConfirmedPreamble([])).toBe('');
  });

  it('formats decisions and questions with their labels', () => {
    const out = buildConfirmedPreamble([
      { type: 'decision', title: 'Adopt weekly triage', description: null },
      { type: 'question', title: 'Who signs off?', description: 'Raised in standup' },
    ]);
    expect(out).toContain('[Decision] Adopt weekly triage');
    expect(out).toContain('[Question] Who signs off?: Raised in standup');
  });

  it('drops items once the char budget is exceeded', () => {
    const big = 'x'.repeat(50);
    const items = [
      { type: 'decision' as const, title: `FIRST ${big}`, description: null },
      { type: 'decision' as const, title: `SECOND ${big}`, description: null },
    ];
    const out = buildConfirmedPreamble(items, 200);
    expect(out).toContain('FIRST');
    expect(out).not.toContain('SECOND');
  });
});

// ---------------------------------------------------------------------------
// LIVE.3 — accepted 'project' suggestions must never leak into the brief flow
// ---------------------------------------------------------------------------
// The two live_suggestions reads that feed brief generation are type-scoped in
// SQL (suppression → type = 'action_item'; confirmed context → type IN
// decision/question). A 'project' row therefore cannot reach either prompt. We
// prove the scoping by spying on the drizzle operators the real queries build.

describe('LIVE.3 — accepted project rows cannot leak into briefs', () => {
  it('scopes the action-item suppression query to type=action_item (never project)', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: '- Follow up on the proposal' } as never);
    buildDb({ acceptedActionTitles: [] });

    await generateActionItems(MEETING_ID);

    // `liveSuggestions.type` is mocked to the string 'type'. Every type-column
    // equality filter in this flow must target 'action_item' — never 'project'.
    // (Cast the drizzle operand — statically an SQLWrapper — to compare the
    // runtime string the mocked schema supplies.)
    const typeFilters = vi.mocked(eq).mock.calls.filter((c) => (c[0] as unknown) === 'type');
    expect(typeFilters.length).toBeGreaterThan(0);
    expect(typeFilters.every((c) => c[1] === 'action_item')).toBe(true);
    expect(typeFilters.some((c) => c[1] === 'project')).toBe(false);
  });

  it('scopes the confirmed-context query to decision/question (never project)', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: 'real-proj' }) as never);
    vi.mocked(generate).mockResolvedValue({ text: 'Generated brief content' } as never);
    buildDb({
      systemFlag: false,
      priorBriefs: [],
      confirmedItems: [],
      insertReturning: [
        { id: 'brief-1', meetingId: MEETING_ID, summary: 'x', createdAt: new Date('2025-01-01T00:00:00Z') },
      ],
    });

    await generateBrief(MEETING_ID);

    const typeInArrays = vi.mocked(inArray).mock.calls.filter((c) => (c[0] as unknown) === 'type');
    expect(typeInArrays.length).toBeGreaterThan(0);
    for (const call of typeInArrays) {
      expect(call[1]).toEqual(['decision', 'question']);
      expect(call[1]).not.toContain('project');
    }
  });
});
