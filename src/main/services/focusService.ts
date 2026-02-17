// === FILE PURPOSE ===
// Service layer for focus mode sessions.
// Handles session persistence and daily data queries.
// Achievement/level logic has moved to gamificationService.ts.

import { gte, sql, desc } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { focusSessions } from '../db/schema';
import { FocusSession, FocusDailyData } from '../../shared/types/focus';

export async function saveSession(input: {
  cardId?: string;
  durationMinutes: number;
  note?: string;
}): Promise<FocusSession> {
  const db = getDb();
  const [row] = await db.insert(focusSessions).values({
    cardId: input.cardId || null,
    durationMinutes: input.durationMinutes,
    note: input.note || null,
  }).returning();

  return {
    id: row.id,
    cardId: row.cardId,
    durationMinutes: row.durationMinutes,
    note: row.note,
    completedAt: row.completedAt.toISOString(),
  };
}

export async function getDailyData(days: number = 30): Promise<FocusDailyData[]> {
  const db = getDb();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      date: sql<string>`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`,
      sessions: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}), 0)::int`,
    })
    .from(focusSessions)
    .where(gte(focusSessions.completedAt, startDate))
    .groupBy(sql`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`);

  // Fill gaps with zero-value entries
  const result: FocusDailyData[] = [];
  const dataMap = new Map(rows.map(r => [r.date, r]));

  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = formatDateStr(d);
    const data = dataMap.get(dateStr);
    result.push({
      date: dateStr,
      sessions: data?.sessions || 0,
      minutes: data?.minutes || 0,
    });
  }

  return result;
}

function formatDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
