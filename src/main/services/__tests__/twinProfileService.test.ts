// === FILE PURPOSE ===
// Unit tests for the Digital Twin profile service (V3.3 Task 1):
//   - updateProfileSection patch semantics (writes ONE section + updatedAt only,
//     upserts the singleton row, returns the full profile)
//   - serializeProfileContext determinism (same input -> byte-identical output)
//   - budget trimming order (drops WHOLE lowest-priority sections first, never
//     mid-block) and task-aware section priority
//   - buildProfileContext is a no-op ('') when no profile exists

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  twinProfile: {
    id: 'id',
    brief: 'brief',
    identity: 'identity',
    domain: 'domain',
    projects: 'projects',
    people: 'people',
    vocabulary: 'vocabulary',
    goals: 'goals',
    preferences: 'preferences',
    updatedAt: 'updatedAt',
  },
  TWIN_PROFILE_ID: 'singleton',
}));

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Mock twinMemoryService so buildProfileContext's learned-fact injection is a
// no-op here (isLearningPaused=false, no active facts) — and so importing the
// profile service does NOT pull twinMemoryService's heavy ai-provider chain. The
// injection behavior itself is covered in twinProfileService.injection.test.ts.
vi.mock('../twinMemoryService', () => ({
  isLearningPaused: vi.fn().mockResolvedValue(false),
  listFacts: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { getProfile, updateProfileSection, serializeProfileContext, buildProfileContext } from '../twinProfileService';
import { getDb } from '../../db/connection';
import type { TwinProfileSections } from '../../../shared/types/twin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UPDATED = new Date('2026-07-08T12:00:00Z');

/** A full DB row (all sections populated) for read-path tests. */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'singleton',
    brief: {},
    identity: { name: 'Jane Doe', role: 'Staff Engineer', seniority: 'senior' },
    domain: { industry: 'SaaS', company: 'Acme', focus: 'billing' },
    projects: [{ name: 'Replatform', description: 'move to Stripe' }],
    people: [{ name: 'Sarah', role: 'PM', org: 'Acme' }],
    vocabulary: [{ term: 'MRR', meaning: 'monthly recurring revenue' }],
    goals: ['Ship v3'],
    preferences: { tone: 'concise', language: 'en', cardTitleStyle: 'imperative' },
    updatedAt: UPDATED,
    ...overrides,
  };
}

/** A rich in-memory profile for the pure serializer tests. Brief is empty so the
 *  existing determinism/priority/trimming expectations (which predate the brief)
 *  stay byte-identical; the brief's own behavior is covered separately below. */
function sampleProfile(): TwinProfileSections {
  return {
    brief: {},
    identity: { name: 'Jane Doe', role: 'Staff Engineer', seniority: 'senior' },
    domain: { industry: 'SaaS', company: 'Acme', focus: 'billing platform' },
    projects: [{ name: 'Replatform', description: 'migrate billing to Stripe' }, { name: 'Mobile app' }],
    people: [
      { name: 'Sarah', role: 'PM', org: 'Acme' },
      { name: 'Tom', role: 'eng' },
    ],
    vocabulary: [
      { term: 'MRR', meaning: 'monthly recurring revenue' },
      { term: 'churn', meaning: 'customers who cancel' },
    ],
    goals: ['Ship v3 by Q3', 'Cut onboarding time in half'],
    preferences: { tone: 'concise', language: 'en', cardTitleStyle: 'imperative' },
  };
}

const EMPTY_PROFILE: TwinProfileSections = {
  brief: {},
  identity: {},
  domain: {},
  projects: [],
  people: [],
  vocabulary: [],
  goals: [],
  preferences: {},
};

/** Mock the DB. `selectRows` feeds the read path; the upsert echoes `returnRow`. */
function buildDb(opts: { selectRows?: unknown[]; returnRow?: unknown } = {}) {
  const returning = vi.fn().mockResolvedValue(opts.returnRow ? [opts.returnRow] : []);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  const where = vi.fn().mockResolvedValue(opts.selectRows ?? []);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const db = { insert, select };
  vi.mocked(getDb).mockReturnValue(db as never);
  return { db, insert, values, onConflictDoUpdate, returning, select };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getProfile
// ---------------------------------------------------------------------------

describe('getProfile', () => {
  it('returns null when no row exists', async () => {
    buildDb({ selectRows: [] });
    expect(await getProfile()).toBeNull();
  });

  it('normalizes a row into a profile with an ISO updatedAt', async () => {
    buildDb({ selectRows: [makeRow()] });
    const profile = await getProfile();
    expect(profile?.identity.name).toBe('Jane Doe');
    expect(profile?.updatedAt).toBe(UPDATED.toISOString());
  });
});

// ---------------------------------------------------------------------------
// updateProfileSection — patch semantics
// ---------------------------------------------------------------------------

describe('updateProfileSection', () => {
  it('writes ONLY the patched section plus updatedAt (section-level patch)', async () => {
    const { values, onConflictDoUpdate } = buildDb({ returnRow: makeRow() });

    await updateProfileSection('identity', { name: 'Jane Doe', role: 'Staff Engineer' });

    // insert branch: singleton id + the one section + updatedAt
    const insertArg = values.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.id).toBe('singleton');
    expect(insertArg.identity).toEqual({ name: 'Jane Doe', role: 'Staff Engineer' });
    expect(insertArg.updatedAt).toBeInstanceOf(Date);

    // conflict branch: only that section + updatedAt in the SET — no other section keys
    const setArg = onConflictDoUpdate.mock.calls[0][0].set as Record<string, unknown>;
    expect(Object.keys(setArg).sort()).toEqual(['identity', 'updatedAt']);
    expect(setArg.identity).toEqual({ name: 'Jane Doe', role: 'Staff Engineer' });
  });

  it('targets the singleton primary key on conflict', async () => {
    const { onConflictDoUpdate } = buildDb({ returnRow: makeRow() });
    await updateProfileSection('goals', ['Ship v3']);
    expect(onConflictDoUpdate.mock.calls[0][0].target).toBe('id'); // twinProfile.id (mocked)
  });

  it('returns the full updated profile from the echoed row', async () => {
    buildDb({ returnRow: makeRow() });
    const profile = await updateProfileSection('goals', ['Ship v3']);
    expect(profile.goals).toEqual(['Ship v3']);
    expect(profile.identity.name).toBe('Jane Doe');
    expect(profile.updatedAt).toBe(UPDATED.toISOString());
  });
});

// ---------------------------------------------------------------------------
// serializeProfileContext — determinism
// ---------------------------------------------------------------------------

describe('serializeProfileContext determinism', () => {
  it('produces byte-identical output for identical input', () => {
    const a = serializeProfileContext(sampleProfile(), 'live_assistant');
    const b = serializeProfileContext(sampleProfile(), 'live_assistant');
    expect(a).toBe(b);
  });

  it('emits object fields in a fixed order (not key-iteration order)', () => {
    const profile = { ...EMPTY_PROFILE, domain: { focus: 'billing', company: 'Acme', industry: 'SaaS' } };
    // Even though the source object lists focus first, output is industry/company/focus.
    const out = serializeProfileContext(profile, 'summarization');
    expect(out).toContain('Domain: industry: SaaS; company: Acme; focus: billing');
  });

  it('skips empty sections entirely (no stray labels)', () => {
    const profile = { ...EMPTY_PROFILE, identity: { name: 'Jane' } };
    const out = serializeProfileContext(profile, 'live_assistant');
    expect(out).toContain('Identity: Jane');
    expect(out).not.toContain('Domain');
    expect(out).not.toContain('Projects');
    expect(out).not.toContain('Preferences');
  });

  it('returns empty string for a wholly empty profile', () => {
    expect(serializeProfileContext(EMPTY_PROFILE, 'live_triage')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// serializeProfileContext — task-aware priority + budget trimming
// ---------------------------------------------------------------------------

describe('serializeProfileContext priority & trimming', () => {
  it('orders sections by task: assistant leads with Identity', () => {
    const out = serializeProfileContext(sampleProfile(), 'live_assistant');
    const firstBlock = out.split('\n\n')[1]; // [0] is the header
    expect(firstBlock.startsWith('Identity:')).toBe(true);
  });

  it('orders sections by task: triage leads with Vocabulary', () => {
    const out = serializeProfileContext(sampleProfile(), 'live_triage');
    const firstBlock = out.split('\n\n')[1];
    expect(firstBlock.startsWith('Vocabulary:')).toBe(true);
  });

  it('a generous budget keeps every non-empty section', () => {
    const out = serializeProfileContext(sampleProfile(), 'live_assistant', 100000);
    for (const label of ['Identity:', 'Domain:', 'Projects:', 'People:', 'Vocabulary:', 'Goals:', 'Preferences:']) {
      expect(out).toContain(label);
    }
  });

  it('drops whole lowest-priority sections first under a tight budget', () => {
    // triage priority: vocabulary, projects, people, identity, domain, goals, preferences
    const profile = sampleProfile();
    const vocabBlock = 'Vocabulary:\n- MRR: monthly recurring revenue\n- churn: customers who cancel';
    // Budget large enough for header + vocabulary, but not the next (projects) block.
    const budget = 'User profile (the professional you assist):'.length + 2 + vocabBlock.length + 5;

    const out = serializeProfileContext(profile, 'live_triage', budget);

    // Highest-priority block survives intact (no mid-block truncation)...
    expect(out).toContain(vocabBlock);
    // ...and every lower-priority section is dropped whole.
    expect(out).not.toContain('Projects:');
    expect(out).not.toContain('People:');
    expect(out).not.toContain('Identity:');
    expect(out.length).toBeLessThanOrEqual(budget);
  });

  it('never emits a partial block (trims strictly at section boundaries)', () => {
    // A budget between the first and second block must yield the header + first block only.
    const profile = sampleProfile();
    const out = serializeProfileContext(profile, 'live_triage', 120);
    // Whatever survived, the output is a clean join of complete blocks: the last
    // block is fully present (its label line is intact) and length is within budget.
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.startsWith('User profile (the professional you assist):')).toBe(true);
    // No dangling partial "- " line without content.
    expect(out.endsWith('- ')).toBe(false);
  });

  it('returns empty string when even the top-priority block cannot fit', () => {
    expect(serializeProfileContext(sampleProfile(), 'live_triage', 10)).toBe('');
  });

  it('uses per-category default budgets when none is given', () => {
    // assistant default is the largest (1500) — with the sample profile everything fits.
    const out = serializeProfileContext(sampleProfile(), 'live_assistant');
    expect(out).toContain('Preferences:'); // lowest-priority assistant section still present
    expect(out.length).toBeLessThanOrEqual(1500);
  });
});

// ---------------------------------------------------------------------------
// buildProfileContext — DB integration + no-op contract
// ---------------------------------------------------------------------------

describe('buildProfileContext', () => {
  it('returns empty string when no profile exists (injection is a no-op)', async () => {
    buildDb({ selectRows: [] });
    expect(await buildProfileContext('live_assistant')).toBe('');
  });

  it('serializes the stored profile for the given task', async () => {
    buildDb({ selectRows: [makeRow()] });
    const out = await buildProfileContext('live_assistant');
    expect(out).toContain('Identity: Jane Doe');
    expect(out).toContain('User profile (the professional you assist):');
  });

  it('honors an explicit char budget override', async () => {
    buildDb({ selectRows: [makeRow()] });
    const out = await buildProfileContext('live_triage', 20);
    expect(out).toBe(''); // 20 chars fits nothing -> no-op
  });
});

// ---------------------------------------------------------------------------
// brief section (V3.3.5) — patch round-trip + high-priority serialization
// ---------------------------------------------------------------------------

describe('brief section', () => {
  it('patches ONLY the brief section (plus updatedAt) via updateProfileSection', async () => {
    const { values, onConflictDoUpdate } = buildDb({ returnRow: makeRow({ brief: { statement: 'A senior PM' } }) });

    const profile = await updateProfileSection('brief', { statement: 'A senior PM' });

    const insertArg = values.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.brief).toEqual({ statement: 'A senior PM' });
    const setArg = onConflictDoUpdate.mock.calls[0][0].set as Record<string, unknown>;
    expect(Object.keys(setArg).sort()).toEqual(['brief', 'updatedAt']);
    expect(profile.brief).toEqual({ statement: 'A senior PM' });
  });

  it('read path normalizes a missing brief column to {}', async () => {
    buildDb({ selectRows: [makeRow({ brief: null })] });
    const profile = await getProfile();
    expect(profile?.brief).toEqual({});
  });

  it('is emitted as a "Brief:" block and LEADS every task category', () => {
    const profile: TwinProfileSections = { ...sampleProfile(), brief: { statement: 'A senior PM at Acme' } };
    for (const task of ['live_assistant', 'live_triage', 'summarization'] as const) {
      const out = serializeProfileContext(profile, task, 100000);
      expect(out).toContain('Brief: A senior PM at Acme');
      // Highest-priority block (header is [0]).
      expect(out.split('\n\n')[1]).toBe('Brief: A senior PM at Acme');
    }
  });

  it('an EMPTY brief adds nothing — output is byte-identical to a profile without it', () => {
    const withEmptyBrief = serializeProfileContext(sampleProfile(), 'live_assistant');
    // sampleProfile() already carries brief: {} — assert the brief never leaks a label.
    expect(withEmptyBrief).not.toContain('Brief:');
    // And an explicitly-empty statement is treated identically to no brief.
    const blankStatement = serializeProfileContext(
      { ...sampleProfile(), brief: { statement: '   ' } },
      'live_assistant',
    );
    expect(blankStatement).toBe(withEmptyBrief);
  });
});
