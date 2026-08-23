// === FILE PURPOSE ===
// Unit tests for briefRecordService (BRIEF-QUAL.2 Task 3) — the shared "brief +
// full notes" read path for twinMemoryService, entityFactService and
// meetingAgentService. Proves:
//   - parseStructureValue mirrors meetingIntelligenceService's private
//     parseBriefStructure: null on anything falsy or failing validation.
//   - loadLatestBriefRecord reads summary + structure in ONE query, degrading
//     to '' / null when there is no brief, an invalid jsonb value, or a
//     failure card (AI-RESIL.1 — no structure).
//   - fitNotesWithinBudget cuts ONLY at a whole-line `\n` boundary, discloses
//     the cut with a marker, and returns '' when even one line can't fit.
// No DB/schema/drizzle-orm mocking needed: loadLatestBriefRecord takes `db` as
// a plain parameter, so a hand-built fake matching only the
// .select().from().where().orderBy().limit() chain is enough.

import { describe, it, expect } from 'vitest';
import {
  parseStructureValue,
  loadLatestBriefRecord,
  fitNotesWithinBudget,
  NOTES_TRUNCATION_MARKER,
} from '../briefRecordService';
import type { MeetingStructure } from '../../../shared/types/briefStructure';
import { BRIEF_FAILURE_SENTINEL } from '../../../shared/briefSentinel';

const VALID_STRUCTURE: MeetingStructure = {
  topics: [{ title: 'Pricing tiers', detail: 'Discussed the new packaging' }],
  decisions: [],
  commitments: [],
  openQuestions: [],
  terms: [],
  provenance: { provider: 'openai', model: 'gpt-x', passes: 1, extractedAt: '2026-08-01T00:00:00Z', schemaVersion: 1 },
};

describe('parseStructureValue', () => {
  it('returns the parsed structure for a valid value', () => {
    expect(parseStructureValue(VALID_STRUCTURE)).toEqual(VALID_STRUCTURE);
  });

  it('returns null for null/undefined (no structure stored)', () => {
    expect(parseStructureValue(null)).toBeNull();
    expect(parseStructureValue(undefined)).toBeNull();
  });

  it('returns null for a value that fails schema validation (missing required provenance)', () => {
    expect(parseStructureValue({ topics: [] })).toBeNull();
    expect(parseStructureValue('not an object')).toBeNull();
  });
});

// A minimal fake `db` matching only the exact chain loadLatestBriefRecord
// calls — no need to mock drizzle-orm or the real schema module, since the
// fake resolves directly to canned rows regardless of the projection/filter.
function fakeDb(rows: { summary: string; structure: unknown }[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(rows),
          }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof loadLatestBriefRecord>[0];
}

describe('loadLatestBriefRecord', () => {
  it('returns the summary and parsed structure from the newest brief row', async () => {
    const result = await loadLatestBriefRecord(
      fakeDb([{ summary: 'Discussed billing.', structure: VALID_STRUCTURE }]),
      'm1',
    );
    expect(result).toEqual({ summary: 'Discussed billing.', structure: VALID_STRUCTURE });
  });

  it("returns { summary: '', structure: null } when the meeting has no brief yet", async () => {
    const result = await loadLatestBriefRecord(fakeDb([]), 'm1');
    expect(result).toEqual({ summary: '', structure: null });
  });

  it('returns a null structure for an invalid jsonb value (fails schema validation)', async () => {
    const result = await loadLatestBriefRecord(
      fakeDb([{ summary: 'Discussed billing.', structure: { garbage: true } }]),
      'm1',
    );
    expect(result).toEqual({ summary: 'Discussed billing.', structure: null });
  });

  it('returns a null structure for a failure card (AI-RESIL.1 — structure column is null)', async () => {
    const result = await loadLatestBriefRecord(fakeDb([{ summary: BRIEF_FAILURE_SENTINEL, structure: null }]), 'm1');
    expect(result).toEqual({ summary: BRIEF_FAILURE_SENTINEL, structure: null });
  });
});

describe('fitNotesWithinBudget', () => {
  it('returns notes unchanged when they already fit within budget (exact fit, no marker)', () => {
    expect(fitNotesWithinBudget('hello world', 11)).toBe('hello world'); // budget === length
    expect(fitNotesWithinBudget('hello world', 50)).toBe('hello world'); // room to spare
    expect(fitNotesWithinBudget('hello world', 50)).not.toContain(NOTES_TRUNCATION_MARKER);
  });

  it('cuts at the last whole-line boundary that fits and appends the marker', () => {
    const line1 = 'A'.repeat(20);
    const line2 = 'B'.repeat(20);
    const line3 = 'C'.repeat(20);
    const notes = `${line1}\n${line2}\n${line3}`;
    // Room for line1 + the \n before the marker + the marker itself — NOT enough
    // for line2 too, so the cut must land right after line1.
    const budget = line1.length + 1 + NOTES_TRUNCATION_MARKER.length;

    const result = fitNotesWithinBudget(notes, budget);

    expect(result).toBe(`${line1}\n${NOTES_TRUNCATION_MARKER}`);
    expect(result).not.toContain('B'); // whole-line cut, never mid-sentence — line2/line3 gone entirely
    expect(result.length).toBeLessThanOrEqual(budget);
  });

  it('the marker is present ONLY when the notes were actually cut', () => {
    expect(fitNotesWithinBudget('short notes, well under budget', 100)).not.toContain(NOTES_TRUNCATION_MARKER);

    const line1 = 'A'.repeat(10);
    const line2 = 'B'.repeat(50);
    const notes = `${line1}\n${line2}`;
    const budget = line1.length + 1 + NOTES_TRUNCATION_MARKER.length; // < notes.length, forces a cut
    expect(fitNotesWithinBudget(notes, budget)).toContain(NOTES_TRUNCATION_MARKER);
  });

  it("returns '' when the budget cannot hold even one full line plus the marker", () => {
    expect(fitNotesWithinBudget('line one\nline two', 5)).toBe('');
    expect(fitNotesWithinBudget('a single line with no newline at all', 5)).toBe('');
  });
});
