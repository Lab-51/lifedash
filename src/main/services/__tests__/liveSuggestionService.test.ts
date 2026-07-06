// === FILE PURPOSE ===
// Unit tests for the live suggestion lifecycle (LIVE.2 Task 2 + LIVE.3): accept
// (action_item -> card via the reused live-assistant rail; decision/question ->
// status-only, no card; project -> create + link, or reuse an existing link),
// dismiss, and list. Verifies the LIVE.3 accept-lifecycle correctness fixes: the
// claim is ATOMIC (a double/concurrent accept creates no duplicate side effect),
// the project branch never overwrites an already-linked meeting, and a failed
// side effect reverts the claim instead of orphaning an 'accepted' row.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  liveSuggestions: {
    id: 'id',
    meetingId: 'meetingId',
    type: 'type',
    title: 'title',
    description: 'description',
    status: 'status',
    acceptedCardId: 'acceptedCardId',
    acceptedProjectId: 'acceptedProjectId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}));

vi.mock('../meetingAgentService', () => ({
  createLiveAssistantCard: vi.fn(),
}));

vi.mock('../projectService', () => ({
  createProjectRecord: vi.fn(),
}));

vi.mock('../meetingService', () => ({
  updateMeeting: vi.fn(),
  getMeeting: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { acceptSuggestion, dismissSuggestion, listSuggestions } from '../liveSuggestionService';
import { getDb } from '../../db/connection';
import { createLiveAssistantCard } from '../meetingAgentService';
import { createProjectRecord } from '../projectService';
import { updateMeeting, getMeeting } from '../meetingService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MEETING_ID = '550e8400-e29b-41d4-a716-446655440000';
const SUGGESTION_ID = '660e8400-e29b-41d4-a716-446655440000';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SUGGESTION_ID,
    meetingId: MEETING_ID,
    type: 'action_item',
    title: 'Ship the beta',
    description: null,
    status: 'proposed',
    acceptedCardId: null,
    acceptedProjectId: null,
    createdAt: new Date('2026-07-06T00:00:00Z'),
    updatedAt: new Date('2026-07-06T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Stateful DB mock modelling the atomic claim.
 * - `db.select()` resolves the CURRENT row (or [] when it does not exist).
 * - `db.update().set(values).where(...).returning()` distinguishes three writes by
 *   `values`:
 *     • claim    ({status:'accepted'}, no acceptedCardId key) — succeeds only when
 *       the current row is still 'proposed' (and `claimEmpty` is not forced),
 *       otherwise returns [] to simulate a lost race.
 *     • revert   ({status:'proposed', acceptedCardId:null, ...}) — applies + echoes.
 *     • provenance ({acceptedCardId, acceptedProjectId, ...}) — applies + echoes.
 * A single mutable `current` object carries state across sequential updates so a
 * second accept naturally finds the row already 'accepted'.
 */
function buildDb(opts: { row: Record<string, unknown> | null; claimEmpty?: boolean }) {
  let current = opts.row ? { ...opts.row } : null;

  const selectFn = vi.fn(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn(() => Promise.resolve(current ? [current] : [])),
    }),
  }));

  const updateSet = vi.fn((values: Record<string, unknown>) => {
    const isClaim = values.status === 'accepted' && !('acceptedCardId' in values);
    if (isClaim) {
      const won = !opts.claimEmpty && current?.status === 'proposed';
      if (won && current) {
        current = { ...current, ...values };
        const claimed = current;
        return { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([claimed]) }) };
      }
      return { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) };
    }
    // Revert or provenance: apply the values, echo the row back.
    if (current) current = { ...current, ...values };
    const echoed = current ? [current] : [];
    return { where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(echoed) }) };
  });

  const updateFn = vi.fn(() => ({ set: updateSet }));
  const db = { select: selectFn, update: updateFn };
  vi.mocked(getDb).mockReturnValue(db as never);
  return { db, updateSet };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// acceptSuggestion
// ---------------------------------------------------------------------------

