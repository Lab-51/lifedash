// === FILE PURPOSE ===
// LIVE.2 Task 6 — higher-level (integration) proof of the Task 2 anti-duplication
// contract: an accepted live action_item must not be re-extracted AND pushed as a
// second, duplicate card by the post-meeting flow.
//
// meetingIntelligenceService.liveSuppression.test.ts already proves the mechanism
// at the prompt level (the "do NOT re-extract" instruction is built and sent to
// the LLM with the accepted titles). That test mocks ../autoPushService entirely,
// so it never observes what actually reaches the cards table.
//
// This test does NOT mock ../autoPushService or ../inboxColumnService's caller —
// it exercises the REAL generateActionItems -> autoPushActionItems round trip
// (only ensureInboxColumn itself is stubbed, exactly like autoPushService.test.ts
// does) so we can assert on the actual `cards` insert calls: given a simulated
// LLM response that correctly excludes the already-accepted title (the compliant
// behavior the suppression instruction asks for), no card with that title is ever
// created — only the genuinely new item gets pushed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  meetingBriefs: {},
  actionItems: {
    id: 'id',
    meetingId: 'meetingId',
    status: 'status',
    cardId: 'cardId',
    description: 'description',
    createdAt: 'createdAt',
  },
  cards: {
    id: 'id',
    columnId: 'columnId',
    title: 'title',
    description: 'description',
    position: 'position',
    priority: 'priority',
    source: 'source',
    sourceMeetingId: 'sourceMeetingId',
  },
  boards: { id: 'id', projectId: 'projectId', position: 'position', name: 'name' },
  projects: { id: 'id', autoPushEnabled: 'autoPushEnabled' },
  settings: { key: 'key', value: 'value' },
  meetings: { id: 'id', projectId: 'projectId' },
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

vi.mock('../inboxColumnService', () => ({
  ensureInboxColumn: vi.fn().mockResolvedValue({
    id: 'inbox-col-1',
    boardId: 'board-1',
    name: 'Inbox',
    position: 0,
    color: null,
    createdAt: new Date().toISOString(),
  }),
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
  parseActionItems: vi.fn(),
}));

vi.mock('../../../shared/types', () => ({
  MEETING_TEMPLATES: [],
}));

// Note: ../autoPushService is intentionally NOT mocked — this test runs the real
// generateActionItems -> autoPushActionItems -> cards-insert pipeline.

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateActionItems } from '../meetingIntelligenceService';
import { getMeeting } from '../meetingService';
import { generate, resolveTaskModel } from '../ai-provider';
import { getDb } from '../../db/connection';
import { parseActionItems } from '../../../shared/utils/action-item-parser';
import { actionItems, cards, boards, settings, liveSuggestions } from '../../db/schema';

const MEETING_ID = 'meeting-1';
const PROJECT_ID = 'proj-1';
const SUPPRESSED_TITLE = 'Ship the beta';

function makeMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: MEETING_ID,
    projectId: PROJECT_ID,
    title: 'Test Meeting',
    template: 'none',
    transcriptionLanguage: null,
    segments: [
      {
        id: 's1',
        meetingId: MEETING_ID,
        startTime: 0,
        endTime: 5000,
        content: 'discuss the beta launch',
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
 * Builds a DB double spanning BOTH generateActionItems' own queries and the real
 * autoPushService's queries/transaction, dispatched by `.from(table)` reference
 * identity (all callers import the same mocked ../../db/schema module, so the
 * table objects compare equal).
 */
function buildDb(opts: { acceptedTitles: string[] }) {
  const insertedActionItemRows: Array<{
    id: string;
    meetingId: string;
    cardId: string | null;
    description: string;
    status: string;
    createdAt: Date;
  }> = [];
  const insertedCardCalls: Array<{ values: Record<string, unknown> }> = [];
  let actionItemSeq = 0;
  let cardSeq = 0;

  const selectFn = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn((table: unknown) => {
      if (table === liveSuggestions) {
        const response = opts.acceptedTitles.map((title) => ({ title }));
        return { where: vi.fn().mockReturnValue({ then: (resolve: (v: unknown) => void) => resolve(response) }) };
      }
      if (table === settings) {
        return { where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) };
      }
      if (table === boards) {
        return {
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue([
                  { id: 'board-1', projectId: PROJECT_ID, position: 0, name: 'Board', createdAt: new Date() },
                ]),
            }),
          }),
        };
      }
      if (table === actionItems) {
        // Final "refreshed" re-query in generateActionItems — reflects post-tx state.
        return {
          where: vi.fn().mockReturnValue({ then: (resolve: (v: unknown) => void) => resolve(insertedActionItemRows) }),
        };
      }
      throw new Error('Unexpected select().from() table in anti-dup test');
    });
    return chain;
  });

  const insertFn = vi.fn((table: unknown) => {
    if (table !== actionItems) throw new Error('Unexpected top-level insert() table in anti-dup test');
    return {
      values: vi.fn((vals: Record<string, unknown>) => ({
        returning: vi.fn().mockImplementation(() => {
          actionItemSeq++;
          const row = {
            id: `action-${actionItemSeq}`,
            meetingId: vals.meetingId as string,
            cardId: null,
            description: vals.description as string,
            status: vals.status as string,
            createdAt: new Date('2025-01-01T00:00:00Z'),
          };
          insertedActionItemRows.push(row);
          return Promise.resolve([row]);
        }),
      })),
    };
  });

  const txSelectFn = vi.fn(() => ({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ value: cardSeq }]) }),
  }));

  const txInsertFn = vi.fn((table: unknown) => {
    if (table !== cards) throw new Error('Unexpected tx insert() table in anti-dup test');
    return {
      values: vi.fn((vals: Record<string, unknown>) => {
        insertedCardCalls.push({ values: vals });
        return {
          returning: vi.fn().mockImplementation(() => {
            cardSeq++;
            return Promise.resolve([
              {
                id: `card-${cardSeq}`,
                columnId: vals.columnId,
                title: vals.title,
                description: vals.description,
                position: vals.position,
                priority: vals.priority,
                dueDate: null,
                completed: false,
                archived: false,
                recurrenceType: null,
                recurrenceEndDate: null,
                sourceRecurringId: null,
                source: vals.source,
                sourceMeetingId: vals.sourceMeetingId,
                reviewedAt: null,
                createdAt: new Date('2025-01-01T00:00:00Z'),
                updatedAt: new Date('2025-01-01T00:00:00Z'),
              },
            ]);
          }),
        };
      }),
    };
  });

  // Only one pending action item is expected to flow through in this scenario —
  // mutate whichever tracked row(s) are still 'pending' to 'converted' with the
  // new cardId, mirroring what the real UPDATE would persist.
  const txUpdateFn = vi.fn((table: unknown) => {
    if (table !== actionItems) throw new Error('Unexpected tx update() table in anti-dup test');
    return {
      set: vi.fn((setObj: { status: string; cardId: string }) => ({
        where: vi.fn().mockImplementation(() => {
          insertedActionItemRows.forEach((row) => {
            if (row.status === 'pending') {
              row.status = setObj.status;
              row.cardId = setObj.cardId;
            }
          });
          return Promise.resolve([]);
        }),
      })),
    };
  });

  const tx = { select: txSelectFn, insert: txInsertFn, update: txUpdateFn };
  const transactionFn = vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx));

  const db = { select: selectFn, insert: insertFn, transaction: transactionFn };
  vi.mocked(getDb).mockReturnValue(db as never);
  return { insertedCardCalls, insertedActionItemRows };
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

describe('generateActionItems -> autoPushActionItems — LIVE.2 anti-duplication (integration)', () => {
  it('does not re-extract or duplicate an accepted live action_item as a second card', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: '- Draft the beta release notes' } as never);
    // Simulates the LLM correctly honoring the suppression instruction: it only
    // returns the genuinely new item, never the already-accepted title.
    vi.mocked(parseActionItems).mockReturnValue(['Draft the beta release notes']);

    const { insertedCardCalls } = buildDb({ acceptedTitles: [SUPPRESSED_TITLE] });

    const result = await generateActionItems(MEETING_ID);

    // The mechanism: the suppression instruction reached the LLM with the exact
    // accepted title (proven at unit level in liveSuppression.test.ts; reasserted
    // here as part of the same end-to-end call).
    const callArg = vi.mocked(generate).mock.calls[0][0];
    expect(callArg.system).toContain('do NOT re-extract');
    expect(callArg.system).toContain(SUPPRESSED_TITLE);

    // The effect: exactly ONE card was pushed to the Inbox — the new item — and
    // it is NOT a duplicate of the already-accepted (live-assistant) title.
    expect(insertedCardCalls).toHaveLength(1);
    expect(insertedCardCalls.some((c) => new RegExp(SUPPRESSED_TITLE, 'i').test(String(c.values.title)))).toBe(false);
    expect(String(insertedCardCalls[0].values.title)).toMatch(/draft the beta release notes/i);
    expect(insertedCardCalls[0].values.source).toBe('auto-from-meeting');

    // The returned action items reflect the single converted (pushed) item only.
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('converted');
    expect(result[0].cardId).toBe('card-1');
  });
});
