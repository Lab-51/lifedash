// === FILE PURPOSE ===
// Structured extraction pass (BRIEF-QUAL.1): turn a transcript of ANY length into
// one validated, complete, owner-honest MeetingStructure. This is the "extract"
// half of extract-then-write — the brief writer (Task 3) never sees the raw
// transcript again, so nothing may be summarized away here.
//
// One prompt set and one parser for every model tier. The prompts are written for
// the WEAKEST tier LifeDash ships with (the built-in Qwen3-4B at --ctx-size 16384):
// short keys, ONE JSON object, one short filled example. gpt-5-mini and an LM Studio
// model get exactly the same instructions — a second prompt set would be a second
// thing to be wrong.
//
// Long transcripts are extracted part-by-part SEQUENTIALLY (the built-in sidecar
// runs `--parallel 1`) and merged DETERMINISTICALLY in code. A merge call to the
// model would re-introduce the compression step this phase exists to remove, and
// AI-CTX.1 (e) forbids partial results — a merge in code cannot drop anything.
//
// NEVER throws: every failure comes back as `{ failureReason }` so generateBrief
// can persist a classified failure card (AI-RESIL.1) instead of half a brief.
//
// === DEPENDENCIES ===
// ai-provider.ts (generate — always taskType 'summarization', which is what routing,
// usage logging and AI-RESIL.2's runtime pin key off), promptBudget.ts (the shared
// fit gate and chunk math), shared/utils/llm-json.ts, shared/types/briefStructure.ts.
//
// === LIMITATIONS ===
// - Part headers ("Part 2 of 5") are English regardless of transcript language;
//   the language instruction governs the CONTENT strings only.
// - `roster` is typed locally (RosterEntry) until Task 3 wires participantRosterService in.

import { generate, type ResolvedProvider } from './ai-provider';
import { chunkBudget, chunkSegments, fitsWindow, formatLine, type PromptLineSegment } from './promptBudget';
import { createLogger } from './logger';
import { buildExtractionSystemPrompt, type RosterEntry } from './briefExtractionPrompt';
import { mergeDrafts } from './briefStructureMerge';
import {
  capped,
  collectErrorText,
  describeProviderError,
  isContextOverflow,
  isTruncatedText,
  reportedTokenCount,
} from './briefExtractionFailures';
import { parseModelJson } from '../../shared/utils/llm-json';
import {
  BRIEF_STRUCTURE_SCHEMA_VERSION,
  MeetingStructureDraftSchema,
  type MeetingStructure,
  type MeetingStructureDraft,
} from '../../shared/types/briefStructure';
import type { MeetingTemplateType } from '../../shared/types/meetings';

// Re-exported so the extraction service stays the single import site for callers:
// the prompt text and the merge algebra moved to siblings for file size, not to
// widen the API.
export { mergeDrafts };
export type { RosterEntry };

const log = createLogger('BriefExtraction');

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/** The only segment fields prompt assembly reads — promptBudget owns the shape
 *  (SPEAKER.1), so a labelled segment is measured exactly as it is sent. */
type PromptSegment = PromptLineSegment;

export interface ExtractionInput {
  provider: ResolvedProvider;
  meeting: {
    id: string;
    title: string;
    template: MeetingTemplateType;
    segments: PromptSegment[];
  };
  roster: RosterEntry[];
  /** Display name of the transcript language ("Czech"), or null for English/unknown. */
  langName: string | null;
  /** Names whose spelling the model must not drift from — the project name today.
   *  Absent or empty leaves the system prompt byte-identical to a three-block one. */
  knownTerms?: string[];
  /** The recording user's own name (twin profile identity), for the SPEAKER.1
   *  legend that explains the `Me` label. Only used when the transcript is
   *  actually labelled; absent/blank falls back to "the user" in that case, and
   *  an UNLABELLED transcript emits no legend at all whatever this holds. */
  selfName?: string | null;
}

/** Success or an honest reason — never a partial structure, never a throw. */
export type ExtractionOutcome = { structure: MeetingStructure } | { failureReason: string };

