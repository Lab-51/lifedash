// === FILE PURPOSE ===
// Unit tests for the brief-threading + auto-detect wiring added to
// generateBrief in MEET-INTEL.1-3. Mocks the LLM and DB; focuses on
// orchestration: detection runs only when projectId is null, threading is
// skipped for Unassigned, prior briefs are injected as a preamble, and the
// token budget drops the oldest brief first.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

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
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../shared/utils/action-item-parser', () => ({
  parseActionItems: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../shared/types', () => ({
  MEETING_TEMPLATES: [],
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateBrief, trimBriefsToBudget } from '../meetingIntelligenceService';
import { getMeeting, updateMeeting } from '../meetingService';
import { generate, resolveTaskModel } from '../ai-provider';
import { ensureUnassignedProject } from '../unassignedProjectService';
import { detectProjectFromTranscript } from '../projectDetectionService';
import { getDb } from '../../db/connection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: 'meeting-1',
    projectId: null,
    title: 'Test Meeting',
    template: 'none',
    transcriptionLanguage: null,
    segments: [
      {
        id: 's1',
        meetingId: 'meeting-1',
        startTime: 0,
        endTime: 5000,
        content: 'discuss the website redesign',
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

/**
 * Build a minimal DB mock for generateBrief.
 *
 * - First select call (when no projectId): list non-archived non-system projects
 * - Second (when projectId known): proj.system check
 * - Third: prior briefs join query
 * - insert: brief insert
 *
 * The builder records the last user prompt sent to generate() for assertions.
 */
function buildDb(opts: {
  projectsForDetection?: Array<{ id: string; name: string; description: string | null }>;
  systemFlag?: boolean;
  priorBriefs?: Array<{ summary: string; createdAt: Date }>;
}) {
  const insertReturning = vi
    .fn()
    .mockResolvedValue([
      { id: 'brief-1', meetingId: 'meeting-1', summary: 'AI brief text', createdAt: new Date('2025-01-01T00:00:00Z') },
    ]);
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insertFn = vi.fn(() => ({ values: insertValues }));

  let selectCallIdx = 0;
  const selectFn = vi.fn(() => {
    const idx = selectCallIdx++;
    // Each call returns a new chain that resolves to the appropriate response
    return makeChainForCall(idx);
  });

  function makeChainForCall(idx: number) {
    let response: unknown;
    if (idx === 0 && opts.projectsForDetection !== undefined) {
      response = opts.projectsForDetection;
    } else if (idx === 0 && opts.systemFlag !== undefined) {
      response = [{ system: opts.systemFlag }];
    } else if (idx === 1 && opts.priorBriefs !== undefined) {
      response = opts.priorBriefs;
    } else if (idx === 1 && opts.systemFlag !== undefined) {
      response = opts.priorBriefs ?? [];
    } else {
      response = [];
    }
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.innerJoin = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue(response);
    // Allow awaiting `.where()` directly (for queries without orderBy/limit)
    (chain.where as ReturnType<typeof vi.fn>).mockReturnValue({
      ...chain,
      then: (resolve: (v: unknown) => void) => resolve(response),
    });
    return chain;
  }

  const db = {
    select: selectFn,
    insert: insertFn,
  };
  vi.mocked(getDb).mockReturnValue(db as never);
  return db;
}

// ---------------------------------------------------------------------------
// trimBriefsToBudget — unit tests for the soft cap helper
// ---------------------------------------------------------------------------

describe('trimBriefsToBudget', () => {
  it('keeps all briefs when total is well under budget', () => {
    const priors = ['short brief 1', 'short brief 2', 'short brief 3'];
    const result = trimBriefsToBudget(priors, 1000, 48000);
    expect(result).toHaveLength(3);
  });

  it('drops the oldest brief first when budget exceeded', () => {
    // priors are newest-first; construct so combined exceeds budget
    const big = 'x'.repeat(20000);
    const priors = [`NEWEST ${big}`, `MIDDLE ${big}`, `OLDEST ${big}`];
    const result = trimBriefsToBudget(priors, 1000, 48000);
    // Some priors should be dropped; oldest goes first
    expect(result.length).toBeLessThan(3);
    if (result.length > 0) {
      // The newest must still be present
      expect(result[0]).toContain('NEWEST');
    }
    // OLDEST should never remain alone after middle
    expect(result.every((p) => !p.startsWith('OLDEST '))).toBe(true);
  });

  it('returns empty array when even one brief exceeds budget', () => {
    const huge = 'x'.repeat(60000);
    const priors = [huge];
    const result = trimBriefsToBudget(priors, 100, 48000);
    expect(result).toEqual([]);
  });

  it('returns empty when input is empty', () => {
    expect(trimBriefsToBudget([], 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// generateBrief — auto-detect wiring
// ---------------------------------------------------------------------------

describe('generateBrief — auto-detect wiring', () => {
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
    vi.mocked(generate).mockResolvedValue({ text: 'Generated brief content' } as never);
    vi.mocked(updateMeeting).mockResolvedValue({} as never);
    vi.mocked(ensureUnassignedProject).mockResolvedValue({
      id: 'unassigned-id',
      name: 'Unassigned',
      system: true,
    } as never);
  });

  it('runs detection and assigns project on high confidence (>0.8)', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: null }) as never);
    vi.mocked(detectProjectFromTranscript).mockResolvedValue({
      projectId: 'p-real',
      confidence: 0.95,
      reason: 'clear match',
    });
    buildDb({
      projectsForDetection: [{ id: 'p-real', name: 'Website', description: null }],
    });

    await generateBrief('meeting-1');

    expect(detectProjectFromTranscript).toHaveBeenCalledOnce();
    expect(updateMeeting).toHaveBeenCalledWith('meeting-1', { projectId: 'p-real' });
    // Should NOT route to Unassigned
    expect(ensureUnassignedProject).not.toHaveBeenCalled();
  });

  it('routes to Unassigned + sets unassignedPending when confidence is below threshold', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: null }) as never);
    vi.mocked(detectProjectFromTranscript).mockResolvedValue({
      projectId: 'p-real',
      confidence: 0.5,
      reason: 'unclear',
    });
    buildDb({
      projectsForDetection: [{ id: 'p-real', name: 'Website', description: null }],
    });

    await generateBrief('meeting-1');

    expect(ensureUnassignedProject).toHaveBeenCalledOnce();
    expect(updateMeeting).toHaveBeenCalledWith('meeting-1', {
      projectId: 'unassigned-id',
      unassignedPending: true,
    });
  });

  it('routes to Unassigned when classifier returns null projectId', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: null }) as never);
    vi.mocked(detectProjectFromTranscript).mockResolvedValue({
      projectId: null,
      confidence: 0.0,
      reason: 'no projects available',
    });
    buildDb({
      projectsForDetection: [],
    });

    await generateBrief('meeting-1');

    expect(ensureUnassignedProject).toHaveBeenCalledOnce();
    expect(updateMeeting).toHaveBeenCalledWith('meeting-1', {
      projectId: 'unassigned-id',
      unassignedPending: true,
    });
  });

  it('skips detection entirely when meeting already has a projectId', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: 'pre-set-project' }) as never);
    buildDb({ systemFlag: false });

    await generateBrief('meeting-1');

    expect(detectProjectFromTranscript).not.toHaveBeenCalled();
    expect(updateMeeting).not.toHaveBeenCalled();
    expect(ensureUnassignedProject).not.toHaveBeenCalled();
  });

  it('does not block brief generation when detection throws', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: null }) as never);
    vi.mocked(detectProjectFromTranscript).mockRejectedValueOnce(new Error('boom'));
    buildDb({ projectsForDetection: [] });

    await expect(generateBrief('meeting-1')).resolves.toBeDefined();
    expect(generate).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// generateBrief — threading
