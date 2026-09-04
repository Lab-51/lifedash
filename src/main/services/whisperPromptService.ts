// === FILE PURPOSE ===
// Composes the whisper "glossary" — the initial-prompt seed transcriptionService
// hands to whisper.cpp at the START of a recording session — so the model has
// been TOLD how to spell names and project terms before it ever hears them
// (SPEAKER.1 Task 2).
//
// === HOW IT WORKS ===
// buildInitialPrompt(meetingId, presetCode) composes, in priority order:
//   1. the participant roster (participantRosterService — names only, never
//      emails, already deduped/capped there),
//   2. the meeting's project name and the project's known topic entities
//      (entities kind='topic' linked to any of the project's meetings, capped),
//   3. the user's per-preset glossary setting (`transcription:initial-prompt:
//      <presetCode>`), falling back to the built-in trilingual default ONLY for
//      the three mixed presets — plain presets have no built-in default and stay
//      empty when unset.
// Each of those is one "item". The joined string is capped to a token-safe
// character budget by dropping WHOLE items from the end (lowest priority
// first) — never by slicing a name in half.
//
// This function returns ONLY the glossary portion. transcriptionService still
// owns appending the per-segment rolling context after it, unchanged.
//
// === DEPENDENCIES ===
// participantRosterService (buildRoster), entityService (normalizeEntityName),
// ../db/connection (getDb), ../db/schema (entities, entityLinks, meetings,
// projects, settings), ../../shared/types/transcription (resolveLanguagePreset,
// DEFAULT_MIXED_PROMPTS).
//
// === LIMITATIONS ===
// - Topic-entity lookup is scoped to the meeting's own project; a meeting with
//   no project contributes no project/topic terms (mirrors
//   participantRosterService's "known" source).

import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { entities, entityLinks, meetings, projects, settings } from '../db/schema';
import { buildRoster } from './participantRosterService';
import { normalizeEntityName } from './entityService';
import { resolveLanguagePreset, DEFAULT_MIXED_PROMPTS } from '../../shared/types/transcription';
import { createLogger } from './logger';

const log = createLogger('WhisperPrompt');

type Db = ReturnType<typeof getDb>;

// whisper.cpp keeps at most ~224 prompt tokens; Czech/Slovak diacritics tokenize
// at roughly 2.5-3 chars/token (vs ~4 for plain ASCII), so this char budget is
// deliberately conservative — it leaves headroom for the rolling per-segment
// context transcriptionService appends after this glossary. Replaces the old
// bare `250` literal, which existed before the roster/project terms were added.
export const GLOSSARY_BUDGET_CHARS = 320;

/** Known project topic entities considered, before the char budget applies. */
const TOPIC_CAP = 12;

/** Topic entities linked to any meeting of this project, most recent first,
 *  deduped, capped at 12 — mirrors participantRosterService's known-person
 *  source (same recency preference when a project has more topics than fit). */
async function loadProjectTopicNames(db: Db, projectId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ name: entities.name, startedAt: meetings.startedAt })
      .from(entityLinks)
      .innerJoin(entities, eq(entityLinks.entityId, entities.id))
      .innerJoin(meetings, eq(entityLinks.meetingId, meetings.id))
      .where(and(eq(entities.kind, 'topic'), eq(meetings.projectId, projectId)))
      .orderBy(desc(meetings.startedAt));

    const seen = new Set<string>();
    const names: string[] = [];
    for (const row of rows) {
      const key = normalizeEntityName(row.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push(row.name);
      if (names.length >= TOPIC_CAP) break;
    }
    return names;
  } catch (err) {
    log.error('Topic-entity lookup failed for whisper prompt, project', projectId, ':', err);
    return [];
  }
}

/** The user's glossary setting for this exact preset code, or the built-in
 *  trilingual default for mixed presets when unset. Plain presets have no
 *  built-in default and resolve to '' when unset. */
async function loadPresetGlossary(db: Db, presetCode: string): Promise<string> {
  const { mixedCode } = resolveLanguagePreset(presetCode);
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, `transcription:initial-prompt:${presetCode}`));
  const stored = rows.length > 0 ? rows[0].value : '';
  if (stored) return stored;
  return mixedCode ? DEFAULT_MIXED_PROMPTS[mixedCode] : '';
}

/**
 * Build the whisper initial-prompt glossary for a session: roster names, then
 * the project name and its known topic entities, then the preset glossary —
 * capped at GLOSSARY_BUDGET_CHARS by dropping whole items from the end.
 * `presetCode` is the RAW transcription-language code as stored in settings
 * (e.g. 'cs', 'auto', 'cs-mix') — the same code the settings editor keys its
 * `transcription:initial-prompt:<code>` value by.
 */
export async function buildInitialPrompt(meetingId: string, presetCode: string): Promise<string> {
  const db = getDb();
  const items: string[] = [];

  // 1. Roster names first — one item per name.
  const roster = await buildRoster(meetingId);
  for (const entry of roster) items.push(entry.name);

  // 2. Project name + its known topic entities.
  const [meetingRow] = await db
    .select({ projectId: meetings.projectId })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);
  if (meetingRow?.projectId) {
    const [projectRow] = await db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, meetingRow.projectId))
      .limit(1);
    if (projectRow?.name) items.push(projectRow.name);
    items.push(...(await loadProjectTopicNames(db, meetingRow.projectId)));
  }

  // 3. The user's glossary for this preset (or the mixed default when unset).
  const glossaryText = await loadPresetGlossary(db, presetCode);
  if (glossaryText) items.push(glossaryText);

  // Drop whole items from the end (lowest priority first) until the joined
  // string fits the budget — never slice mid-item.
  while (items.length > 0 && items.join(', ').length > GLOSSARY_BUDGET_CHARS) {
    items.pop();
  }

  return items.join(', ');
}
