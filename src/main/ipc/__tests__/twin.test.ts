// === FILE PURPOSE ===
// IPC behavior tests for the Digital Twin channels (V3.3 + V3.3.5 "Deep Creation").
// Verifies each handler zod-validates its payload and delegates to the right
// (mocked) service, that the new `brief` section patches through
// updateProfileSection, that invalid input is rejected before reaching a service,
// and that twin:get-creation-model derives isLocal/isFrontier from the resolved
// model + the frontier-provider set.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, fn);
    }),
  },
}));

vi.mock('../../services/twinProfileService', () => ({
  getProfile: vi.fn(),
  updateProfileSection: vi.fn(),
  saveProfile: vi.fn(),
}));
vi.mock('../../services/twinInterviewService', () => ({ draftSection: vi.fn() }));
vi.mock('../../services/twinDeepInterviewService', () => ({
  interviewNext: vi.fn(),
  interviewSynthesize: vi.fn(),
}));
vi.mock('../../services/twinResearchService', () => ({
  getResearchHistoryInfo: vi.fn(),
  researchHistory: vi.fn(),
  cancelResearchHistory: vi.fn(),
}));
vi.mock('../../services/twinWebResearchService', () => ({ researchWeb: vi.fn() }));
vi.mock('../../services/ai-provider', () => ({ resolveTaskModel: vi.fn(), getTwinLearningModelInfo: vi.fn() }));
vi.mock('../../services/twinMemoryService', () => ({
  listFacts: vi.fn(),
  purgeFact: vi.fn(),
  purgeAllForgotten: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerTwinHandlers } from '../twin';
import * as twinProfileService from '../../services/twinProfileService';
import * as twinDeepInterviewService from '../../services/twinDeepInterviewService';
import * as twinResearchService from '../../services/twinResearchService';
import * as twinWebResearchService from '../../services/twinWebResearchService';
import { resolveTaskModel, getTwinLearningModelInfo } from '../../services/ai-provider';
import * as twinMemoryService from '../../services/twinMemoryService';

function makeEvent() {
  return {};
}
const handler = (channel: string) => registeredHandlers.get(channel)!;

beforeAll(() => {
  registerTwinHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// update-profile-section — the new brief section
// ---------------------------------------------------------------------------

describe('twin:update-profile-section (brief)', () => {
  it('validates a brief and delegates to updateProfileSection', async () => {
    vi.mocked(twinProfileService.updateProfileSection).mockResolvedValue({} as never);
    await handler('twin:update-profile-section')(makeEvent(), 'brief', { statement: 'A senior PM' });
    expect(twinProfileService.updateProfileSection).toHaveBeenCalledWith('brief', { statement: 'A senior PM' });
  });

  it('rejects a non-string brief statement before reaching the service', async () => {
    await expect(handler('twin:update-profile-section')(makeEvent(), 'brief', { statement: 42 })).rejects.toThrow(
      'Validation failed',
    );
    expect(twinProfileService.updateProfileSection).not.toHaveBeenCalled();
  });

  it('rejects an unknown section key', async () => {
    await expect(handler('twin:update-profile-section')(makeEvent(), 'nope', {})).rejects.toThrow('Validation failed');
  });
});

// ---------------------------------------------------------------------------
// Deep interview channels
// ---------------------------------------------------------------------------

describe('twin:interview-next / twin:interview-synthesize', () => {
  it('validates the payload and delegates to interviewNext', async () => {
    vi.mocked(twinDeepInterviewService.interviewNext).mockResolvedValue({ status: 'skipped', reason: 'failed' });
    const payload = { brief: 'hi', profileSoFar: {}, qa: [{ question: 'q', answer: 'a' }] };
    const result = await handler('twin:interview-next')(makeEvent(), payload);
    expect(twinDeepInterviewService.interviewNext).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ status: 'skipped', reason: 'failed' });
  });

  it('rejects an interview-next payload whose qa is not an array', async () => {
    await expect(
      handler('twin:interview-next')(makeEvent(), { brief: '', profileSoFar: {}, qa: 'nope' }),
    ).rejects.toThrow('Validation failed');
    expect(twinDeepInterviewService.interviewNext).not.toHaveBeenCalled();
  });

  it('validates the payload and delegates to interviewSynthesize', async () => {
    vi.mocked(twinDeepInterviewService.interviewSynthesize).mockResolvedValue({
      status: 'skipped',
      reason: 'failed',
    });
    const payload = { brief: 'hi', qa: [] };
    await handler('twin:interview-synthesize')(makeEvent(), payload);
    expect(twinDeepInterviewService.interviewSynthesize).toHaveBeenCalledWith(payload);
  });
});

// ---------------------------------------------------------------------------
// History mining channels
// ---------------------------------------------------------------------------

describe('twin:research-history-info / twin:research-history', () => {
  it('delegates the consent descriptor to getResearchHistoryInfo', async () => {
    const info = {
      excerptCount: 0,
      briefCount: 0,
      projectCount: 0,
      cardCount: 0,
      providerLabel: 'Not configured',
      isLocal: true,
    };
    vi.mocked(twinResearchService.getResearchHistoryInfo).mockResolvedValue(info);
    expect(await handler('twin:research-history-info')(makeEvent())).toEqual(info);
  });

  it('delegates the mining pass to researchHistory', async () => {
    vi.mocked(twinResearchService.researchHistory).mockResolvedValue({ status: 'skipped', reason: 'failed' });
    expect(await handler('twin:research-history')(makeEvent())).toEqual({
      status: 'skipped',
      reason: 'failed',
    });
  });
});

// ---------------------------------------------------------------------------
// Web research channel
// ---------------------------------------------------------------------------

describe('twin:research-web', () => {
  it('validates {company, industry} and delegates to researchWeb', async () => {
    vi.mocked(twinWebResearchService.researchWeb).mockResolvedValue({ status: 'skipped', reason: 'failed' });
    await handler('twin:research-web')(makeEvent(), { company: 'Acme', industry: 'SaaS' });
    expect(twinWebResearchService.researchWeb).toHaveBeenCalledWith({ company: 'Acme', industry: 'SaaS' });
  });

  it('rejects a payload missing company', async () => {
    await expect(handler('twin:research-web')(makeEvent(), { industry: 'SaaS' })).rejects.toThrow('Validation failed');
    expect(twinWebResearchService.researchWeb).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Creation-model gate descriptor
// ---------------------------------------------------------------------------

describe('twin:get-creation-model', () => {
  it('marks a frontier cloud provider as frontier and not local', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue({
      providerId: 'p1',
      providerName: 'openai',
      apiKeyEncrypted: null,
      baseUrl: null,
      model: 'gpt-5-mini',
    });
    expect(await handler('twin:get-creation-model')(makeEvent())).toEqual({
      providerLabel: 'openai',
      modelLabel: 'gpt-5-mini',
      isLocal: false,
      isFrontier: true,
    });
  });

  it('marks a local provider as local and not frontier', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue({
      providerId: 'p2',
      providerName: 'ollama',
      apiKeyEncrypted: null,
      baseUrl: null,
      model: 'llama3.2',
    });
    expect(await handler('twin:get-creation-model')(makeEvent())).toEqual({
      providerLabel: 'ollama',
      modelLabel: 'llama3.2',
      isLocal: true,
      isFrontier: false,
    });
  });

  it('marks the built-in model as local and not frontier', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue({
      providerId: 'p3',
      providerName: 'builtin',
      apiKeyEncrypted: null,
      baseUrl: null,
      model: 'qwen3',
    });
    expect(await handler('twin:get-creation-model')(makeEvent())).toEqual({
      providerLabel: 'builtin',
      modelLabel: 'qwen3',
      isLocal: true,
      isFrontier: false,
    });
  });

  it('reports no configured model when none resolves', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(null);
    expect(await handler('twin:get-creation-model')(makeEvent())).toEqual({
      providerLabel: 'No model configured',
      modelLabel: '',
      isLocal: false,
      isFrontier: false,
    });
  });
});

describe('twin:get-learning-model', () => {
  it('returns the learning-model state from ai-provider unchanged', async () => {
    const info = { providerLabel: null, modelLabel: null, isLocal: false, explicit: false, willLearn: false };
    vi.mocked(getTwinLearningModelInfo).mockResolvedValue(info);
    expect(await handler('twin:get-learning-model')(makeEvent())).toEqual(info);
  });
});

describe('Delete permanently channels (TWIN-LOOP.2 Task 3)', () => {
  const FACT_ID = '11111111-1111-4111-8111-111111111111';

  it('twin:memory-list-forgotten lists forgotten facts only', async () => {
    vi.mocked(twinMemoryService.listFacts).mockResolvedValue([]);
    expect(await handler('twin:memory-list-forgotten')(makeEvent())).toEqual([]);
    expect(twinMemoryService.listFacts).toHaveBeenCalledWith({ status: 'forgotten' });
  });

  it('twin:memory-purge passes a uuid through and returns the result', async () => {
    vi.mocked(twinMemoryService.purgeFact).mockResolvedValue(true);
    expect(await handler('twin:memory-purge')(makeEvent(), FACT_ID)).toBe(true);
    expect(twinMemoryService.purgeFact).toHaveBeenCalledWith(FACT_ID);
  });

  it.each([['not-a-uuid'], [''], [42], [undefined]])('twin:memory-purge rejects %j before the service', async (bad) => {
    await expect(Promise.resolve().then(() => handler('twin:memory-purge')(makeEvent(), bad))).rejects.toThrow();
    expect(twinMemoryService.purgeFact).not.toHaveBeenCalled();
  });

  it('twin:memory-purge-all-forgotten returns the purged count', async () => {
    vi.mocked(twinMemoryService.purgeAllForgotten).mockResolvedValue(3);
    expect(await handler('twin:memory-purge-all-forgotten')(makeEvent())).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Profile input limits (TWIN-LOOP.2 Task 5) - short 200, free text 4000, lists 500
// ---------------------------------------------------------------------------

const SHORT = 200;
const TEXT = 4000;
const LIST = 500;

// One row per profile field: [section, how to build a value with that field set to `s`].
const FIELD_CASES: [string, string, number, (s: string) => unknown][] = [
  ['brief', 'statement', TEXT, (s) => ({ statement: s })],
  ['identity', 'name', SHORT, (s) => ({ name: s })],
  ['identity', 'role', SHORT, (s) => ({ role: s })],
  ['identity', 'seniority', SHORT, (s) => ({ seniority: s })],
  ['domain', 'industry', SHORT, (s) => ({ industry: s })],
  ['domain', 'company', SHORT, (s) => ({ company: s })],
  ['domain', 'focus', TEXT, (s) => ({ focus: s })],
  ['projects', 'name', SHORT, (s) => [{ name: s }]],
  ['projects', 'description', TEXT, (s) => [{ name: 'p', description: s }]],
  ['projects', 'projectId', SHORT, (s) => [{ name: 'p', projectId: s }]],
  ['people', 'name', SHORT, (s) => [{ name: s }]],
  ['people', 'role', SHORT, (s) => [{ name: 'p', role: s }]],
  ['people', 'org', SHORT, (s) => [{ name: 'p', org: s }]],
  ['vocabulary', 'term', SHORT, (s) => [{ term: s, meaning: 'm' }]],
  ['vocabulary', 'meaning', TEXT, (s) => [{ term: 't', meaning: s }]],
  ['goals', 'goal', TEXT, (s) => [s]],
  ['preferences', 'tone', TEXT, (s) => ({ tone: s })],
  ['preferences', 'language', SHORT, (s) => ({ language: s })],
  ['preferences', 'cardTitleStyle', TEXT, (s) => ({ cardTitleStyle: s })],
];

const EMPTY_PROFILE = {
  brief: {},
  identity: {},
  domain: {},
  projects: [],
  people: [],
  vocabulary: [],
  goals: [],
  preferences: {},
};

describe('twin profile input limits', () => {
  it.each(FIELD_CASES)(
    '%s.%s accepts exactly its limit and rejects one over (patch)',
    async (section, _f, max, build) => {
      vi.mocked(twinProfileService.updateProfileSection).mockResolvedValue({} as never);
      await handler('twin:update-profile-section')(makeEvent(), section, build('x'.repeat(max)));
      expect(twinProfileService.updateProfileSection).toHaveBeenCalledTimes(1);

      vi.mocked(twinProfileService.updateProfileSection).mockClear();
      await expect(
        handler('twin:update-profile-section')(makeEvent(), section, build('x'.repeat(max + 1))),
      ).rejects.toThrow('Validation failed');
      expect(twinProfileService.updateProfileSection).not.toHaveBeenCalled();
    },
  );

  it.each(FIELD_CASES)('%s.%s is bounded the same way in twin:save-profile', async (section, _f, max, build) => {
    vi.mocked(twinProfileService.saveProfile).mockResolvedValue({} as never);
    await handler('twin:save-profile')(makeEvent(), { ...EMPTY_PROFILE, [section]: build('x'.repeat(max)) });
    expect(twinProfileService.saveProfile).toHaveBeenCalledTimes(1);

    vi.mocked(twinProfileService.saveProfile).mockClear();
    await expect(
      handler('twin:save-profile')(makeEvent(), { ...EMPTY_PROFILE, [section]: build('x'.repeat(max + 1)) }),
    ).rejects.toThrow('Validation failed');
    expect(twinProfileService.saveProfile).not.toHaveBeenCalled();
  });

  it.each([
    ['projects', (i: number) => ({ name: `p${i}` })],
    ['people', (i: number) => ({ name: `p${i}` })],
    ['vocabulary', (i: number) => ({ term: `t${i}`, meaning: 'm' })],
    ['goals', (i: number) => `g${i}`],
  ])('%s holds at most 500 entries', async (section, make) => {
    vi.mocked(twinProfileService.updateProfileSection).mockResolvedValue({} as never);
    const list = (n: number) => Array.from({ length: n }, (_, i) => make(i));
    await handler('twin:update-profile-section')(makeEvent(), section, list(LIST));
    await expect(handler('twin:update-profile-section')(makeEvent(), section, list(LIST + 1))).rejects.toThrow(
      'Validation failed',
    );
    await expect(
      handler('twin:save-profile')(makeEvent(), { ...EMPTY_PROFILE, [section]: list(LIST + 1) }),
    ).rejects.toThrow('Validation failed');
  });
});

describe('twin:save-profile', () => {
  it('validates the whole profile and hands it to saveProfile in one call', async () => {
    vi.mocked(twinProfileService.saveProfile).mockResolvedValue({ updatedAt: 'now' } as never);
    const profile = { ...EMPTY_PROFILE, identity: { name: 'Ada' }, goals: ['Ship'] };
    expect(await handler('twin:save-profile')(makeEvent(), profile)).toEqual({ updatedAt: 'now' });
    expect(twinProfileService.saveProfile).toHaveBeenCalledTimes(1);
    expect(twinProfileService.saveProfile).toHaveBeenCalledWith(profile);
  });

  it.each(['brief', 'identity', 'domain', 'projects', 'people', 'vocabulary', 'goals', 'preferences'])(
    'rejects a payload missing the %s section, writing nothing',
    async (missing) => {
      const partial: Record<string, unknown> = { ...EMPTY_PROFILE };
      delete partial[missing];
      await expect(handler('twin:save-profile')(makeEvent(), partial)).rejects.toThrow('Validation failed');
      expect(twinProfileService.saveProfile).not.toHaveBeenCalled();
    },
  );

  it('rejects one over-limit field among otherwise valid sections without calling the service', async () => {
    const bad = { ...EMPTY_PROFILE, identity: { name: 'Ada' }, people: [{ name: 'n'.repeat(SHORT + 1) }] };
    await expect(handler('twin:save-profile')(makeEvent(), bad)).rejects.toThrow('Validation failed');
    expect(twinProfileService.saveProfile).not.toHaveBeenCalled();
  });
});

describe('twin:research-cancel', () => {
  it('cancels the in-flight history-mining run and reports whether one was running', async () => {
    vi.mocked(twinResearchService.cancelResearchHistory).mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(await handler('twin:research-cancel')(makeEvent())).toBe(true);
    expect(await handler('twin:research-cancel')(makeEvent())).toBe(false);
    expect(twinResearchService.cancelResearchHistory).toHaveBeenCalledTimes(2);
  });
});
