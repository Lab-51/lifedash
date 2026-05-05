// === FILE PURPOSE ===
// LLM-based project auto-detect classifier. Given a meeting transcript and the
// list of user projects, returns the most likely project ID with a confidence
// score. Used by the meeting auto-flow (Task MEET-INTEL.1-3) to route incoming
// meetings to the right project — or to the system Unassigned bucket when
// confidence is too low.
//
// === DEPENDENCIES ===
// ai-provider (generate, resolveTaskModel)
// shared types (Project)
//
// === LIMITATIONS ===
// - Uses the first ~500 words of the transcript only — opening greetings/small
//   talk reduce signal. Acceptable for v1.
// - The classifier never throws — returns null projectId + reason on every
//   error path so the orchestrator can fall back to Unassigned routing.

import { generate, resolveTaskModel, type ResolvedProvider } from './ai-provider';
import { createLogger } from './logger';

const log = createLogger('ProjectDetect');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DetectionProject {
  id: string;
  name: string;
  description: string | null;
}

export interface DetectionResult {
  projectId: string | null;
  confidence: number;
  reason: string;
}

export interface DetectArgs {
  transcript: string;
  projects: DetectionProject[];
  /**
   * Resolves the AI provider to use for the classification call.
   * Defaults to the "summarization" task model — that is the cheap tier
   * already configured by users for brief / action item generation.
   * Override for tests or special routing.
   */
  modelResolver?: () => Promise<ResolvedProvider | null>;
  /**
   * Override the generate function for tests. Defaults to the production
   * generate() call from ai-provider.
   */
  generateFn?: typeof generate;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRANSCRIPT_WORD_LIMIT = 500;
const SYSTEM_PROMPT =
  'You are classifying which project a meeting is about. Given the project list and the first portion of the meeting transcript, decide which project is the meeting most likely about. If no project is a clear match, return projectId: null. Reply ONLY with JSON.';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Take the first N words from a transcript. Returns the original string if
 * shorter than the limit. Whitespace is collapsed to single spaces.
 */
function firstNWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= n) return text.trim();
  return words.slice(0, n).join(' ');
}

/**
 * Build the user prompt: project list + transcript window + JSON shape spec.
 */
function buildUserPrompt(transcript: string, projects: DetectionProject[]): string {
  const projectLines = projects
    .map((p) => `- id: ${p.id}, name: ${p.name}, description: ${p.description ?? 'no description'}`)
    .join('\n');

  return [
    'Projects:',
    projectLines,
    '',
    'Meeting transcript (first ~500 words):',
    transcript,
    '',
    'Reply ONLY with JSON in this exact shape:',
    '{ "projectId": "<id>" or null, "confidence": <number 0-1>, "reason": "<one sentence>" }',
  ].join('\n');
}

/**
 * Strip markdown code fences and parse JSON from the model response text.
 * Returns null on any failure (caller treats as parse error).
 */