/** Attempts per part: the first try plus ONE retry carrying the validation error
 *  (the liveTriageService precedent). A second failure is a failureReason. */
const MAX_ATTEMPTS = 2;

/** Cap for a parse/validation issue echoed into a retry prompt or a failure
 *  reason — enough to diagnose, never a transcript-sized paste. */
const ISSUE_CHAR_CAP = 160;

/** How many times ONE part may be halved when the server rejects it as too large:
 *  1 -> 2 -> 4 sections. Bounded on purpose — the split is a SAFETY NET for a wrong
 *  char/token estimate, not a substitute for it (promptBudget.CHARS_PER_TOKEN is
 *  where the fix belongs), and an unbounded loop against a DETERMINISTIC rejection
 *  is exactly the shape AI-CTX.1 forbids. */
const MAX_SPLIT_DEPTH = 2;

/** Reason for an overflow that could not be split any further. Same wording as
 *  meetingIntelligenceService's classifyBriefFailure overflow bucket, deliberately:
 *  if a user ever sees this, the estimate is wrong for that model, and the warn line
 *  from `logSplit` (prompt chars + the server's own token count) is how it gets
 *  re-tuned from field logs. */
const SIZE_ESTIMATE_WRONG =
  'the request outgrew the model context window even though the chunking gate should have prevented it — please report this, the size estimate is wrong for this model';

/** Reason for a reply that was still cut off at the model's output limit after the
 *  bounded splits. Distinct from SIZE_ESTIMATE_WRONG: the INPUT fit, the answer did
 *  not, so the actionable advice is a bigger output allowance, not a smaller prompt. */
const OUTPUT_STILL_TRUNCATED =
  "the model kept running out of output room even after the transcript was split — raise this task's max output tokens in Settings, or use a model with a larger output limit";

/**
 * The two failure classes that MORE, SMALLER requests can fix:
 *   - 'overflow'   the request did not fit the context window (input side);
 *   - 'truncation' the reply was cut off at the output limit (output side).
 * Everything else fails immediately — retrying or splitting would just cost time.
 */
type SplitCause = 'overflow' | 'truncation';

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------
// The system prompt TEXT lives in briefExtractionPrompt.ts; what stays here is
// how a transcript is sliced into parts and rendered into a user prompt.

/** Renders through promptBudget's `formatLine`, so what is SENT is exactly what
 *  was MEASURED (AI-CTX.1: one estimate, one place to be wrong). */
function formatTranscript(segments: PromptSegment[]): string {
  return segments.map(formatLine).join('\n');
}

/**
 * One unit of extraction: which segments, where it sits in the run, and — after a
 * self-healing split — which section of its part it is. `sections` is the split
 * path (`[1]`, then `[1, 2]`), so a label stays unambiguous at any depth.
 */
interface PartRef {
  segments: PromptSegment[];
  /** 1-based part number, and the planned part count. */
  index: number;
  total: number;
  /** True when the transcript did not fit and the prompt therefore carries a
   *  "Part i of N" header. False for the single-pass shape, whose bytes must not
   *  move just because the split machinery exists. */
  chunked: boolean;
  sections: number[];
}

function sectionSuffix(sections: number[]): string {
  return sections.length > 0 ? ` (section ${sections.join('.')})` : '';
}

/** Label used in failure reasons and logs. ALWAYS names the part — that is what a
 *  failure card, and Task 3's classifier, key off. */
function partLabel(part: PartRef): string {
  return `part ${part.index} of ${part.total}${sectionSuffix(part.sections)}`;
}

function buildUserPrompt(title: string, part: PartRef): string {
  const header =
    part.chunked || part.sections.length > 0
      ? `Part ${part.index} of ${part.total}${sectionSuffix(part.sections)} of meeting "${title}"`
      : `Meeting: ${title}`;
  return `${header}\n\nTranscript:\n${formatTranscript(part.segments)}`;
}

/**
 * One part per extraction call: a single full-transcript part when it fits the
 * window, otherwise one part per chunk. Each part is a FULL extraction of that
 * part — the parts are merged in code, not by the model.
 */
