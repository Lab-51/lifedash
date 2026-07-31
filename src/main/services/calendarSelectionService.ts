// === FILE PURPOSE ===
// Per-provider "which calendars do we sync?" selection (CAL-UX.1). Stored as a PLAIN
// (unencrypted) JSON string[] under its own settings key — deliberately SEPARATE from
// the encrypted `calendar:{provider}:auth` blob, which persistCalendarConnection
// replaces wholesale, so a reconnect can never wipe the user's picks.
//
// === CONTRACT ===
// ABSENT key  ⇒ undefined ⇒ the provider's DEFAULT behavior (Google `primary`,
// Microsoft `/me/calendarView`). An empty array is NEVER written: "sync nothing" is
// not a state the UI can produce (the IPC schema rejects it).

import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { createLogger } from './logger';
import { calendarSelectionKey, type CalendarProvider } from '../../shared/types/calendar';

const log = createLogger('CalendarSelection');

/**
 * The calendar ids this provider should sync, or undefined for "provider default".
 * Any read/parse problem degrades to undefined (default behavior) — a corrupt value
 * must never break polling.
 */
export async function loadSelectedCalendarIds(provider: CalendarProvider): Promise<string[] | undefined> {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, calendarSelectionKey(provider)))
      .limit(1);
    if (rows.length === 0) return undefined;
    const parsed: unknown = JSON.parse(rows[0].value);
    if (!Array.isArray(parsed)) return undefined;
    const ids = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
    return ids.length > 0 ? ids : undefined;
  } catch (err) {
    log.warn(`Unreadable calendar selection for ${provider} — falling back to the provider default:`, err);
    return undefined;
  }
}

/** Persist the selection. Rejects an empty list (see the contract note above). */
export async function saveSelectedCalendarIds(provider: CalendarProvider, calendarIds: string[]): Promise<void> {
  if (calendarIds.length === 0) {
    throw new Error('Select at least one calendar');
  }
  const key = calendarSelectionKey(provider);
  const value = JSON.stringify(calendarIds);
  const db = getDb();
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
