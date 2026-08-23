// === FILE PURPOSE ===
// The extraction system prompt and the three context blocks appended to it
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
- Social chit-chat, greetings and logistics unrelated to the subject (coffee, weather, pets, "can you hear me", "let's wait for the others") are NOT topics, decisions or commitments — skip them. Completeness applies to the WORK content.
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
 *  three context blocks apply. Empty blocks are dropped, never sent as blank lines. */
export function buildExtractionSystemPrompt(
  roster: RosterEntry[],
  template: MeetingTemplateType,
  langName: string | null,
): string {
  return [EXTRACTION_SYSTEM_PROMPT, formatRosterBlock(roster), templateHintBlock(template), languageBlock(langName)]
    .filter((block) => block.length > 0)
    .join('\n\n');
}