function planParts(
  provider: ResolvedProvider,
  systemPrompt: string,
  title: string,
  segments: PromptSegment[],
): PartRef[] {
  const single: PartRef = { segments, index: 1, total: 1, chunked: false, sections: [] };
  if (fitsWindow(provider, systemPrompt, buildUserPrompt(title, single))) return [single];
  const chunks = chunkSegments(segments, chunkBudget(provider, systemPrompt));
  return chunks.map((chunk, i) => ({
    segments: chunk,
    index: i + 1,
    total: chunks.length,
    chunked: true,
    sections: [],
  }));
}

/** Halve a part's segments by cumulative FORMATTED length (the same `formatLine`
 *  the budget is measured with), never inside a segment. Both halves are non-empty,
 *  so callers must not call this with fewer than two segments. */
function splitByLength(segments: PromptSegment[]): PromptSegment[][] {
  const lengths = segments.map((segment) => formatLine(segment).length + 1);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let accumulated = 0;
  let cut = 1;
  for (let i = 0; i < segments.length - 1; i++) {
    accumulated += lengths[i];
    cut = i + 1;
    if (accumulated >= total / 2) break;
  }
  return [segments.slice(0, cut), segments.slice(cut)];
}

// ---------------------------------------------------------------------------
// Parsing + one call
// ---------------------------------------------------------------------------

/**
 * Parse + validate one part's reply. Returns the terse `issue` text that both the
 * retry prompt and (on a second failure) the failure reason are built from.
 */
function parseDraft(text: string): { draft: MeetingStructureDraft } | { issue: string } {
  let json: unknown;
  try {
    json = parseModelJson(text);
  } catch (err) {
    return { issue: capped(err instanceof Error ? err.message : String(err), ISSUE_CHAR_CAP) };
  }
  const result = MeetingStructureDraftSchema.safeParse(json);
  if (result.success) return { draft: result.data };
  const first = result.error.issues[0];
  const where = first?.path.join('.') || 'the object';
  return { issue: capped(`${where}: ${first?.message ?? 'did not match the required shape'}`, ISSUE_CHAR_CAP) };
}

/** What one `generate` call gives this service: the text, plus the two signals that
 *  tell a cut-off reply from a complete one. */
interface PassResult {
  text: string;
  /** 'length' means the model was CUT OFF at its output limit — see isTruncated. */
  finishReason: string | undefined;
  /** Completion tokens, for the truncation log line. */
  outputTokens: number | null;
}

/** One `generate` call. Empty text is a FAILURE, never an empty structure
 *  (AI-RESIL.1) — and it is not retried, because an empty reply is a runtime
 *  problem (reasoning budget, dead sidecar), not a malformed-JSON problem. */
async function runPass(provider: ResolvedProvider, systemPrompt: string, prompt: string): Promise<PassResult> {
  const result = await generate({
    providerId: provider.providerId,
    providerName: provider.providerName,
    apiKeyEncrypted: provider.apiKeyEncrypted,
    baseUrl: provider.baseUrl,
    model: provider.model,
    taskType: 'summarization',
    prompt,
    system: systemPrompt,
    temperature: provider.temperature,
    maxTokens: provider.maxTokens,
  });
  return {
    text: result.text ?? '',
    finishReason: result.finishReason,
    outputTokens: result.usage?.outputTokens ?? null,
  };
}

/** A part that could not be extracted. `splitCause` marks the failure classes the
 *  caller may answer by sending LESS (see extractWithSplit); `errorText` carries the
 *  provider's full text so the split log can quote the server's token count, and
 *  `outputTokens` the completion tokens for the truncation line. */
interface PartFailure {
  failureReason: string;
  splitCause: SplitCause | null;
  errorText: string;
  outputTokens: number | null;
}

/**
 * Extract ONE part, retrying at most once with the validation error appended to
 * the same user prompt. A failing part aborts the whole run (AI-CTX.1: no partial
 * results) — the caller turns that into a failure card, or, for an overflow, into
 * a split.
 *
 * Neither an overflow nor a truncation is retried here: both are deterministic in
 * the request size, so re-sending the same bytes can only fail again and burn a
 * minute of a local model's time. Only genuinely malformed-but-COMPLETE JSON earns
 * the retry — that one can plausibly come back right.
 */
