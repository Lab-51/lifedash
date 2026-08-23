// === FILE PURPOSE ===
// Tolerant JSON extraction from a language model's raw text reply (BRIEF-QUAL.1).
// Small local models routinely wrap their JSON in a ```json fence, open with a
// polite sentence, or append a closing remark — all of which make a bare
// JSON.parse() throw on output that is otherwise perfectly good. This module
// recovers the payload instead of discarding the whole generation, and fails with
// a typed, quotable error when there is genuinely nothing to parse.
//
// === DEPENDENCIES ===
// None (no runtime deps — usable from main and renderer alike).
//
// === LIMITATIONS ===
// - Recovers ONE top-level value: the outermost object or array in the text.
// - Does not repair malformed JSON (no trailing-comma fixing, no quote healing);
//   a syntactically broken payload is a ModelJsonError, which the caller answers
//   with its own retry-once policy.
// - liveTriageService, taskStructuringService, twinResearchService and
//   twinWebResearchService each still carry a private variant of this. Folding
//   them in is tracked in ISSUES.md and is deliberately NOT done here — this
//   module is used by the new extraction service only.

/** Chars of the offending text carried on the error — enough to identify what the
 *  model actually said (and to put in a retry prompt) without pasting a whole
 *  transcript-sized reply into a log line. */
const SNIPPET_CHARS = 200;

/** Thrown when a model reply contains no parseable JSON value. `snippet` is the
 *  first {@link SNIPPET_CHARS} characters of the offending text. */
export class ModelJsonError extends Error {
  readonly snippet: string;

  constructor(reason: string, offending: string) {
    const snippet = offending.slice(0, SNIPPET_CHARS);
    super(`${reason}: ${snippet}`);
    this.name = 'ModelJsonError';
    this.snippet = snippet;
  }
}

/** Drop a leading ```json / ``` marker and a trailing ``` marker. The slice below
 *  does most of the real work (fence markers contain no braces, so they fall
 *  outside it anyway); this only keeps the error snippets readable. */
function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

/** The outermost `{...}` or `[...]` span in `text`, whichever OPENS first, or null
 *  when neither is present or the closer precedes the opener. Slicing to the LAST
 *  closer is what tolerates trailing commentary. */
function sliceJsonSpan(text: string): string | null {
  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');
  const startsWithArray = arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart);
  const start = startsWithArray ? arrayStart : objectStart;
  if (start === -1) return null;
  const end = text.lastIndexOf(startsWithArray ? ']' : '}');
  return end > start ? text.slice(start, end + 1) : null;
}

/**
 * Parse the JSON value out of a model reply. Tolerates code fences, a leading
 * sentence and trailing commentary; returns `unknown` because validating the
 * shape is the caller's job (zod at every current call site).
 *
 * @throws {ModelJsonError} when no JSON value can be found or the extracted span
 *         is not valid JSON.
 */
export function parseModelJson(raw: string): unknown {
  const text = stripFences(raw);
  const span = sliceJsonSpan(text);
  if (!span) throw new ModelJsonError('the reply contained no JSON object or array', text);
  try {
    return JSON.parse(span) as unknown;
  } catch {
    throw new ModelJsonError('the reply was not valid JSON', span);
  }
}
