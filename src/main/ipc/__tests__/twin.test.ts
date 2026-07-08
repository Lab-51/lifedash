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
}));
vi.mock('../../services/twinInterviewService', () => ({ draftSection: vi.fn() }));
vi.mock('../../services/twinDeepInterviewService', () => ({
  interviewNext: vi.fn(),
  interviewSynthesize: vi.fn(),
}));
vi.mock('../../services/twinResearchService', () => ({
  getResearchHistoryInfo: vi.fn(),
  researchHistory: vi.fn(),
}));
vi.mock('../../services/twinWebResearchService', () => ({ researchWeb: vi.fn() }));
vi.mock('../../services/ai-provider', () => ({ resolveTaskModel: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerTwinHandlers } from '../twin';
import * as twinProfileService from '../../services/twinProfileService';
import * as twinDeepInterviewService from '../../services/twinDeepInterviewService';
import * as twinResearchService from '../../services/twinResearchService';
import * as twinWebResearchService from '../../services/twinWebResearchService';
import { resolveTaskModel } from '../../services/ai-provider';

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
