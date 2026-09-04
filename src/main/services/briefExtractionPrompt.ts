// === FILE PURPOSE ===
// The extraction system prompt and the four context blocks appended to it
// (BRIEF-QUAL.1). Split out of briefExtractionService.ts so that file stays under
// the project's 500-line ceiling and so the prompt TEXT — the part reviewed by a
// human, and the part a model tier is tuned against — sits in one place with
// nothing else in it.
//
// Written for the WEAKEST tier LifeDash ships with (built-in Qwen3-4B at
// --ctx-size 16384): one JSON object, short keys, one short filled example. The
// same text is sent to gpt-5-mini and LM Studio — a second prompt set would be a
// second thing to be wrong. Every name in the example is invented; real meeting
// content never appears in a prompt fixture.
//
// === DEPENDENCIES ===
// shared/types/meetings.ts (MEETING_TEMPLATES — the source of truth for the
// per-template hints).

import { MEETING_TEMPLATES, type MeetingTemplateType } from '../../shared/types/meetings';

/** One known participant. `source` records where the name came from (calendar,
 *  transcript, …) and is NOT put in the prompt — only the spelling is.
 *  Defined locally on purpose: Task 3 swaps in participantRosterService's type. */
export interface RosterEntry {
  name: string;
  source: string;
}

export const EXTRACTION_SYSTEM_PROMPT = `You extract the contents of a meeting transcript into JSON. You are NOT summarizing: nothing may be shortened away, merged or left out.

Rules:
- Extract EVERYTHING that was said. Completeness beats brevity.
- Social chit-chat, greetings and logistics unrelated to the subject (coffee, weather, pets, "can you hear me", "let's wait for the others") are NOT topics, decisions or commitments — skip them. Running the meeting itself is logistics too, even when it sounds like a decision — starting without someone who is late, turning the recording on, or moving the meeting to another time are NOT topics, decisions or commitments either. Completeness applies to the WORK content.
- "detail" is 1-3 sentences and must keep the WHY and any conditions ("only if", "unless", "once X is done").
- "owner" is null unless the transcript makes a named person responsible. Never guess from who spoke last or who was mentioned last. Set "explicit" to true ONLY when the transcript names that owner; otherwise false.
- Keep numbers, dates, priorities (P2, P3), policy names, system names and acronyms EXACTLY as they were said. Do not translate them, do not normalize them.
- Never invent anything. If something was not said, use null (for a field) or an empty array (for a section).
- Output ONE JSON object and nothing else: no prose, no explanation, no code fence.

Output format (these exact keys):
{"topics":[{"title":"","detail":""}],"decisions":[{"statement":"","rationale":null}],"commitments":[{"owner":null,"task":"","due":null,"explicit":false}],"openQuestions":[""],"terms":[""]}

Example:
{"topics":[{"title":"Nightly invoice export is failing","detail":"The export to Ledgerly failed twice this week. It only fails for accounts with more than 500 line items, so the batch limit is the suspected cause."}],"decisions":[{"statement":"Raise the export batch limit to 2000 line items","rationale":"Only large accounts fail, and a bigger batch is cheaper than rewriting the worker"}],"commitments":[{"owner":"Marta","task":"Patch the batch limit and redeploy the export worker","due":"Friday","explicit":true},{"owner":null,"task":"Ask Ledgerly support whether the P2 ticket can be escalated","due":null,"explicit":false}],"openQuestions":["Does the 500 line item limit come from Ledgerly or from our own config?"],"terms":["Ledgerly","P2","export worker"]}`;

/**
 * The participant block. Exact wording shared with Task 1's `formatRosterBlock`
 * (participantRosterService.ts) — built locally for now behind this one function
 * so Task 3 can swap the import with a single-line change.
 *
 * Names ONLY: attendee emails never enter a prompt.
 */
export function formatRosterBlock(roster: RosterEntry[]): string {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of roster) {
    const name = entry.name.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  if (names.length === 0) return '';
  return `Participants (use these exact spellings; a commitment has an owner ONLY when the transcript makes it explicit): ${names.join(', ')}`;
}

/**
 * Exact-spelling anchors for names the transcript will bend: the project name
 * today (LOCAL-QUAL.1), after a real meeting turned a product name into a
 * declined form the brief then carried. Rendered ONLY when there is something to
 * anchor, so a meeting with no project sends byte-identically to before.
 *
 * Names ONLY, same as the roster block: an email never enters a prompt.
 */
function knownTermsBlock(terms: string[]): string {
  const names = terms.map((term) => term.trim()).filter((term) => term.length > 0);
  if (names.length === 0) return '';
  return `Known names (use these exact spellings, even where the transcript inflects or declines them): ${names.join(', ')}`;
}

/**
 * The speaker legend (SPEAKER.1). Rendered ONLY when the transcript actually
 * carries labels — `selfName` is null for an unlabelled transcript, so the
 * prompt stays byte-identical to the pre-SPEAKER.1 one (BRIEF-QUAL.1's pins).
 *
 * This EXTENDS the owner rule, it never relaxes it: a `Me` line making its own
 * commitment IS the transcript naming that owner, which is why it may be
 * attributed and marked explicit; an unresolved `Speaker N` is not evidence of
 * anything, so it must never be guessed onto a roster name.
 *
 * `selfName` is a NAME only — the caller resolves it from the twin profile and
 * falls back to "the user". Emails never enter a prompt.
 */
function speakerLegendBlock(selfName: string | null): string {
  if (!selfName) return '';
  return [
    `Speaker labels: each transcript line may start with a speaker label before the colon. "Me" is ${selfName}, the person recording. "Speaker 1", "Speaker 2" and so on are OTHER participants whose identity is unresolved.`,
    `Attribute a commitment to ${selfName} when the "Me" line is the one making it — that is the transcript naming the owner, so "explicit" is true. Never map a "Speaker N" label to a participant name unless the transcript itself says who that speaker is, and never use a label as an owner: an unresolved "Speaker N" commitment keeps "owner": null and "explicit": false.`,
  ].join(' ');
}

/** The template's own hint, for ALL SIX templates — MEETING_TEMPLATES is the
 *  source of truth (action extraction used to hardcode three of them). */
function templateHintBlock(template: MeetingTemplateType): string {
  const hint = MEETING_TEMPLATES.find((t) => t.type === template)?.aiPromptHint;
  return hint ? `IMPORTANT CONTEXT: ${hint}` : '';
}

/** Content strings follow the transcript's language; the KEYS never do. */
function languageBlock(langName: string | null): string {
  if (!langName) return '';
  return `IMPORTANT: The transcript is in ${langName}. Write every string VALUE in ${langName}. The JSON keys stay exactly as shown above, in English.`;
}

/** The full system prompt for one extraction run: the rules, then whichever of the
 *  five context blocks apply. Empty blocks are dropped, never sent as blank lines —
 *  so with no known terms and an UNLABELLED transcript this is byte-identical to
 *  the three-block prompt that preceded them (asserted in
 *  briefExtractionService.test.ts). */
export function buildExtractionSystemPrompt(
  roster: RosterEntry[],
  template: MeetingTemplateType,
  langName: string | null,
  knownTerms: string[] = [],
  selfName: string | null = null,
): string {
  return [
    EXTRACTION_SYSTEM_PROMPT,
    formatRosterBlock(roster),
    speakerLegendBlock(selfName),
    knownTermsBlock(knownTerms),
    templateHintBlock(template),
    languageBlock(langName),
  ]
    .filter((block) => block.length > 0)
    .join('\n\n');
}