// ---------------------------------------------------------------------------

describe('generateBrief — brief threading', () => {
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
    vi.mocked(generate).mockResolvedValue({ text: 'Generated brief content' } as never);
    vi.mocked(updateMeeting).mockResolvedValue({} as never);
  });

  it('omits the threading preamble when no prior briefs exist', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: 'real-proj' }) as never);
    buildDb({ systemFlag: false, priorBriefs: [] });

    await generateBrief('meeting-1');

    const callArg = vi.mocked(generate).mock.calls[0][0];
    expect(callArg.prompt).not.toContain('Recent context from this project');
  });

  it('injects up to 3 prior brief summaries newest-first into the prompt', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: 'real-proj' }) as never);
    buildDb({
      systemFlag: false,
      priorBriefs: [
        { summary: 'NEWEST_BRIEF', createdAt: new Date('2026-05-04') },
        { summary: 'MIDDLE_BRIEF', createdAt: new Date('2026-05-03') },
        { summary: 'OLDEST_BRIEF', createdAt: new Date('2026-05-02') },
      ],
    });

    await generateBrief('meeting-1');

    const callArg = vi.mocked(generate).mock.calls[0][0];
    expect(callArg.prompt).toContain('Recent context from this project');
    expect(callArg.prompt).toContain('NEWEST_BRIEF');
    expect(callArg.prompt).toContain('MIDDLE_BRIEF');
    expect(callArg.prompt).toContain('OLDEST_BRIEF');
    // Newest should appear before oldest in the prompt
    expect(callArg.prompt.indexOf('NEWEST_BRIEF')).toBeLessThan(callArg.prompt.indexOf('OLDEST_BRIEF'));
  });

  it('skips threading entirely for the system Unassigned project', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: 'unassigned-id' }) as never);
    buildDb({ systemFlag: true });

    await generateBrief('meeting-1');

    const callArg = vi.mocked(generate).mock.calls[0][0];
    expect(callArg.prompt).not.toContain('Recent context from this project');
  });

  it('drops oldest brief first when token budget exceeded', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: 'real-proj' }) as never);

    // Each brief is large; combined > 48000 chars
    const big = 'x'.repeat(20000);
    buildDb({
      systemFlag: false,
      priorBriefs: [
        { summary: `NEWEST ${big}`, createdAt: new Date('2026-05-04') },
        { summary: `MIDDLE ${big}`, createdAt: new Date('2026-05-03') },
        { summary: `OLDEST ${big}`, createdAt: new Date('2026-05-02') },
      ],
    });

    await generateBrief('meeting-1');

    const callArg = vi.mocked(generate).mock.calls[0][0];
    // OLDEST should be dropped; NEWEST should remain
    expect(callArg.prompt).toContain('NEWEST ');
    expect(callArg.prompt).not.toContain('OLDEST x');
  });

  it('does not block brief generation when threading query throws', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: 'real-proj' }) as never);

    const throwingDb = {
      select: vi.fn(() => {
        throw new Error('threading query failed');
      }),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi
            .fn()
            .mockResolvedValue([{ id: 'brief-1', meetingId: 'meeting-1', summary: 'ok', createdAt: new Date() }]),
        })),
      })),
    };
    vi.mocked(getDb).mockReturnValue(throwingDb as never);

    const result = await generateBrief('meeting-1');
    expect(result.id).toBe('brief-1');
  });
});