function tryParseJson(text: string): unknown {
  try {
    const cleaned = text
      .replace(/```json?\n?/gi, '')
      .replace(/```\n?/g, '')
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Validate parsed object matches the expected detection shape and that
 * projectId, if non-null, is in the input list. Returns a normalised
 * DetectionResult or null when the response is structurally invalid.
 */
function validateResponse(parsed: unknown, validIds: Set<string>): DetectionResult | null {
  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;
  const rawId = obj.projectId;
  const rawConfidence = obj.confidence;
  const rawReason = obj.reason;

  // confidence must be a number
  if (typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence)) {
    return null;
  }
  const confidence = Math.max(0, Math.min(1, rawConfidence));

  // reason must be a string (fall back to empty)
  const reason = typeof rawReason === 'string' ? rawReason : '';

  // projectId: null is valid; if string, must be in the input list
  let projectId: string | null;
  if (rawId === null || rawId === undefined) {
    projectId = null;
  } else if (typeof rawId === 'string') {
    if (validIds.has(rawId)) {
      projectId = rawId;
    } else {
      // Hallucinated ID — defensive: treat as null but preserve the reason
      log.warn(`Classifier returned projectId not in input list: ${rawId}`);
      return {
        projectId: null,
        confidence: 0,
        reason: `hallucinated projectId: ${rawId}`,
      };
    }
  } else {
    return null;
  }

  return { projectId, confidence, reason };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify which project a meeting transcript is about.
 *
 * Behaviour:
 * - Empty project list → returns `{ projectId: null, confidence: 0, reason: 'no projects available' }` without invoking the LLM.
 * - No AI provider configured → returns null + reason 'no AI provider configured'.
 * - JSON parse / validation failure → returns null + reason describing the failure.
 * - LLM-returned projectId not in input list → treated as null (hallucination guard).
 *
 * Never throws to the caller. The caller is responsible for applying any
 * confidence threshold (default 0.8 in the orchestrator).
 */
export async function detectProjectFromTranscript(args: DetectArgs): Promise<DetectionResult> {
  const { transcript, projects } = args;

  // 1. No projects → skip the LLM entirely
  if (projects.length === 0) {
    return { projectId: null, confidence: 0, reason: 'no projects available' };
  }

  // 2. No transcript content → also skip
  const trimmed = transcript.trim();
  if (trimmed.length === 0) {
    return { projectId: null, confidence: 0, reason: 'empty transcript' };
  }

  // 3. Resolve model (task tier)
  const resolver = args.modelResolver ?? (() => resolveTaskModel('summarization'));
  let provider: ResolvedProvider | null;
  try {
    provider = await resolver();
  } catch (err) {
    log.error('Model resolution failed:', err);
    return { projectId: null, confidence: 0, reason: 'model resolution failed' };
  }

  if (!provider) {
    return { projectId: null, confidence: 0, reason: 'no AI provider configured' };
  }

  // 4. Build prompt
  const window = firstNWords(trimmed, TRANSCRIPT_WORD_LIMIT);
  const userPrompt = buildUserPrompt(window, projects);

  log.info(
    `Classifying meeting: ${projects.length} project(s) considered, transcript ${window.length} chars, model ${provider.providerName}/${provider.model}`,
  );

  // 5. Call the LLM
  const generateFn = args.generateFn ?? generate;
  let responseText: string;
  try {
    const result = await generateFn({
      providerId: provider.providerId,
      providerName: provider.providerName,
      apiKeyEncrypted: provider.apiKeyEncrypted,
      baseUrl: provider.baseUrl,
      model: provider.model,
      taskType: 'project_detection',
      prompt: userPrompt,
      system: SYSTEM_PROMPT,
      temperature: provider.temperature,
      maxTokens: provider.maxTokens,
    });
    responseText = result.text ?? '';
  } catch (err) {
    log.error('Classifier LLM call failed:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return { projectId: null, confidence: 0, reason: `llm error: ${msg}` };
  }

  // 6. Parse the response
  const parsed = tryParseJson(responseText);
  if (parsed === null) {
    const preview = responseText.slice(0, 120);
    log.warn(`Classifier JSON parse failed. Response preview: ${preview}`);
    return { projectId: null, confidence: 0, reason: `parse error: ${preview}` };
  }

  // 7. Validate + hallucination guard
  const validIds = new Set(projects.map((p) => p.id));
  const validated = validateResponse(parsed, validIds);
  if (!validated) {
    return { projectId: null, confidence: 0, reason: 'invalid response shape' };
  }

  // 8. Log the outcome (top candidate only — no full transcript)
  const topName = validated.projectId ? (projects.find((p) => p.id === validated.projectId)?.name ?? '?') : '(none)';
  log.info(
    `Detection result: project=${topName} confidence=${validated.confidence.toFixed(2)} reason="${validated.reason}"`,
  );

  return validated;
}
