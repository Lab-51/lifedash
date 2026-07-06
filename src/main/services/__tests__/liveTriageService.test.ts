// === FILE PURPOSE ===
// Unit tests for the proactive triage loop (LIVE.2). Mocks the DB, meetingService,
// ai-provider, and the chat in-flight signal. Verifies the load-bearing behaviour:
// cadence gating (no run under CADENCE_SEGMENTS new segments), the in-flight guard,
// chat-priority skip (skip not queue), dedupe titles injected into the prompt,
// malformed-JSON retry-then-skip (never throws), the MAX_PROPOSALS cap, and that
// lifecycle stop clears the watermark/state.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  BrowserWindow: class {},
}));

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  liveSuggestions: { meetingId: 'meetingId', title: 'title', type: 'type' },
}));

vi.mock('../meetingService', () => ({ getMeeting: vi.fn() }));

vi.mock('../ai-provider', () => ({ resolveTaskModel: vi.fn(), generate: vi.fn() }));

vi.mock('../../ipc/meeting-agent', () => ({ isMeetingAgentStreamActive: vi.fn(() => false) }));

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  startTriage,
  stopTriage,
  onSegment,
  setMainWindow,
  setTranscriptionBusyProbe,
  parseSuggestions,
  CADENCE_SEGMENTS,
  MAX_PROPOSALS,
} from '../liveTriageService';
import { getDb } from '../../db/connection';
import { getMeeting } from '../meetingService';
import { resolveTaskModel, generate } from '../ai-provider';
import { isMeetingAgentStreamActive } from '../../ipc/meeting-agent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MEETING_ID = '550e8400-e29b-41d4-a716-446655440000';

function makeSegments(n: number): Array<{ startTime: number; endTime: number; content: string }> {
  return Array.from({ length: n }, (_, i) => ({
    startTime: i * 10000,
    endTime: (i + 1) * 10000,
    content: `segment ${i} text`,
  }));
}

/**
 * Build a DB mock: select→existing proposals ({title,type}), insert→row echoing the
 * values. Accepts plain title strings (default type 'action_item') or {title,type}
 * objects so tests can seed an existing 'project' proposal.
 */
function buildDb(existing: Array<string | { title: string; type?: string }> = []) {
  const rows = existing.map((e) =>
    typeof e === 'string' ? { title: e, type: 'action_item' } : { title: e.title, type: e.type ?? 'action_item' },
  );
  const insertedValues: Array<Record<string, unknown>> = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(rows),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        insertedValues.push(v);
        return {
          returning: vi.fn().mockResolvedValue([
            {
              id: `sug-${insertedValues.length}`,
              meetingId: v.meetingId,
              type: v.type,
              title: v.title,
              description: v.description ?? null,
              status: v.status ?? 'proposed',
              acceptedCardId: null,
              acceptedProjectId: null,
              createdAt: new Date('2026-07-06T00:00:00Z'),
              updatedAt: new Date('2026-07-06T00:00:00Z'),
            },
          ]),
        };
      }),
    })),
  };
  vi.mocked(getDb).mockReturnValue(db as never);
  return { db, insertedValues };
}

function makeWindow() {
  const send = vi.fn();
  setMainWindow({ isDestroyed: () => false, webContents: { send } } as never);
  return send;
}

/** Emit `n` segment notifications synchronously. */
function emitSegments(n: number) {
  for (let i = 0; i < n; i++) onSegment(MEETING_ID);
}

