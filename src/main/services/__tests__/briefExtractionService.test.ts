// === FILE PURPOSE ===
// Unit tests for the structured extraction pass (BRIEF-QUAL.1 Task 2).
//
// What actually matters here, in order:
//   1. NOTHING IS LOST. A transcript too big for the window is extracted in parts
//      and merged in CODE — so the union of every part's items must survive, and
//      only true duplicates may collapse.
//   2. The prompt is the contract with the weakest model tier: the roster block,
//      the owner-null rule, every template's own hint, and the language
//      instruction only when there is a language to instruct about.
//   3. Failure is honest and never thrown: invalid JSON buys exactly ONE retry
//      carrying the validation error, then a failureReason naming the part.
//
// `generate` is mocked exactly as the sibling suites do; 'electron' is mocked only
// because promptBudget.ts reaches llamaRuntimeConfig.ts for the REAL builtin
// --ctx-size and that module imports `app` at module scope.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/tmp', getPath: () => '/tmp' },
}));

const { logMock } = vi.hoisted(() => ({
  logMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../logger', () => ({ createLogger: () => logMock }));

vi.mock('../ai-provider', () => ({ generate: vi.fn() }));

import {
  extractMeetingStructure,
  mergeDrafts,
  type ExtractionInput,
  type RosterEntry,
} from '../briefExtractionService';
import { EXTRACTION_SYSTEM_PROMPT } from '../briefExtractionPrompt';
import { generate } from '../ai-provider';
import { MEETING_TEMPLATES, type MeetingTemplateType } from '../../../shared/types/meetings';
import { MeetingStructureDraftSchema } from '../../../shared/types/briefStructure';

// ---------------------------------------------------------------------------
// Fixtures — every name here is invented.
// ---------------------------------------------------------------------------

const PROVIDER = {
  providerId: 'local-1',
  providerName: 'builtin' as const,
  apiKeyEncrypted: null,
  baseUrl: null,
  model: 'qwen3-4b',
  temperature: 0.3,
  maxTokens: undefined,
};

const ROSTER: RosterEntry[] = [
  { name: 'Marta Nováková', source: 'calendar' },
  { name: 'Dev Raghunathan', source: 'transcript' },
];

const SHORT_SEGMENTS = [
  { startTime: 0, content: 'Kickoff and agenda review.' },
  { startTime: 65_000, content: 'The export worker fails for large accounts.' },
  { startTime: 125_000, content: 'Marta will patch the batch limit by Friday.' },
];

/** ~120k chars — comfortably past the builtin sidecar's 22,528-char prompt budget
 *  (16384 - 4096 - 1024 tokens x 2.0 chars/token), so the fit gate must chunk it. */
const LONG_SEGMENTS = Array.from({ length: 30 }, (_, i) => ({
  startTime: i * 30_000,
  content: `Segment ${i} ${'discussion text '.repeat(250)}`,
}));

const BASE_MEETING = {
  id: 'meeting-1',
  title: 'Weekly sync',
  template: 'none' as MeetingTemplateType,
  segments: SHORT_SEGMENTS,
};

function input(overrides: Partial<ExtractionInput> = {}): ExtractionInput {
  return {
    provider: overrides.provider ?? PROVIDER,
    meeting: overrides.meeting ?? BASE_MEETING,
    roster: overrides.roster ?? ROSTER,
    langName: overrides.langName ?? null,
    knownTerms: overrides.knownTerms,
  };
}

/** A minimal valid model reply. */
function reply(draft: Record<string, unknown>): { text: string; usage: undefined } {
  return { text: JSON.stringify(draft), usage: undefined };
}

const generateMock = generate as unknown as Mock;

function callArgs(index: number): { system: string; prompt: string; taskType: string } {
  return generateMock.mock.calls[index][0] as { system: string; prompt: string; taskType: string };
}

beforeEach(() => {
  generateMock.mockReset();
  logMock.warn.mockClear();
  logMock.info.mockClear();
  logMock.error.mockClear();
});

// ---------------------------------------------------------------------------
// Fits path
// ---------------------------------------------------------------------------

describe('extractMeetingStructure — transcript that fits the window', () => {
  beforeEach(() => {
    generateMock.mockResolvedValue(
      reply({
        topics: [{ title: 'Export failures', detail: 'The export worker fails for accounts over 500 line items.' }],
        decisions: [{ statement: 'Raise the batch limit', rationale: 'Cheaper than a rewrite' }],
        commitments: [{ owner: 'Marta Nováková', task: 'Patch the batch limit', due: 'Friday', explicit: true }],
        openQuestions: ['Is the limit ours or the vendor s?'],
        terms: ['export worker', 'P2'],
      }),
    );
  });

  it('makes exactly ONE call and stamps provenance with passes = 1', async () => {
    const result = await extractMeetingStructure(input());

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect('structure' in result).toBe(true);
    if (!('structure' in result)) return;
    expect(result.structure.provenance).toMatchObject({
      provider: 'builtin',
      model: 'qwen3-4b',
      passes: 1,
      schemaVersion: 1,
    });
    expect(Date.parse(result.structure.provenance.extractedAt)).not.toBeNaN();
    expect(result.structure.topics).toHaveLength(1);
    expect(result.structure.commitments[0].explicit).toBe(true);
  });

  it("routes through taskType 'summarization' (routing, usage logging and the runtime pin key off it)", async () => {
    await extractMeetingStructure(input());
    expect(callArgs(0).taskType).toBe('summarization');
  });

  it('sends the transcript itself, with no part header', async () => {
    await extractMeetingStructure(input());
    const { prompt } = callArgs(0);
    expect(prompt).toContain('Meeting: Weekly sync');
    expect(prompt).toContain('[00:00] Kickoff and agenda review.');
    expect(prompt).toContain('[02:05] Marta will patch the batch limit by Friday.');
    expect(prompt).not.toContain('Part 1 of');
  });

  it('carries the roster block with the exact spellings and the owner-explicit caveat', async () => {
    await extractMeetingStructure(input());
    const { system } = callArgs(0);
    expect(system).toContain(
      'Participants (use these exact spellings; a commitment has an owner ONLY when the transcript makes it explicit): Marta Nováková, Dev Raghunathan',
    );
  });

  it('omits the roster block entirely when nobody is known', async () => {
    await extractMeetingStructure(input({ roster: [] }));
    expect(callArgs(0).system).not.toContain('Participants (');
  });

  // LOCAL-QUAL.1's byte-identity control. The known-names block is OPTIONAL, and a
  // meeting with nothing to anchor must get the prompt it got before that block
  // existed — byte for byte, not merely "containing" the old text. Composed from the
  // three blocks that predate it, so a leaked empty block, a reordered block or a
  // changed separator all fail this `toBe`. EXTRACTION_SYSTEM_PROMPT is interpolated
  // rather than copied ON PURPOSE: its text is reviewed prose that is deliberately
  // pinned nowhere, and copying it here would turn every wording fix into a
  // re-capture. What this control owns is the ASSEMBLY.
  const STANDUP_HINT = MEETING_TEMPLATES.find((t) => t.type === 'standup')?.aiPromptHint ?? '';
  const CZECH_STANDUP = { ...BASE_MEETING, template: 'standup' as MeetingTemplateType };
  const ASSEMBLED_WITHOUT_KNOWN_TERMS = `${EXTRACTION_SYSTEM_PROMPT}

Participants (use these exact spellings; a commitment has an owner ONLY when the transcript makes it explicit): Marta Nováková, Dev Raghunathan

IMPORTANT CONTEXT: ${STANDUP_HINT}

IMPORTANT: The transcript is in Czech. Write every string VALUE in Czech. The JSON keys stay exactly as shown above, in English.`;

  it('assembles EXACTLY the pre-known-terms prompt when there is nothing to anchor', async () => {
    await extractMeetingStructure(input({ meeting: CZECH_STANDUP, langName: 'Czech' }));
    expect(callArgs(0).system).toBe(ASSEMBLED_WITHOUT_KNOWN_TERMS);
  });

  it('treats an empty or blank-only term list as nothing to anchor, byte for byte', async () => {
    await extractMeetingStructure(input({ meeting: CZECH_STANDUP, langName: 'Czech', knownTerms: [] }));
    await extractMeetingStructure(input({ meeting: CZECH_STANDUP, langName: 'Czech', knownTerms: ['  ', ''] }));
    expect(callArgs(0).system).toBe(ASSEMBLED_WITHOUT_KNOWN_TERMS);
    expect(callArgs(1).system).toBe(ASSEMBLED_WITHOUT_KNOWN_TERMS);
  });

  it('anchors a known name exactly, between the roster and the template hint', async () => {
    await extractMeetingStructure(
      input({ meeting: CZECH_STANDUP, langName: 'Czech', knownTerms: [' Kestrel Ledger '] }),
    );
    const { system } = callArgs(0);
    expect(system).toContain(
      'Known names (use these exact spellings, even where the transcript inflects or declines them): Kestrel Ledger',
    );
    expect(system.indexOf('Known names (')).toBeGreaterThan(system.indexOf('Participants ('));
    expect(system.indexOf('Known names (')).toBeLessThan(system.indexOf('IMPORTANT CONTEXT:'));
  });

  it('states the owner-null rule — the whole defence against invented attribution', async () => {
    await extractMeetingStructure(input());
    const { system } = callArgs(0);
    expect(system).toContain('"owner" is null unless the transcript makes a named person responsible');
    expect(system).toContain('Never guess from who spoke last or who was mentioned last');
  });

  it('demands completeness and one bare JSON object (the weakest-tier contract)', async () => {
    await extractMeetingStructure(input());
    const { system } = callArgs(0);
    expect(system).toContain('Extract EVERYTHING that was said');
    expect(system).toContain('Output ONE JSON object and nothing else');
    expect(system).toContain('"topics"');
    expect(system).toContain('"openQuestions"');
  });

  it('excludes meeting logistics even when they sound like a decision (LOCAL-QUAL.1)', async () => {
    await extractMeetingStructure(input());
    const { system } = callArgs(0);
    expect(system).toContain('Running the meeting itself is logistics too, even when it sounds like a decision');
    expect(system).toContain('turning the recording on');
    // It is a carve-out of the EXISTING exclusion rule: completeness is untouched.
    expect(system).toContain('Extract EVERYTHING that was said. Completeness beats brevity.');
    expect(system).toContain('Completeness applies to the WORK content.');
  });

  it.each(MEETING_TEMPLATES)("carries $type's own aiPromptHint", async (template) => {
    await extractMeetingStructure(input({ meeting: { ...BASE_MEETING, template: template.type } }));
    const { system } = callArgs(0);
    if (template.aiPromptHint) {
      expect(system).toContain(template.aiPromptHint);
    } else {
      // 'none' has no hint — it must add no context line at all, not an empty one.
      expect(system).not.toContain('IMPORTANT CONTEXT:');
    }
  });

  it('adds the language instruction ONLY when a language is known', async () => {
    await extractMeetingStructure(input());
    expect(callArgs(0).system).not.toContain('IMPORTANT: The transcript is in');

    generateMock.mockClear();
    await extractMeetingStructure(input({ langName: 'Czech' }));
    const { system } = callArgs(0);
    expect(system).toContain('The transcript is in Czech');
    expect(system).toContain('Write every string VALUE in Czech');
    expect(system).toContain('The JSON keys stay exactly as shown above, in English');
  });

  it('accepts a fenced reply with prose around it, and fills the lenient defaults', async () => {
    generateMock.mockResolvedValue({
      text: 'Here is the structure:\n```json\n{"topics":[{"title":"Only a title"}],"commitments":[{"task":"Send the deck"}]}\n```\nHope that helps!',
      usage: undefined,
    });

    const result = await extractMeetingStructure(input());

    expect('structure' in result).toBe(true);
    if (!('structure' in result)) return;
    expect(result.structure.topics[0]).toEqual({ title: 'Only a title', detail: '' });
    expect(result.structure.commitments[0]).toEqual({
      owner: null,
      task: 'Send the deck',
      due: null,
      explicit: false, // missing flag means "do not trust an owner" — never true
    });
    expect(result.structure.decisions).toEqual([]);
    expect(result.structure.openQuestions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Chunked path
// ---------------------------------------------------------------------------

describe('extractMeetingStructure — transcript that does NOT fit', () => {
  /** Part i seeds one distinct item per section plus one item shared with every
   *  other part (spelled differently) so both union and dedupe are observable. */
  function seededReply(part: number) {
    return reply({
      topics: [
        { title: `Topic ${part}`, detail: `Detail for part ${part}.` },
        { title: 'Shared topic', detail: part === 2 ? 'A much longer detail, seen only in part two.' : 'Short.' },
      ],
      decisions: [
        { statement: `Decision ${part}`, rationale: `Because of part ${part}` },
        { statement: 'Freeze the schema.', rationale: part === 3 ? 'Migrations were piling up' : null },
      ],
      commitments: [
        { owner: `Owner${part}`, task: `Task ${part}`, due: null, explicit: true },
        {
          owner: 'Dev Raghunathan',
          task: 'Write the migration',
          due: part === 2 ? 'Tuesday' : null,
          explicit: part === 2,
        },
      ],
      openQuestions: [`Question ${part}`, 'Who signs this off?'],
      terms: [`Term${part}`, 'Ledgerly'],
    });
  }

  beforeEach(() => {
    let call = 0;
    generateMock.mockImplementation(() => Promise.resolve(seededReply(++call)));
  });

  it('makes one call per part, each labelled "Part i of N", and reports passes = N', async () => {
    const result = await extractMeetingStructure(input({ meeting: { ...BASE_MEETING, segments: LONG_SEGMENTS } }));

    const parts = generateMock.mock.calls.length;
    expect(parts).toBeGreaterThan(1);
    for (let i = 0; i < parts; i++) {
      expect(callArgs(i).prompt).toContain(`Part ${i + 1} of ${parts} of meeting "Weekly sync"`);
      expect(callArgs(i).taskType).toBe('summarization');
      // Every part is a FULL extraction: the same system prompt rides along.
      expect(callArgs(i).system).toBe(callArgs(0).system);
    }

    expect('structure' in result).toBe(true);
    if (!('structure' in result)) return;
    expect(result.structure.provenance.passes).toBe(parts);
  });

  it('loses NOTHING: every distinct item from every part is in the merged structure', async () => {
    const result = await extractMeetingStructure(input({ meeting: { ...BASE_MEETING, segments: LONG_SEGMENTS } }));
    const parts = generateMock.mock.calls.length;

    expect('structure' in result).toBe(true);
    if (!('structure' in result)) return;
    const { structure } = result;

    for (let part = 1; part <= parts; part++) {
      expect(structure.topics.map((t) => t.title)).toContain(`Topic ${part}`);
      expect(structure.decisions.map((d) => d.statement)).toContain(`Decision ${part}`);
      expect(structure.commitments.map((c) => c.task)).toContain(`Task ${part}`);
      expect(structure.openQuestions).toContain(`Question ${part}`);
      expect(structure.terms).toContain(`Term${part}`);
    }
    // First-seen order is preserved across parts.
    expect(structure.topics[0].title).toBe('Topic 1');
  });

  it('collapses cross-part duplicates to one, keeping the richer copy of each', async () => {
    const result = await extractMeetingStructure(input({ meeting: { ...BASE_MEETING, segments: LONG_SEGMENTS } }));

    expect('structure' in result).toBe(true);
    if (!('structure' in result)) return;
    const { structure } = result;

    expect(structure.topics.filter((t) => t.title === 'Shared topic')).toHaveLength(1);
    expect(structure.topics.find((t) => t.title === 'Shared topic')!.detail).toBe(
      'A much longer detail, seen only in part two.',
    );

    expect(structure.decisions.filter((d) => d.statement === 'Freeze the schema.')).toHaveLength(1);
    expect(structure.decisions.find((d) => d.statement === 'Freeze the schema.')!.rationale).toBe(
      'Migrations were piling up',
    );

    const migration = structure.commitments.filter((c) => c.task === 'Write the migration');
    expect(migration).toHaveLength(1);
    expect(migration[0].due).toBe('Tuesday');
    expect(migration[0].explicit).toBe(true); // explicit in ANY part wins

    expect(structure.openQuestions.filter((q) => q === 'Who signs this off?')).toHaveLength(1);
    expect(structure.terms.filter((t) => t === 'Ledgerly')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

describe('extractMeetingStructure — failure handling', () => {
  const longInput = () => input({ meeting: { ...BASE_MEETING, segments: LONG_SEGMENTS } });

  it('retries a part exactly ONCE, carrying the validation error, then continues', async () => {
    const good = reply({ topics: [{ title: 'Recovered', detail: 'Second attempt parsed.' }] });
    let call = 0;
    generateMock.mockImplementation(() => {
      call += 1;
      if (call === 2) return Promise.resolve({ text: 'Sorry, I cannot produce that.', usage: undefined });
      return Promise.resolve(good);
    });

    const result = await extractMeetingStructure(longInput());

    expect('structure' in result).toBe(true);
    // One extra call over the part count: the single retry of part 2.
    const prompts = generateMock.mock.calls.map((c) => (c[0] as { prompt: string }).prompt);
    const retried = prompts.filter((p) => p.includes('Your previous reply was rejected'));
    expect(retried).toHaveLength(1);
    expect(retried[0]).toContain('Part 2 of');
    expect(retried[0]).toContain('no JSON object or array');
    expect(retried[0]).toContain('Reply with ONLY the JSON object');
  });

  it('gives up after the second failure with a reason naming the part', async () => {
    let call = 0;
    generateMock.mockImplementation(() => {
      call += 1;
      const bad = call === 2 || call === 3;
      return Promise.resolve(
        bad ? { text: 'no json at all', usage: undefined } : reply({ topics: [{ title: 'Fine', detail: 'ok' }] }),
      );
    });

    const result = await extractMeetingStructure(longInput());

    expect('failureReason' in result).toBe(true);
    if (!('failureReason' in result)) return;
    expect(result.failureReason).toMatch(/^part 2 of \d+ returned invalid JSON — /);
  });

  it('does not retry a SCHEMA-valid-looking reply that is missing a required field, more than once', async () => {
    // A commitment without a task is the one thing the schema refuses outright.
    generateMock.mockResolvedValue(reply({ commitments: [{ owner: 'Marta Nováková', due: 'Friday' }] }));

    const result = await extractMeetingStructure(input());

    expect(generateMock).toHaveBeenCalledTimes(2); // first try + exactly one retry
    expect('failureReason' in result).toBe(true);
    if (!('failureReason' in result)) return;
    expect(result.failureReason).toContain('part 1 of 1 returned invalid JSON');
    expect(result.failureReason).toContain('commitments');
  });

  it('treats an EMPTY reply as a failure and does not retry it (AI-RESIL.1)', async () => {
    generateMock.mockResolvedValue({ text: '', usage: undefined });

    const result = await extractMeetingStructure(input());

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ failureReason: 'part 1 of 1 returned an empty response' });
  });

  it('treats a whitespace-only reply as empty too', async () => {
    generateMock.mockResolvedValue({ text: '   \n ', usage: undefined });
    const result = await extractMeetingStructure(input());
    expect(result).toEqual({ failureReason: 'part 1 of 1 returned an empty response' });
  });

  it('turns a thrown provider error into a failureReason — nothing escapes', async () => {
    generateMock.mockRejectedValue(new Error('fetch failed'));

    const result = await extractMeetingStructure(input());

    expect(result).toEqual({ failureReason: 'part 1 of 1 failed — the local AI server is not reachable' });
  });

  it('describes an unclassified provider error briefly instead of throwing', async () => {
    generateMock.mockRejectedValue(new Error('418 I am a teapot'));

    const result = await extractMeetingStructure(input());

    expect('failureReason' in result).toBe(true);
    if (!('failureReason' in result)) return;
    expect(result.failureReason).toBe('part 1 of 1 failed — 418 I am a teapot');
  });

  it('aborts the WHOLE run on a failing part — no partial structure (AI-CTX.1)', async () => {
    let call = 0;
    generateMock.mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve(reply({ topics: [{ title: 'Part one survived', detail: 'x' }] }));
      return Promise.reject(new Error('connection refused'));
    });

    const result = await extractMeetingStructure(longInput());

    expect('structure' in result).toBe(false);
    if (!('failureReason' in result)) return;
    expect(result.failureReason).toContain('the local AI server is not reachable');
  });
});

// ---------------------------------------------------------------------------
// Merge, in isolation
// ---------------------------------------------------------------------------

describe('mergeDrafts', () => {
  const draft = (raw: Record<string, unknown>) => MeetingStructureDraftSchema.parse(raw);

  it('is a no-op for a single draft', () => {
    const only = draft({ topics: [{ title: 'A', detail: 'a' }], terms: ['P2'] });
    expect(mergeDrafts([only])).toEqual(only);
  });

  it('matches duplicates case-, whitespace- and trailing-punctuation-insensitively', () => {
    const merged = mergeDrafts([
      draft({ decisions: [{ statement: 'Ship on Friday.' }], terms: ['Ledgerly'] }),
      draft({ decisions: [{ statement: 'ship  on   friday' }], terms: ['ledgerly'] }),
    ]);
    expect(merged.decisions).toHaveLength(1);
    expect(merged.decisions[0].statement).toBe('Ship on Friday.'); // first spelling kept
    expect(merged.terms).toEqual(['Ledgerly']);
  });

  it('keeps genuinely different items apart, including same task under different owners', () => {
    const merged = mergeDrafts([
      draft({ commitments: [{ owner: 'Marta Nováková', task: 'Review the draft', explicit: true }] }),
      draft({ commitments: [{ owner: 'Dev Raghunathan', task: 'Review the draft', explicit: true }] }),
      draft({ commitments: [{ task: 'Review the draft' }] }), // unowned — a third, distinct item
    ]);
    expect(merged.commitments).toHaveLength(3);
  });

  it('returns empty sections for no drafts at all', () => {
    expect(mergeDrafts([])).toEqual({ topics: [], decisions: [], commitments: [], openQuestions: [], terms: [] });
  });

  // -------------------------------------------------------------------------
  // LOCAL-QUAL.1: the containment second pass — collapses a re-stated
  // paraphrase the exact-key pass above cannot see, strictly by token subset.
  // -------------------------------------------------------------------------

  it('collapses a subset-paraphrase pair, keeping the richer title at the first-seen slot', () => {
    const merged = mergeDrafts([
      draft({ topics: [{ title: 'Set up the client registry', detail: 'short' }] }),
      draft({
        topics: [
          {
            title: 'Set up the client registry for the onboarding project',
            detail: 'A much longer explanation of the registry plan',
          },
        ],
      }),
    ]);
    expect(merged.topics).toHaveLength(1);
    expect(merged.topics[0].title).toBe('Set up the client registry for the onboarding project');
    expect(merged.topics[0].detail).toBe('A much longer explanation of the registry plan');
  });

  it('does not collapse a subset with fewer than 4 tokens (the guard)', () => {
    const merged = mergeDrafts([
      draft({ decisions: [{ statement: 'Freeze the export schema entirely' }] }),
      draft({ decisions: [{ statement: 'Freeze the schema' }] }), // 3 tokens — under the guard
    ]);
    expect(merged.decisions).toHaveLength(2);
  });

  it('keeps two distinct decisions that merely share a topic word apart', () => {
    const merged = mergeDrafts([
      draft({ decisions: [{ statement: 'Raise the export worker batch limit to five thousand' }] }),
      draft({ decisions: [{ statement: 'Retire the export worker after the new pipeline ships' }] }),
    ]);
    expect(merged.decisions).toHaveLength(2);
  });

  it('never collapses commitments across different owners, even with an identical task', () => {
    const merged = mergeDrafts([
      draft({
        commitments: [{ owner: 'Marta Nováková', task: 'Review the onboarding documentation draft', explicit: true }],
      }),
      draft({
        commitments: [{ owner: 'Dev Raghunathan', task: 'Review the onboarding documentation draft', explicit: true }],
      }),
    ]);
    expect(merged.commitments).toHaveLength(2);
  });

  it('collapses a diacritic-variant subset into its accented, richer counterpart', () => {
    const merged = mergeDrafts([
      draft({
        topics: [
          { title: 'Review the Nováková proposal with the wider team', detail: 'Full context from the planning doc' },
        ],
      }),
      draft({ topics: [{ title: 'Review the Novakova proposal', detail: '' }] }),
    ]);
    expect(merged.topics).toHaveLength(1);
    expect(merged.topics[0].title).toBe('Review the Nováková proposal with the wider team');
  });
});

// ---------------------------------------------------------------------------
// Self-healing overflow split
// ---------------------------------------------------------------------------
// The fit gate is an ESTIMATE (promptBudget.CHARS_PER_TOKEN). The live eval proved
// an estimate can be wrong for a tokenizer nobody measured — Czech on Qwen3 came in
// at ~2.09 chars/token — and when it is, the server rejects the request outright.
// A wrong estimate must then cost extra passes, never the user's brief.

describe('extractMeetingStructure — a part the server rejects as too large', () => {
  const longInput = () => input({ meeting: { ...BASE_MEETING, segments: LONG_SEGMENTS } });

  /** The shape ai-provider.ts actually produces for a local 400: its own wrapper
   *  message, with llama-server's raw text hanging off the cause as responseBody. */
  function overflowError(): Error {
    const raw = Object.assign(new Error('Bad Request'), {
      responseBody: 'request (17620 tokens) exceeds the available context size (16384 tokens)',
    });
    return new Error(
      'Request too large for the local model. The built-in runtime caps context to leave GPU memory for transcription — use fewer input items, or pick a model with a larger context.',
      { cause: raw },
    );
  }

  /** Only the RAW server text, with no wrapper — the LM Studio / plain-400 shape. */
  function rawOverflowError(): Error {
    return new Error('request (17620 tokens) exceeds the available context size (16384 tokens)');
  }

  function promptOf(call: number): string {
    return (generateMock.mock.calls[call][0] as { prompt: string }).prompt;
  }

  function draftFor(prompt: string) {
    // One identifiable topic per prompt, so the merged order can be read back.
    const label = /Part (\d+) of \d+(?: \(section ([\d.]+)\))?/.exec(prompt);
    const name = label ? `P${label[1]}${label[2] ? `s${label[2]}` : ''}` : 'single';
    return reply({ topics: [{ title: `Topic ${name}`, detail: `Detail ${name}` }] });
  }

  it('halves the part, extracts both halves, and splices them back IN ORDER', async () => {
    generateMock.mockImplementation((args: { prompt: string }) => {
      const isPart2Whole = args.prompt.includes('Part 2 of') && !args.prompt.includes('(section');
      if (isPart2Whole) return Promise.reject(overflowError());
      return Promise.resolve(draftFor(args.prompt));
    });

    const result = await extractMeetingStructure(longInput());

    expect('structure' in result).toBe(true);
    if (!('structure' in result)) return;
    const titles = result.structure.topics.map((t) => t.title);

    // Both halves ran, in order, exactly where the whole part would have been.
    expect(titles).toContain('Topic P2s1');
    expect(titles).toContain('Topic P2s2');
    expect(titles.indexOf('Topic P1')).toBeLessThan(titles.indexOf('Topic P2s1'));
    expect(titles.indexOf('Topic P2s1')).toBeLessThan(titles.indexOf('Topic P2s2'));
    expect(titles.indexOf('Topic P2s2')).toBeLessThan(titles.indexOf('Topic P3'));
    // Nothing else was disturbed: every other part is still present exactly once.
    expect(titles.filter((t) => t === 'Topic P3')).toHaveLength(1);
  });

  it('sends each half with less transcript than the rejected whole, and never re-sends the whole', async () => {
    generateMock.mockImplementation((args: { prompt: string }) => {
      const isPart2Whole = args.prompt.includes('Part 2 of') && !args.prompt.includes('(section');
      if (isPart2Whole) return Promise.reject(overflowError());
      return Promise.resolve(draftFor(args.prompt));
    });

    await extractMeetingStructure(longInput());

    const prompts = generateMock.mock.calls.map((c) => (c[0] as { prompt: string }).prompt);
    const whole = prompts.filter((p) => p.includes('Part 2 of') && !p.includes('(section'));
    const halves = prompts.filter((p) => p.includes('Part 2 of') && p.includes('(section'));
    // An overflow is deterministic in the request size: re-sending it is pure waste.
    expect(whole).toHaveLength(1);
    expect(halves).toHaveLength(2);
    expect(halves[0].length).toBeLessThan(whole[0].length);
    expect(halves[1].length).toBeLessThan(whole[0].length);
    expect(halves[0]).toContain('(section 1)');
    expect(halves[1]).toContain('(section 2)');
  });

  it('counts every successful call in `passes` — parts plus the extra section', async () => {
    generateMock.mockImplementation((args: { prompt: string }) => {
      const isPart2Whole = args.prompt.includes('Part 2 of') && !args.prompt.includes('(section');
      if (isPart2Whole) return Promise.reject(overflowError());
      return Promise.resolve(draftFor(args.prompt));
    });

    const result = await extractMeetingStructure(longInput());

    expect('structure' in result).toBe(true);
    if (!('structure' in result)) return;
    const parts = Number(/Part 1 of (\d+)/.exec(promptOf(0))![1]);
    // One part became two sections, so one MORE successful extraction than parts.
    expect(result.structure.provenance.passes).toBe(parts + 1);
  });

  it('logs ONE warn per split carrying provider/model, prompt chars and the reported tokens', async () => {
    generateMock.mockImplementation((args: { prompt: string }) => {
      const isPart2Whole = args.prompt.includes('Part 2 of') && !args.prompt.includes('(section');
      if (isPart2Whole) return Promise.reject(overflowError());
      return Promise.resolve(draftFor(args.prompt));
    });

    await extractMeetingStructure(longInput());

    expect(logMock.warn).toHaveBeenCalledTimes(1);
    const line = String(logMock.warn.mock.calls[0][0]);
    expect(line).toContain('part 2 of');
    expect(line).toContain('builtin/qwen3-4b');
    expect(line).toMatch(/\d+ prompt chars/);
    expect(line).toContain('server reported 17620 prompt tokens'); // read off responseBody
  });

  it("splits on the RAW server text too, not just ai-provider's wrapper", async () => {
    generateMock.mockImplementation((args: { prompt: string }) => {
      const isPart2Whole = args.prompt.includes('Part 2 of') && !args.prompt.includes('(section');
      if (isPart2Whole) return Promise.reject(rawOverflowError());
      return Promise.resolve(draftFor(args.prompt));
    });

    const result = await extractMeetingStructure(longInput());

    expect('structure' in result).toBe(true);
    expect(logMock.warn).toHaveBeenCalledTimes(1);
  });

  it('gives up after two splits with the size-estimate reason, naming the part', async () => {
    generateMock.mockImplementation((args: { prompt: string }) => {
      if (args.prompt.includes('Part 2 of')) return Promise.reject(overflowError());
      return Promise.resolve(draftFor(args.prompt));
    });

    const result = await extractMeetingStructure(longInput());

    expect('failureReason' in result).toBe(true);
    if (!('failureReason' in result)) return;
    expect(result.failureReason).toContain('part 2 of');
    expect(result.failureReason).toContain('the size estimate is wrong for this model');
    // 1 -> 2 -> 4 and no further: the whole part, then section 1, then section 1.1.
    const part2Calls = generateMock.mock.calls.filter((c) => (c[0] as { prompt: string }).prompt.includes('Part 2 of'));
    expect(part2Calls).toHaveLength(3);
    expect(logMock.warn).toHaveBeenCalledTimes(2); // one per split actually taken
  });

  it('reports the size-estimate reason without splitting when the part is ONE segment', async () => {
    // A single huge segment cannot be halved without cutting inside it, which the
    // chunker never does — so this is the honest end of the line.
    const single = { ...BASE_MEETING, segments: [{ startTime: 0, content: 'x'.repeat(60_000) }] };
    generateMock.mockRejectedValue(overflowError());

    const result = await extractMeetingStructure(input({ meeting: single }));

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect('failureReason' in result).toBe(true);
    if (!('failureReason' in result)) return;
    expect(result.failureReason).toContain('part 1 of 1');
    expect(result.failureReason).toContain('the size estimate is wrong for this model');
    expect(logMock.warn).not.toHaveBeenCalled();
  });

  it('never splits a NON-overflow error — those still fail on the first throw', async () => {
    generateMock.mockImplementation((args: { prompt: string }) => {
      const isPart2Whole = args.prompt.includes('Part 2 of') && !args.prompt.includes('(section');
      if (isPart2Whole) return Promise.reject(new Error('fetch failed'));
      return Promise.resolve(draftFor(args.prompt));
    });

    const result = await extractMeetingStructure(longInput());

    expect('failureReason' in result).toBe(true);
    if (!('failureReason' in result)) return;
    expect(result.failureReason).toContain('the local AI server is not reachable');
    expect(logMock.warn).not.toHaveBeenCalled();
    const sections = generateMock.mock.calls.filter((c) => (c[0] as { prompt: string }).prompt.includes('(section'));
    expect(sections).toHaveLength(0);
  });

  it('keeps the single-pass prompt header-free even though the split machinery exists', async () => {
    generateMock.mockResolvedValue(reply({ topics: [{ title: 'Fits', detail: 'one call' }] }));

    await extractMeetingStructure(input());

    expect(promptOf(0)).toContain('Meeting: Weekly sync');
    expect(promptOf(0)).not.toContain('Part 1 of 1');
    expect(promptOf(0)).not.toContain('(section');
  });
});

// ---------------------------------------------------------------------------
// Output truncation — the other half of "the estimate was wrong"
// ---------------------------------------------------------------------------
// Field defect, 2026-08-22: an 88-minute meeting was extracted with a cloud
// reasoning model whose output cap had been FABRICATED from an absent setting. Both
// the first attempt and its retry stopped at exactly the cap with a half-written
// JSON object, and the user got a failure card. Two lessons, both tested here: a
// cut-off reply is an OUTPUT overflow and must be answered by sending less, and
// re-sending the identical request can only produce the identical truncation.
// No real transcript content appears in any fixture below.

describe('extractMeetingStructure — a reply the model was cut off mid-way', () => {
  /** A JSON document that simply stops. Invented content only. */
  const HALF_WRITTEN = '{"topics":[{"title":"Release checklist","detail":"The team walked through the';

  function promptsSoFar(): string[] {
    return generateMock.mock.calls.map((c) => (c[0] as { prompt: string }).prompt);
  }

  function sectionPrompts(): string[] {
    return promptsSoFar().filter((p) => p.includes('(section'));
  }

  it("splits on finishReason 'length' instead of retrying, and merges both halves", async () => {
    let call = 0;
    generateMock.mockImplementation((args: { prompt: string }) => {
      call += 1;
      if (!args.prompt.includes('(section')) {
        return Promise.resolve({ text: HALF_WRITTEN, usage: { outputTokens: 4096 }, finishReason: 'length' });
      }
      return Promise.resolve(reply({ topics: [{ title: `Half ${call}`, detail: 'complete' }] }));
    });

    const result = await extractMeetingStructure(input());

    expect('structure' in result).toBe(true);
    if (!('structure' in result)) return;
    // One whole-part attempt, then exactly two sections — never a second attempt at
    // the identical prompt, which would be cut off at the identical place.
    expect(sectionPrompts()).toHaveLength(2);
    expect(promptsSoFar().filter((p) => !p.includes('(section'))).toHaveLength(1);
    expect(result.structure.topics.map((t) => t.title)).toEqual(['Half 2', 'Half 3']);
    expect(result.structure.provenance.passes).toBe(2);
  });

  it('splits on a half-written document even when the provider reports no finishReason', async () => {
    generateMock.mockImplementation((args: { prompt: string }) => {
      if (!args.prompt.includes('(section')) {
        return Promise.resolve({ text: HALF_WRITTEN, usage: undefined }); // no finishReason at all
      }
      return Promise.resolve(reply({ topics: [{ title: 'Recovered', detail: 'complete' }] }));
    });

    const result = await extractMeetingStructure(input());

    expect('structure' in result).toBe(true);
    expect(sectionPrompts()).toHaveLength(2);
    // The retry prompt must NOT appear: this is not a "try again" failure.
    expect(promptsSoFar().some((p) => p.includes('Your previous reply was rejected'))).toBe(false);
  });

  it('still RETRIES a complete-but-malformed reply, and never splits it', async () => {
    // Ends with a closing brace: the model finished, it just answered badly.
    let call = 0;
    generateMock.mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ text: '{"topics": [ }', usage: undefined });
      return Promise.resolve(reply({ topics: [{ title: 'Second try', detail: 'ok' }] }));
    });

    const result = await extractMeetingStructure(input());

    expect('structure' in result).toBe(true);
    expect(generateMock).toHaveBeenCalledTimes(2);
    expect(sectionPrompts()).toHaveLength(0);
    expect(promptsSoFar()[1]).toContain('Your previous reply was rejected');
  });

  it('treats a PROSE reply as malformed, not truncated — a refusal is not a size problem', async () => {
    let call = 0;
    generateMock.mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ text: 'I am sorry, I cannot help with that.', usage: undefined });
      return Promise.resolve(reply({ topics: [{ title: 'Recovered', detail: 'ok' }] }));
    });

    const result = await extractMeetingStructure(input());

    expect('structure' in result).toBe(true);
    expect(sectionPrompts()).toHaveLength(0); // sending less transcript would not help
    expect(promptsSoFar()[1]).toContain('Your previous reply was rejected');
  });

  it('logs ONE warn per truncation split, naming the completion tokens and the model', async () => {
    generateMock.mockImplementation((args: { prompt: string }) => {
      if (!args.prompt.includes('(section')) {
        return Promise.resolve({ text: HALF_WRITTEN, usage: { outputTokens: 4096 }, finishReason: 'length' });
      }
      return Promise.resolve(reply({ topics: [{ title: 'ok', detail: 'ok' }] }));
    });

    await extractMeetingStructure(input());

    expect(logMock.warn).toHaveBeenCalledTimes(1);
    expect(String(logMock.warn.mock.calls[0][0])).toBe(
      'part 1 of 1 output truncated at 4096 tokens on builtin/qwen3-4b; splitting into 2 sections',
    );
  });

  it('gives up with an output-limit reason when every section is still truncated', async () => {
    generateMock.mockResolvedValue({ text: HALF_WRITTEN, usage: { outputTokens: 4096 }, finishReason: 'length' });

    const result = await extractMeetingStructure(input());

    expect('failureReason' in result).toBe(true);
    if (!('failureReason' in result)) return;
    expect(result.failureReason).toContain('part 1 of 1');
    expect(result.failureReason).toContain('output room');
    // Bounded exactly like the input-overflow split: 1 -> 2 -> 4, no further.
    expect(generateMock.mock.calls.length).toBeLessThanOrEqual(7);
    expect(promptsSoFar().some((p) => p.includes('Your previous reply was rejected'))).toBe(false);
  });
});
