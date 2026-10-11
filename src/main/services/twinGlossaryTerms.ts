// === FILE PURPOSE ===
// The twin profile's people names and vocabulary terms, flattened into plain
// spellings for the two stages that benefit from knowing them: the whisper
// glossary (whisperPromptService) and the extraction prompt's Known-names block
// (briefExtractionService). TWIN-LOOP Task 4.
//
// === LIMITATIONS ===
// - Names and terms only: never a person's role/org, never a term's meaning.
// - Any lookup failure (no DB, bad row) degrades to "no twin terms" — it must
//   never throw into transcription or extraction.

import { getProfile } from './twinProfileService';
import { createLogger } from './logger';

const log = createLogger('TwinGlossaryTerms');

/** People names first (spelling matters most for them), then vocabulary terms;
 *  trimmed, empties dropped, deduped case-insensitively keeping the first spelling. */
export async function loadTwinGlossaryTerms(): Promise<string[]> {
  try {
    const profile = await getProfile();
    if (!profile) return [];
    const seen = new Set<string>();
    const terms: string[] = [];
    for (const raw of [...profile.people.map((p) => p.name), ...profile.vocabulary.map((v) => v.term)]) {
      const term = typeof raw === 'string' ? raw.trim() : '';
      const key = term.toLowerCase();
      if (!term || seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
    }
    return terms;
  } catch (err) {
    log.error('Twin profile lookup failed for glossary terms:', err);
    return [];
  }
}
