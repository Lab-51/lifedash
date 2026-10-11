// === FILE PURPOSE ===
// Unit tests for the pure helpers behind the live eval's twin on/off arm
// (fixtures/briefEvalTwin.ts, TWIN-LOOP Task 5): the spelling-hit counter, the
// injected-fact counter, and that the synthetic twin + facts really behave as the
// arm assumes through the real (pure) serializer. No model, no DB.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));
vi.mock('../../db/schema', () => ({ twinProfile: { id: 'id' }, TWIN_PROFILE_ID: 'singleton' }));
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../twinMemoryService', () => ({
  isLearningPaused: vi.fn().mockResolvedValue(false),
  listFacts: vi.fn().mockResolvedValue([]),
}));

import { serializeProfileContext } from '../twinProfileService';
import { meetingRelevanceText } from '../twinRelevance';
import { LONG_FIXTURE } from './fixtures/briefEvalFixtures';
import {
  SYNTHETIC_TWIN_FACTS,
  SYNTHETIC_TWIN_PROFILE,
  TWIN_ARM_EXTRA_LINES,
  countInjectedFacts,
  countSpellingHits,
  twinSpellings,
  withTwinArmLines,
} from './fixtures/briefEvalTwin';

describe('countSpellingHits', () => {
  it('separates exact, loosely-spelled and absent terms', () => {
    const hits = countSpellingHits('Petra Dvořáková met rhosyn quillfeather about Falcon Sync.', [
      'Petra Dvořáková',
      'Rhosyn Quillfeather',
      'Petra Dvorakova',
      'Falcon Sync',
      'Quillmark SLA',
    ]);
    expect(hits.exact).toEqual(['Petra Dvořáková', 'Falcon Sync']);
    expect(hits.nearMiss).toEqual(['Rhosyn Quillfeather', 'Petra Dvorakova']);
    expect(hits.absent).toEqual(['Quillmark SLA']);
  });
});

describe('countInjectedFacts', () => {
  it('counts only facts present verbatim, split by relevance', () => {
    const [unrelated] = SYNTHETIC_TWIN_FACTS.filter((f) => !f.relevant);
    const [relevantA, relevantB] = SYNTHETIC_TWIN_FACTS.filter((f) => f.relevant);
    const counts = countInjectedFacts(`- ${unrelated.fact}\n- ${relevantA.fact}`, SYNTHETIC_TWIN_FACTS);
    expect(counts.relevantInjected).toBe(1);
    expect(counts.unrelatedInjected).toBe(1);
    expect(counts.relevantTotal).toBe(SYNTHETIC_TWIN_FACTS.filter((f) => f.relevant).length);
    expect(counts.unrelatedTotal).toBe(SYNTHETIC_TWIN_FACTS.filter((f) => !f.relevant).length);
    expect(countInjectedFacts(`- ${relevantB.fact}`, SYNTHETIC_TWIN_FACTS).relevantInjected).toBe(1);
  });
});

describe('twin arm fixture', () => {
  const segments = withTwinArmLines(LONG_FIXTURE.segments);
  const transcript = segments.map((s) => s.content).join('\n');

  it('appends the extra lines after the base transcript on a regular spacing, leaving the base untouched', () => {
    expect(segments.slice(0, LONG_FIXTURE.segments.length)).toEqual(LONG_FIXTURE.segments);
    expect(segments.slice(LONG_FIXTURE.segments.length).map((s) => s.content)).toEqual(TWIN_ARM_EXTRA_LINES);
    const gaps = segments.slice(-4).map((s, i, a) => (i === 0 ? 0 : s.startTime - a[i - 1].startTime));
    expect(new Set(gaps.slice(1)).size).toBe(1);
  });

  it('mentions both non-roster people and the unusual term exactly as the profile spells them', () => {
    const hits = countSpellingHits(transcript, twinSpellings());
    expect(hits.exact).toEqual(
      expect.arrayContaining(['Wendeline Ashcroft-Okonkwo', 'Rhosyn Quillfeather', 'Quillmark SLA']),
    );
  });

  it('through the real serializer, injects the relevant facts and drops the newer unrelated ones first', () => {
    const context = serializeProfileContext(
      { brief: {}, goals: [], preferences: {}, projects: [], ...SYNTHETIC_TWIN_PROFILE },
      'summarization',
      undefined,
      SYNTHETIC_TWIN_FACTS.map((f) => f.fact),
      meetingRelevanceText({ title: 'Kestrel Analytics Quarterly Review', segments }),
    );
    const counts = countInjectedFacts(context, SYNTHETIC_TWIN_FACTS);
    expect(counts.relevantInjected).toBeGreaterThan(counts.unrelatedInjected);
    // The profile block reaches the context too, and carries names, not just facts.
    expect(context).toContain('Wendeline Ashcroft-Okonkwo');
  });
});