async function extractPart(
  provider: ResolvedProvider,
  systemPrompt: string,
  userPrompt: string,
  label: string,
): Promise<{ draft: MeetingStructureDraft } | PartFailure> {
  let prompt = userPrompt;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let pass: PassResult;
    try {
      pass = await runPass(provider, systemPrompt, prompt);
    } catch (err) {
      const errorText = collectErrorText(err);
      const overflow = isContextOverflow(errorText);
      if (!overflow) log.error(`${label} failed:`, err);
      return {
        failureReason: `${label} failed — ${describeProviderError(err)}`,
        splitCause: overflow ? 'overflow' : null,
        errorText,
        outputTokens: null,
      };
    }
    const { text } = pass;
    if (!text.trim()) {
      return {
        failureReason: `${label} returned an empty response`,
        splitCause: null,
        errorText: '',
        outputTokens: null,
      };
    }
    if (pass.finishReason === 'length') {
      return truncatedFailure(label, pass.outputTokens);
    }

    const parsed = parseDraft(text);
    if ('draft' in parsed) return parsed;
    if (isTruncatedText(text)) return truncatedFailure(label, pass.outputTokens);
    if (attempt === MAX_ATTEMPTS) {
      return {
        failureReason: `${label} returned invalid JSON — ${parsed.issue}`,
        splitCause: null,
        errorText: '',
        outputTokens: null,
      };
    }

    log.info(`${label} returned invalid JSON (${parsed.issue}) — retrying once`);
    prompt = `${userPrompt}\n\nYour previous reply was rejected: ${parsed.issue}\nReply with ONLY the JSON object described in the instructions. No prose, no code fence.`;
  }
  // Unreachable (the loop returns on every path); TypeScript cannot prove the bound.
  return { failureReason: `${label} produced no result`, splitCause: null, errorText: '', outputTokens: null };
}

/** A cut-off reply, phrased for the caller that will split it. */
function truncatedFailure(label: string, outputTokens: number | null): PartFailure {
  return {
    failureReason: `${label} — ${OUTPUT_STILL_TRUNCATED}`,
    splitCause: 'truncation',
    errorText: '',
    outputTokens,
  };
}

// ---------------------------------------------------------------------------
// Self-healing overflow split
// ---------------------------------------------------------------------------

/** What every extraction call in one run shares. */
interface RunContext {
  provider: ResolvedProvider;
  systemPrompt: string;
  title: string;
}

/** ONE warn line per split, carrying everything needed to diagnose it from a field
 *  log: which side blew up, provider/model, and the measured numbers — for an input
 *  overflow the prompt's char length against the server's own prompt-token count
 *  (their ratio IS that model's real chars/token), for an output truncation the
 *  completion tokens the model was cut off at. */
function logSplit(ctx: RunContext, part: PartRef, promptChars: number, failure: PartFailure): void {
  const model = `${ctx.provider.providerName}/${ctx.provider.model}`;
  if (failure.splitCause === 'truncation') {
    const at = failure.outputTokens === null ? 'its output limit' : `${failure.outputTokens} tokens`;
    log.warn(`${partLabel(part)} output truncated at ${at} on ${model}; splitting into 2 sections`);
    return;
  }
  const tokens = reportedTokenCount(failure.errorText);
  const measured = tokens === null ? 'no token count reported' : `server reported ${tokens} prompt tokens`;
  log.warn(
    `${partLabel(part)} overflowed ${model} — ${promptChars} prompt chars, ${measured}; ` +
      `splitting into 2 sections (re-tune promptBudget.CHARS_PER_TOKEN if this recurs)`,
  );
}

