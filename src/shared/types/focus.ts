// === FILE PURPOSE ===
// Shared types for focus mode sessions. Used by main, preload, and renderer.
// Level, achievement, and stats types have moved to gamification.ts.

export interface FocusSession {
  id: string;
  cardId: string | null;
  durationMinutes: number;
  note: string | null;
  completedAt: string;
}

export interface FocusDailyData {
  date: string;
  sessions: number;
  minutes: number;
}
