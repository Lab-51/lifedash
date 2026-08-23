// === FILE PURPOSE ===
// Main-side read of the `brief:language` setting (BRIEF-QUAL.1 Task 1). A tiny,
// single-purpose helper so the brief pipeline can resolve the user's language
// preference without every consumer re-writing the same settings-table query.
// Deliberately kept OUT of meetingIntelligenceService.ts / briefExtractionService.ts
// (Task 2/3 own those files this phase).

// === DEPENDENCIES ===
// drizzle-orm, ../db/connection (getDb), ../db/schema (settings),
// ../../shared/brief/briefLanguage (the setting key + default).

// === LIMITATIONS ===
// - Read-only: writing the value goes through the generic settings:set IPC
//   handler (src/main/ipc/settings.ts), same as every other settings key.

import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { BRIEF_LANGUAGE_SETTING_KEY, DEFAULT_BRIEF_LANGUAGE_SETTING } from '../../shared/brief/briefLanguage';

/** The current `brief:language` setting value, or the default ('en') when unset. */
export async function readBriefLanguageSetting(): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, BRIEF_LANGUAGE_SETTING_KEY))
    .limit(1);
  return row?.value ?? DEFAULT_BRIEF_LANGUAGE_SETTING;
}
