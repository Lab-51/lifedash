// === FILE PURPOSE ===
// TWIN-LOOP Task 4: the twin profile's people names and vocabulary terms reach the
// extraction prompt's Known-names block, deduped against the existing sources with
// the existing spelling winning. `getProfile` is mocked (the reader under test,
// twinGlossaryTerms, is real); every name here is invented.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/tmp', getPath: () => '/tmp' },
}));
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../ai-provider', () => ({ generate: vi.fn() }));
vi.mock('../../db/connection', () => ({ getDb: () => ({}) }));
vi.mock('../whisperPromptService', () => ({ loadPresetGlossary: vi.fn() }));
vi.mock('../twinProfileService', () => ({ getProfile: vi.fn() }));

import { extractMeetingStructure, type ExtractionInput } from '../briefExtractionService';
import { EXTRACTION_SYSTEM_PROMPT } from '../briefExtractionPrompt';
import { generate } from '../ai-provider';
import { loadPresetGlossary } from '../whisperPromptService';
import { getProfile } from '../twinProfileService';
import type { TwinProfile } from '../../../shared/types/twin';

const PROVIDER = {
  providerId: 'local-1',
  providerName: 'builtin' as const,
  apiKeyEncrypted: null,
  baseUrl: null,
  model: 'qwen3-4b',
  temperature: 0.3,
  maxTokens: undefined,
};
const MEETING = {
  id: 'meeting-1',
  title: 'Weekly sync',
  template: 'none' as const,
  segments: [{ startTime: 0, content: 'Kickoff and agenda review.' }],
};
const ROSTER = [{ name: 'Alice Example', source: 'calendar' as const }];

const KNOWN = 'Known names (use these exact spellings, even where the transcript inflects or declines them): ';
const WITHOUT_KNOWN_TERMS = `${EXTRACTION_SYSTEM_PROMPT}

Participants (use these exact spellings; a commitment has an owner ONLY when the transcript makes it explicit): Alice Example`;

const generateMock = generate as unknown as Mock;
const glossaryMock = loadPresetGlossary as unknown as Mock;
const profileMock = getProfile as unknown as Mock;

function profile(people: TwinProfile['people'], vocabulary: TwinProfile['vocabulary']): TwinProfile {
  return {
    brief: {},
    identity: {},
    domain: {},
    projects: [],
    people,
    vocabulary,
    goals: [],
    preferences: {},
    updatedAt: '2026-10-11T00:00:00.000Z',
  };
}

function input(overrides: Partial<ExtractionInput> = {}): ExtractionInput {
  return { provider: PROVIDER, meeting: MEETING, roster: ROSTER, langName: null, ...overrides };
}

async function systemPrompt(overrides: Partial<ExtractionInput> = {}): Promise<string> {
  await extractMeetingStructure(input(overrides));
  return (generateMock.mock.calls[0][0] as { system: string }).system;
}

beforeEach(() => {
  generateMock.mockReset();
  glossaryMock.mockReset();
  profileMock.mockReset();
  generateMock.mockResolvedValue({ text: JSON.stringify({ topics: [] }), usage: undefined });
  profileMock.mockResolvedValue(null);
});

describe('extractMeetingStructure — twin terms in the Known-names block', () => {
  it('appends twin people then vocabulary after the caller terms and the preset glossary', async () => {
    glossaryMock.mockResolvedValue('Glossary Term');
    profileMock.mockResolvedValue(profile([{ name: 'Quillon Farrow' }], [{ term: 'Zetaflux', meaning: 'invented' }]));

    expect(await systemPrompt({ knownTerms: ['Kestrel Ledger'], presetCode: 'cs' })).toContain(
      `${KNOWN}Kestrel Ledger, Glossary Term, Quillon Farrow, Zetaflux`,
    );
  });

  it('anchors twin terms even when no preset is given', async () => {
    profileMock.mockResolvedValue(profile([{ name: 'Quillon Farrow' }], []));
    expect(await systemPrompt()).toContain(`${KNOWN}Quillon Farrow`);
  });

  it('dedupes case-insensitively against the existing sources — the existing spelling wins', async () => {
    glossaryMock.mockResolvedValue('Glossary Term');
    profileMock.mockResolvedValue(
      profile(
        [{ name: 'KESTREL LEDGER' }, { name: 'New Person' }, { name: 'new person' }],
        [{ term: 'glossary term', meaning: 'dup' }],
      ),
    );

    expect(await systemPrompt({ knownTerms: ['Kestrel Ledger'], presetCode: 'cs' })).toContain(
      `${KNOWN}Kestrel Ledger, Glossary Term, New Person`,
    );
  });

  it('carries names and terms only — never a role, org or meaning', async () => {
    profileMock.mockResolvedValue(
      profile(
        [{ name: 'Quillon Farrow', role: 'Chief Wizard', org: 'Invented Holdings' }],
        [{ term: 'Zetaflux', meaning: 'a made-up meaning' }],
      ),
    );
    const system = await systemPrompt();
    expect(system).toContain(`${KNOWN}Quillon Farrow, Zetaflux`);
    expect(system).not.toMatch(/Wizard|Holdings|made-up/);
  });

  it('is byte-identical to the pre-twin prompt with no profile, an empty profile, and a failing lookup', async () => {
    expect(await systemPrompt()).toBe(WITHOUT_KNOWN_TERMS);

    generateMock.mockClear();
    profileMock.mockResolvedValue(profile([], []));
    expect(await systemPrompt()).toBe(WITHOUT_KNOWN_TERMS);

    generateMock.mockClear();
    profileMock.mockRejectedValue(new Error('db unavailable'));
    const result = await extractMeetingStructure(input());
    expect('structure' in result).toBe(true);
    expect((generateMock.mock.calls[0][0] as { system: string }).system).toBe(WITHOUT_KNOWN_TERMS);
  });
});