describe('acceptSuggestion', () => {
  it('action_item: creates a card via the live-assistant rail and stores acceptedCardId', async () => {
    buildDb({ row: makeRow({ type: 'action_item', title: 'Ship the beta', description: 'Finish it' }) });
    vi.mocked(createLiveAssistantCard).mockResolvedValue({
      success: true,
      cardId: 'card-1',
      card: { id: 'card-1', title: 'Ship the beta', column: 'Inbox' },
    });

    const result = await acceptSuggestion(SUGGESTION_ID);

    expect(createLiveAssistantCard).toHaveBeenCalledWith(MEETING_ID, {
      title: 'Ship the beta',
      description: 'Finish it',
    });
    expect(result?.status).toBe('accepted');
    expect(result?.acceptedCardId).toBe('card-1');
  });

  it('decision: sets status accepted with NO card created', async () => {
    buildDb({ row: makeRow({ type: 'decision', title: 'Adopt weekly triage' }) });

    const result = await acceptSuggestion(SUGGESTION_ID);

    expect(createLiveAssistantCard).not.toHaveBeenCalled();
    expect(result?.status).toBe('accepted');
    expect(result?.acceptedCardId).toBeNull();
  });

  it('question: sets status accepted with NO card created', async () => {
    buildDb({ row: makeRow({ type: 'question', title: 'Who owns QA?' }) });

    const result = await acceptSuggestion(SUGGESTION_ID);

    expect(createLiveAssistantCard).not.toHaveBeenCalled();
    expect(result?.status).toBe('accepted');
    expect(result?.acceptedCardId).toBeNull();
  });

  it('project: on an UNLINKED meeting, creates the project, links it, and stores acceptedProjectId', async () => {
    buildDb({
      row: makeRow({ type: 'project', title: 'Website Redesign', description: 'Rebuild the marketing site' }),
    });
    vi.mocked(getMeeting).mockResolvedValue({ projectId: null } as never);
    vi.mocked(createProjectRecord).mockResolvedValue({ id: 'proj-9', name: 'Website Redesign' } as never);
    vi.mocked(updateMeeting).mockResolvedValue({} as never);

    const result = await acceptSuggestion(SUGGESTION_ID);

    // Shared creation path + reused link rail (updateMeeting auto-pushes pending items).
    expect(createProjectRecord).toHaveBeenCalledWith(expect.anything(), {
      name: 'Website Redesign',
      description: 'Rebuild the marketing site',
    });
    expect(updateMeeting).toHaveBeenCalledWith(MEETING_ID, { projectId: 'proj-9' });
    expect(createLiveAssistantCard).not.toHaveBeenCalled();
    expect(result?.status).toBe('accepted');
    expect(result?.acceptedProjectId).toBe('proj-9');
    expect(result?.acceptedCardId).toBeNull();
  });

  // --- BUG 1 regression: never overwrite an already-linked meeting ---
  it('project: on an ALREADY-LINKED meeting, does NOT create a project or overwrite the link', async () => {
    buildDb({ row: makeRow({ type: 'project', title: 'Website Redesign' }) });
    // The meeting was linked (e.g. via the dropdown) before Create was tapped on a stale chip.
    vi.mocked(getMeeting).mockResolvedValue({ projectId: 'existing-proj' } as never);

    const result = await acceptSuggestion(SUGGESTION_ID);

    expect(createProjectRecord).not.toHaveBeenCalled();
    expect(updateMeeting).not.toHaveBeenCalled();
    expect(result?.status).toBe('accepted');
    // Provenance points at the project the meeting already has — a benign no-op link.
    expect(result?.acceptedProjectId).toBe('existing-proj');
  });

  // --- BUG 2 regression: the atomic claim serialises concurrent/double accepts ---
  it('project: concurrent/double accept — the atomic claim lets only ONE through; the loser returns null and creates nothing', async () => {
    buildDb({ row: makeRow({ type: 'project', title: 'Website Redesign' }) });
    vi.mocked(getMeeting).mockResolvedValue({ projectId: null } as never);
    vi.mocked(createProjectRecord).mockResolvedValue({ id: 'proj-9', name: 'Website Redesign' } as never);
    vi.mocked(updateMeeting).mockResolvedValue({} as never);

    const first = await acceptSuggestion(SUGGESTION_ID);
    const second = await acceptSuggestion(SUGGESTION_ID);

    expect(first?.status).toBe('accepted');
    expect(second).toBeNull();
    // Exactly ONE project ever created / linked despite two accepts.
    expect(createProjectRecord).toHaveBeenCalledTimes(1);
    expect(updateMeeting).toHaveBeenCalledTimes(1);
  });

  it('project: a second accept of an already-accepted row returns null and creates nothing', async () => {
    buildDb({ row: makeRow({ type: 'project', status: 'accepted' }) });

    const result = await acceptSuggestion(SUGGESTION_ID);

    expect(result).toBeNull();
    expect(createProjectRecord).not.toHaveBeenCalled();
    expect(updateMeeting).not.toHaveBeenCalled();
  });

  // --- Rollback regression: a failed side effect must not orphan an 'accepted' row ---
  it('project: reverts the claim to proposed and rethrows when createProjectRecord fails', async () => {
    const { updateSet } = buildDb({ row: makeRow({ type: 'project', title: 'Website Redesign' }) });
    vi.mocked(getMeeting).mockResolvedValue({ projectId: null } as never);
    vi.mocked(createProjectRecord).mockRejectedValue(new Error('DB write failed'));

    await expect(acceptSuggestion(SUGGESTION_ID)).rejects.toThrow('DB write failed');
    // The claim was reverted — status set back to 'proposed', provenance cleared.
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'proposed', acceptedProjectId: null, acceptedCardId: null }),
    );
    // Meeting was never linked because project creation failed first.
    expect(updateMeeting).not.toHaveBeenCalled();
  });

  it('returns null when the suggestion was already processed (prevents duplicate cards)', async () => {
    buildDb({ row: makeRow({ status: 'accepted' }) });

    const result = await acceptSuggestion(SUGGESTION_ID);

    expect(result).toBeNull();
    expect(createLiveAssistantCard).not.toHaveBeenCalled();
  });

  it('throws when the suggestion does not exist', async () => {
    buildDb({ row: null });
    await expect(acceptSuggestion(SUGGESTION_ID)).rejects.toThrow('not found');
  });

  it('reverts the claim and rethrows when card creation fails (action_item not left accepted)', async () => {
    const { updateSet } = buildDb({ row: makeRow({ type: 'action_item' }) });
    vi.mocked(createLiveAssistantCard).mockResolvedValue({ success: false, error: 'Meeting not found' });

    await expect(acceptSuggestion(SUGGESTION_ID)).rejects.toThrow('Meeting not found');
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'proposed', acceptedCardId: null }));
  });
});

