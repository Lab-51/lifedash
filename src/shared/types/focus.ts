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

export interface FocusSessionWithCard extends FocusSession {
  cardTitle: string | null;
}

export interface FocusPeriodBucket {
  sessions: number;
  minutes: number;
}

export interface FocusPeriodStats {
  today: FocusPeriodBucket;
  thisWeek: FocusPeriodBucket;
  thisMonth: FocusPeriodBucket;
  allTime: FocusPeriodBucket;
  dailyData: FocusDailyData[];
}

export interface FocusTimeReportOptions {
  startDate: string;   // ISO date YYYY-MM-DD
  endDate: string;     // ISO date YYYY-MM-DD
  projectId?: string;  // optional project filter
}

export interface FocusSessionFull extends FocusSessionWithCard {
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
}

export interface FocusProjectTime {
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  sessions: number;
  minutes: number;
}

export interface FocusTimeReport {
  sessions: FocusSessionFull[];
  projectBreakdown: FocusProjectTime[];
  summary: {
    totalSessions: number;
    totalMinutes: number;
    avgSessionMinutes: number;
    longestSessionMinutes: number;
    activeDays: number;
  };
  dailyData: FocusDailyData[];
}
