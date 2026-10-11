// === FILE PURPOSE ===
// TWIN-LOOP.2 Task 5: the wizard saves the whole twin profile in ONE transaction, and the
// twin:save-profile channel refuses oversized input before anything is written. Run against
// a real migrated PGlite database (a mocked insert cannot roll back): a failure on the 5th
// section must leave the previous profile exactly as it was. The real IPC handler is
// registered so the over-limit and near-limit cases go through the actual validation.
// All fixture text is neutral and synthetic - no real profile or meeting content.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../../db/schema';
import { twinProfile } from '../../db/schema';
import type { TwinProfileSections } from '../../../shared/types/twin';

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));
const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>() }));
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => ipc.handlers.set(channel, fn) },
}));
// Everything the IPC module imports besides the profile service is out of scope here.
vi.mock('../twinMemoryService', () => ({
  isLearningPaused: vi.fn().mockResolvedValue(false),
  areLearnedFactsInUse: vi.fn().mockResolvedValue(true),
  listFacts: vi.fn().mockResolvedValue([]),
}));
vi.mock('../twinGraphService', () => ({}));
vi.mock('../twinInterviewService', () => ({ draftSection: vi.fn() }));
vi.mock('../twinDeepInterviewService', () => ({}));
vi.mock('../twinResearchService', () => ({}));
vi.mock('../twinWebResearchService', () => ({}));
vi.mock('../ai-provider', () => ({ resolveTaskModel: vi.fn(), getTwinLearningModelInfo: vi.fn() }));

import { getProfile, saveProfile } from '../twinProfileService';
import { registerTwinHandlers } from '../../ipc/twin';

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  registerTwinHandlers();
});

beforeEach(async () => {
  await holder.db.delete(twinProfile);
});

const save = (profile: unknown) => ipc.handlers.get('twin:save-profile')!({}, profile);

function profileA(): TwinProfileSections {
  return {
    brief: { statement: 'Synthetic brief A.' },
    identity: { name: 'Alex Example', role: 'Engineering Manager', seniority: 'senior' },
    domain: { industry: 'Logistics', company: 'Example Co', focus: 'Route planning' },
    projects: [{ name: 'Project One', description: 'The first synthetic project.' }],
    people: [{ name: 'Sam Sample', role: 'Designer', org: 'Example Co' }],
    vocabulary: [{ term: 'ETA', meaning: 'estimated time of arrival' }],
    goals: ['Ship the first release'],
    preferences: { tone: 'concise', language: 'English', cardTitleStyle: 'imperative' },
  };
}

function profileB(): TwinProfileSections {
  return {
    brief: { statement: 'Synthetic brief B.' },
    identity: { name: 'Blake Other', role: 'Analyst' },
    domain: { industry: 'Retail' },
    projects: [{ name: 'Project Two' }],
    people: [{ name: 'Robin Roe' }],
    vocabulary: [{ term: 'SKU', meaning: 'stock keeping unit' }],
    goals: ['Cut returns'],
    preferences: { tone: 'formal' },
  };
}

/**
 * Make the Nth insert of the next save throw, after the earlier ones really ran. The
 * failure is injected on the transaction handle AND on the plain database handle, so a
 * save that stopped using a transaction would still hit it - and then leave a partial
 * profile behind, which is exactly what the assertions below catch.
 */
function failNthInsert(n: number): () => void {
  const real = holder.db;
  let calls = 0;
  const failing = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(t, p, r) {
        if (p !== 'insert') return Reflect.get(t, p, r);
        return (...args: unknown[]) => {
          calls += 1;
          if (calls === n) throw new Error(`forced failure on section ${n}`);
          return (t as never as { insert: (...a: unknown[]) => unknown }).insert(...args);
        };
      },
    });
  holder.db = new Proxy(failing(real), {
    get(t, p, r) {
      if (p !== 'transaction') return Reflect.get(t, p, r);
      return (cb: (tx: unknown) => Promise<unknown>) => real.transaction(async (tx) => cb(failing(tx)));
    },
  });
  return () => {
    holder.db = real;
  };
}

describe('saveProfile - one transaction', () => {
  it('writes all eight sections and returns the saved profile', async () => {
    const saved = await saveProfile(profileA());
    expect(saved).toMatchObject(profileA());
    expect(await getProfile()).toEqual(saved);
  });

  it('a failure on the 5th section leaves the previous profile exactly as it was', async () => {
    const previous = await saveProfile(profileA());
    const restore = failNthInsert(5);
    try {
      await expect(saveProfile(profileB())).rejects.toThrow('forced failure on section 5');
    } finally {
      restore();
    }
    // Includes updatedAt: not even the timestamp moved.
    expect(await getProfile()).toEqual(previous);
  });

  it('a failure on the 5th section of a FIRST save leaves no profile at all', async () => {
    const restore = failNthInsert(5);
    try {
      await expect(saveProfile(profileA())).rejects.toThrow('forced failure on section 5');
    } finally {
      restore();
    }
    expect(await getProfile()).toBeNull();
  });
});

describe('twin:save-profile - bounded input', () => {
  it('rejects an over-limit string with the validation error and writes nothing', async () => {
    const previous = await saveProfile(profileA());
    const tooLong = { ...profileB(), goals: ['x'.repeat(4001)] };
    await expect(save(tooLong)).rejects.toThrow('Validation failed');
    expect(await getProfile()).toEqual(previous);
  });

  it('rejects a short field over 200 even when the other seven sections are valid', async () => {
    const previous = await saveProfile(profileA());
    const bad = { ...profileB(), identity: { name: 'n'.repeat(201) } };
    await expect(save(bad)).rejects.toThrow('Validation failed');
    expect(await getProfile()).toEqual(previous);
  });

  it('rejects a list over 500 entries', async () => {
    const bad = { ...profileB(), vocabulary: Array.from({ length: 501 }, (_, i) => ({ term: `t${i}`, meaning: 'm' })) };
    await expect(save(bad)).rejects.toThrow('Validation failed');
    expect(await getProfile()).toBeNull();
  });

  it('saves a large synthetic profile with every field near (but under) its limit', async () => {
    const short = (c: string) => c.repeat(200);
    const text = (c: string) => c.repeat(4000);
    const large: TwinProfileSections = {
      brief: { statement: text('b') },
      identity: { name: short('a'), role: short('r'), seniority: short('s') },
      domain: { industry: short('i'), company: short('c'), focus: text('f') },
      projects: Array.from({ length: 500 }, (_, i) => ({
        name: `${short('p')}`.slice(0, 190) + String(i).padStart(3, '0'),
        description: text('d'),
        projectId: short('j'),
      })),
      people: Array.from({ length: 500 }, (_, i) => ({ name: `Person ${i}`, role: short('r'), org: short('o') })),
      vocabulary: Array.from({ length: 500 }, (_, i) => ({ term: `Term ${i}`, meaning: text('m') })),
      goals: Array.from({ length: 500 }, () => text('g')),
      preferences: { tone: text('t'), language: short('l'), cardTitleStyle: text('y') },
    };
    const saved = (await save(large)) as { projects: unknown[]; goals: string[] };
    expect(saved.projects).toHaveLength(500);
    expect(saved.goals[499]).toHaveLength(4000);
    expect(await getProfile()).toMatchObject(large);
  });
});