// ---------------------------------------------------------------------------
// dismissSuggestion
// ---------------------------------------------------------------------------

describe('dismissSuggestion', () => {
  it('sets status to dismissed', async () => {
    buildDb({ row: makeRow() });

    const result = await dismissSuggestion(SUGGESTION_ID);

    expect(result.status).toBe('dismissed');
  });

  it('throws when the suggestion does not exist', async () => {
    buildDb({ row: null });
    await expect(dismissSuggestion(SUGGESTION_ID)).rejects.toThrow('not found');
  });

  it('throws when the suggestion was already processed', async () => {
    buildDb({ row: makeRow({ status: 'dismissed' }) });
    await expect(dismissSuggestion(SUGGESTION_ID)).rejects.toThrow('already dismissed');
  });
});

// ---------------------------------------------------------------------------
// listSuggestions
// ---------------------------------------------------------------------------

describe('listSuggestions', () => {
  it('returns all mapped suggestions for a meeting', async () => {
    const rows = [makeRow({ id: 'a' }), makeRow({ id: 'b', type: 'decision', status: 'accepted' })];
    const selectFn = vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    }));
    vi.mocked(getDb).mockReturnValue({ select: selectFn } as never);

    const result = await listSuggestions(MEETING_ID);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
    expect(result[1].status).toBe('accepted');
  });

  it("carries the LIVE.3 'project' type and acceptedProjectId through the mapper", async () => {
    const rows = [makeRow({ id: 'p', type: 'project', status: 'accepted', acceptedProjectId: 'proj-9' })];
    const selectFn = vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    }));
    vi.mocked(getDb).mockReturnValue({ select: selectFn } as never);

    const result = await listSuggestions(MEETING_ID);

    expect(result[0].type).toBe('project');
    expect(result[0].acceptedProjectId).toBe('proj-9');
  });
});