/**
 * Extract one part, halving it and retrying the halves when — and ONLY when — sending
 * LESS could plausibly help: the provider rejected the request as too large (input),
 * or cut the reply off at its output limit (output). Both are estimates being wrong,
 * one about the tokenizer and one about how much JSON a meeting produces, and neither
 * should cost the user their brief when more, smaller passes would succeed.
 *
 * Bounded by MAX_SPLIT_DEPTH, and by a part that is a single segment (nothing left to
 * halve): both exits report the cause-appropriate reason, naming the part. Every
 * other error class fails immediately, unchanged.
 */
async function extractWithSplit(
  ctx: RunContext,
  part: PartRef,
  depth: number,
): Promise<{ drafts: MeetingStructureDraft[] } | { failureReason: string }> {
  const prompt = buildUserPrompt(ctx.title, part);
  const outcome = await extractPart(ctx.provider, ctx.systemPrompt, prompt, partLabel(part));
  if ('draft' in outcome) return { drafts: [outcome.draft] };
  if (outcome.splitCause === null) return { failureReason: outcome.failureReason };
  if (depth >= MAX_SPLIT_DEPTH || part.segments.length < 2) {
    const exhausted = outcome.splitCause === 'truncation' ? OUTPUT_STILL_TRUNCATED : SIZE_ESTIMATE_WRONG;
    return { failureReason: `${partLabel(part)} — ${exhausted}` };
  }

  logSplit(ctx, part, prompt.length, outcome);
  const drafts: MeetingStructureDraft[] = [];
  const halves = splitByLength(part.segments);
  for (let i = 0; i < halves.length; i++) {
    // Sequential, in order: the halves' drafts must splice back into the part
    // sequence exactly where the part was, or the merge's first-seen order lies.
    const section = { ...part, segments: halves[i], sections: [...part.sections, i + 1] };
    const sub = await extractWithSplit(ctx, section, depth + 1);
    if ('failureReason' in sub) return sub;
    drafts.push(...sub.drafts);
  }
  return { drafts };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Extract the full structure of a meeting. Single pass when the transcript fits
 * the provider's context window, otherwise N sequential part passes merged in
 * code. `provenance.passes` is the number of parts.
 *
 * Returns `{ failureReason }` — never throws — on a provider error, an empty
 * reply, or output that is still invalid after one retry.
 */
export async function extractMeetingStructure(input: ExtractionInput): Promise<ExtractionOutcome> {
  const { provider, meeting } = input;
  // The legend explains labels, so it is emitted only when there ARE labels —
  // an unlabelled transcript keeps the pre-SPEAKER.1 prompt byte for byte.
  const labelled = meeting.segments.some((segment) => segment.speaker?.trim());
  const selfName = labelled ? input.selfName?.trim() || 'the user' : null;
  const systemPrompt = buildExtractionSystemPrompt(
    input.roster,
    meeting.template,
    input.langName,
    input.knownTerms,
    selfName,
  );
  const segments = [...meeting.segments].sort((a, b) => a.startTime - b.startTime);
  const parts = planParts(provider, systemPrompt, meeting.title, segments);
  if (parts.length > 1) {
    log.info(`Extraction for meeting ${meeting.id}: transcript exceeds the window — ${parts.length} part(s)`);
  }

  const ctx: RunContext = { provider, systemPrompt, title: meeting.title };
  const drafts: MeetingStructureDraft[] = [];
  for (const part of parts) {
    // Sequential on purpose: the built-in sidecar runs `--parallel 1`, so
    // concurrent parts would queue anyway while making attribution harder.
    const outcome = await extractWithSplit(ctx, part, 0);
    if ('failureReason' in outcome) {
      log.error(`Extraction for meeting ${meeting.id} failed: ${outcome.failureReason}`);
      return { failureReason: outcome.failureReason };
    }
    drafts.push(...outcome.drafts);
  }

  return {
    structure: {
      ...mergeDrafts(drafts),
      provenance: {
        provider: provider.providerName,
        model: provider.model,
        // Successful extraction calls actually made — parts, plus the extra
        // sections any overflowing part was split into.
        passes: drafts.length,
        extractedAt: new Date().toISOString(),
        schemaVersion: BRIEF_STRUCTURE_SCHEMA_VERSION,
      },
    },
  };
}