/** Let queued microtasks (the async run) settle. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

function jsonText(items: Array<{ type: string; title: string; description?: string }>): { text: string } {
  return { text: JSON.stringify(items) };
}

const PROVIDER = {
  providerId: 'p1',
  providerName: 'lmstudio',
  apiKeyEncrypted: null,
  baseUrl: null,
  model: 'local',
  temperature: 0,
  maxTokens: 512,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isMeetingAgentStreamActive).mockReturnValue(false);
  setTranscriptionBusyProbe(null); // reset the injected probe between tests

  vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER as never);
  vi.mocked(getMeeting).mockResolvedValue({ title: 'Weekly Sync', segments: makeSegments(4) } as never);
  vi.mocked(generate).mockResolvedValue(jsonText([{ type: 'action_item', title: 'Ship the beta' }]) as never);
  buildDb();
  makeWindow();
});

// ---------------------------------------------------------------------------
// parseSuggestions — pure validation
// ---------------------------------------------------------------------------

describe('parseSuggestions', () => {
  it('parses a plain JSON array', () => {
    const out = parseSuggestions('[{"type":"decision","title":"Adopt weekly triage"}]');
    expect(out).toEqual([{ type: 'decision', title: 'Adopt weekly triage' }]);
  });

  it('strips a ```json code fence', () => {
    const out = parseSuggestions('```json\n[{"type":"question","title":"Who owns QA?"}]\n```');
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('question');
  });

  it('caps at MAX_PROPOSALS', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ type: 'action_item', title: `t${i}` }));
    expect(parseSuggestions(JSON.stringify(many))).toHaveLength(MAX_PROPOSALS);
  });

  it('throws on non-JSON', () => {
    expect(() => parseSuggestions('not json at all')).toThrow();
  });

  it('throws on schema mismatch (bad type)', () => {
    expect(() => parseSuggestions('[{"type":"bogus","title":"x"}]')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cadence gating
// ---------------------------------------------------------------------------

describe('cadence gating', () => {
  it('does not run below CADENCE_SEGMENTS new segments', async () => {
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS - 1);
    await flush();
    expect(generate).not.toHaveBeenCalled();
    expect(getMeeting).not.toHaveBeenCalled();
  });

  it('runs once cadence is reached and persists + emits proposals', async () => {
    const send = makeWindow();
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('live-triage:suggestion', expect.objectContaining({ title: 'Ship the beta' }));
  });

  it('ignores onSegment for a meeting that was never started', async () => {
    emitSegments(CADENCE_SEGMENTS + 2);
    await flush();
    expect(generate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// In-flight guard
// ---------------------------------------------------------------------------

describe('in-flight guard', () => {
  it('does not start a second run while one is in flight', async () => {
    // Hold the first run open on the generate() await.
    let release: (v: { text: string }) => void = () => {};
    vi.mocked(generate).mockReturnValueOnce(
      new Promise<{ text: string }>((resolve) => {
        release = resolve;
      }) as never,
    );

    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS); // starts run 1 (awaiting generate)
    await flush();
    expect(generate).toHaveBeenCalledTimes(1);

    emitSegments(CADENCE_SEGMENTS); // should be blocked by the in-flight guard
    await flush();
    expect(generate).toHaveBeenCalledTimes(1);

    release(jsonText([{ type: 'action_item', title: 'Ship the beta' }]));
    await flush();
  });
});

// ---------------------------------------------------------------------------
// Chat-priority skip
// ---------------------------------------------------------------------------

describe('chat-priority skip', () => {
  it('skips (does not queue, does not run) while a chat stream is in flight', async () => {
    vi.mocked(isMeetingAgentStreamActive).mockReturnValue(true);
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS + 3);
    await flush();
    expect(generate).not.toHaveBeenCalled();
  });

  it('runs on the next segment once chat frees the model (pending retained)', async () => {
    vi.mocked(isMeetingAgentStreamActive).mockReturnValue(true);
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();
    expect(generate).not.toHaveBeenCalled();

    // Chat ends; the very next segment should let the retained pending fire a run.
    vi.mocked(isMeetingAgentStreamActive).mockReturnValue(false);
    emitSegments(1);
    await flush();
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Transcription-priority skip (yield the shared GPU to in-flight transcription)
// ---------------------------------------------------------------------------

describe('transcription-priority skip', () => {
  it('skips (does not queue, does not run) while transcription is in flight', async () => {
    setTranscriptionBusyProbe(() => true);
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS + 3);
    await flush();
    expect(generate).not.toHaveBeenCalled();
  });

  it('runs on the next segment once transcription drains (pending retained)', async () => {
    let busy = true;
    setTranscriptionBusyProbe(() => busy);
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();
    expect(generate).not.toHaveBeenCalled();

    // Transcription queue drains; the very next segment lets the retained pending fire.
    busy = false;
    emitSegments(1);
    await flush();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('runs at cadence when the probe reports idle', async () => {
    setTranscriptionBusyProbe(() => false);
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('runs at cadence when no probe is registered (default not-busy)', async () => {
    setTranscriptionBusyProbe(null);
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

describe('dedupe', () => {
  it('injects existing proposal titles into the prompt as "do not repeat"', async () => {
    buildDb(['Ship the beta', 'Hire a QA engineer']);
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();

    expect(generate).toHaveBeenCalledTimes(1);
    const promptArg = vi.mocked(generate).mock.calls[0][0].prompt;
    expect(promptArg).toContain('do NOT repeat');
    expect(promptArg).toContain('Ship the beta');
    expect(promptArg).toContain('Hire a QA engineer');
  });

  it('does not persist a draft whose title matches an existing proposal', async () => {
    const { insertedValues } = buildDb(['Ship the beta']);
    vi.mocked(generate).mockResolvedValue(
      jsonText([
        { type: 'action_item', title: 'Ship the beta' }, // duplicate — dropped
        { type: 'decision', title: 'Adopt weekly triage' }, // new — kept
      ]) as never,
    );
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();

    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0].title).toBe('Adopt weekly triage');
  });
});

// ---------------------------------------------------------------------------
// Malformed-JSON retry then skip
// ---------------------------------------------------------------------------

describe('malformed JSON handling', () => {
  it('retries once with the error appended, then succeeds', async () => {
    const { insertedValues } = buildDb();
    vi.mocked(generate)
      .mockResolvedValueOnce({ text: 'totally not json' } as never)
      .mockResolvedValueOnce(jsonText([{ type: 'question', title: 'Who signs off?' }]) as never);

    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();

    expect(generate).toHaveBeenCalledTimes(2);
    // Second attempt carries the rejection notice.
    expect(vi.mocked(generate).mock.calls[1][0].prompt).toContain('previous reply was rejected');
    expect(insertedValues).toHaveLength(1);
  });

  it('skips the run after two malformed replies — never throws, nothing persisted', async () => {
    const { insertedValues } = buildDb();
    vi.mocked(generate).mockResolvedValue({ text: 'still not json' } as never);

    startTriage(MEETING_ID);
    expect(() => emitSegments(CADENCE_SEGMENTS)).not.toThrow();
    await flush();

    expect(generate).toHaveBeenCalledTimes(2);
    expect(insertedValues).toHaveLength(0);
  });

  it('never throws into the pipeline when getMeeting fails', async () => {
    vi.mocked(getMeeting).mockRejectedValue(new Error('db exploded'));
    startTriage(MEETING_ID);
    expect(() => emitSegments(CADENCE_SEGMENTS)).not.toThrow();
    await flush();
    expect(generate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// MAX_PROPOSALS cap
// ---------------------------------------------------------------------------

describe('proposal cap', () => {
  it('persists at most MAX_PROPOSALS rows per run', async () => {
    const { insertedValues } = buildDb();
    vi.mocked(generate).mockResolvedValue(
      jsonText(Array.from({ length: 6 }, (_, i) => ({ type: 'action_item', title: `Task ${i}` }))) as never,
    );
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();
    expect(insertedValues.length).toBe(MAX_PROPOSALS);
  });
});

// ---------------------------------------------------------------------------
// Project proposals (LIVE.3): unlinked-only, one-per-meeting, dismissed counts
// ---------------------------------------------------------------------------

describe('project proposals (LIVE.3)', () => {
  it('offers the "project" kind in the system prompt only when the meeting is unlinked', async () => {
    vi.mocked(getMeeting).mockResolvedValue({ title: 'Kickoff', projectId: null, segments: makeSegments(4) } as never);
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generate).mock.calls[0][0].system).toContain('"project"');
  });

  it('does NOT offer the "project" kind when the meeting already has a project', async () => {
    vi.mocked(getMeeting).mockResolvedValue({ title: 'Sync', projectId: 'proj-1', segments: makeSegments(4) } as never);
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();

    expect(vi.mocked(generate).mock.calls[0][0].system).not.toContain('"project"');
  });

  it('persists a project chip when unlinked and none exists yet', async () => {
    const { insertedValues } = buildDb();
    vi.mocked(getMeeting).mockResolvedValue({ title: 'Kickoff', projectId: null, segments: makeSegments(4) } as never);
    vi.mocked(generate).mockResolvedValue(jsonText([{ type: 'project', title: 'Mobile App Revamp' }]) as never);
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();

    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0].type).toBe('project');
    expect(insertedValues[0].title).toBe('Mobile App Revamp');
  });

  it('filters project drafts at persist when the meeting is already linked', async () => {
    const { insertedValues } = buildDb();
    vi.mocked(getMeeting).mockResolvedValue({ title: 'Sync', projectId: 'proj-1', segments: makeSegments(4) } as never);
    vi.mocked(generate).mockResolvedValue(
      jsonText([
        { type: 'project', title: 'New Marketing Site' }, // dropped — meeting linked
        { type: 'action_item', title: 'Draft the brief' }, // kept
      ]) as never,
    );
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();

    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0].title).toBe('Draft the brief');
  });

  it('suppresses a second project proposal when one already exists (dismissed counts)', async () => {
    // A prior 'project' row of ANY status means the user already saw the chip.
    const { insertedValues } = buildDb([{ title: 'Old Initiative', type: 'project' }]);
    vi.mocked(getMeeting).mockResolvedValue({ title: 'Kickoff', projectId: null, segments: makeSegments(4) } as never);
    vi.mocked(generate).mockResolvedValue(jsonText([{ type: 'project', title: 'Another Initiative' }]) as never);
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();

    // Not eligible → prompt omits the kind AND any stray project draft is filtered.
    expect(vi.mocked(generate).mock.calls[0][0].system).not.toContain('"project"');
    expect(insertedValues).toHaveLength(0);
  });

  it('caps at ONE project chip per run even if the model returns several', async () => {
    const { insertedValues } = buildDb();
    vi.mocked(getMeeting).mockResolvedValue({ title: 'Kickoff', projectId: null, segments: makeSegments(4) } as never);
    vi.mocked(generate).mockResolvedValue(
      jsonText([
        { type: 'project', title: 'Initiative A' },
        { type: 'project', title: 'Initiative B' },
      ]) as never,
    );
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();

    expect(insertedValues.filter((v) => v.type === 'project')).toHaveLength(1);
    expect(insertedValues[0].title).toBe('Initiative A');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle stop clears watermark/state
// ---------------------------------------------------------------------------

describe('lifecycle stop', () => {
  it('clears state so post-stop segments do not run triage', async () => {
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS - 1); // pending below threshold
    stopTriage(MEETING_ID);

    // These would have crossed the threshold, but state is gone.
    emitSegments(CADENCE_SEGMENTS);
    await flush();
    expect(generate).not.toHaveBeenCalled();
  });

  it('restart resets the watermark (a fresh run can fire again)', async () => {
    startTriage(MEETING_ID);
    emitSegments(CADENCE_SEGMENTS);
    await flush();
    expect(generate).toHaveBeenCalledTimes(1);

    stopTriage(MEETING_ID);
    startTriage(MEETING_ID); // fresh state: pending=0, processed=0
    emitSegments(CADENCE_SEGMENTS);
    await flush();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('stopTriage(null) is a no-op', () => {
    expect(() => stopTriage(null)).not.toThrow();
  });
});
