// === FILE PURPOSE ===
// Shared types for focus mode sessions. Used by main, preload, and renderer.
// Level, achievement, and stats types have moved to gamification.ts.

export interface FocusSession {
  id: string;
  cardId: string | null;
  durationMinutes: number;
  billable: boolean;
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
  startDate: string; // ISO date YYYY-MM-DD
  endDate: string; // ISO date YYYY-MM-DD
  projectId?: string; // optional project filter
  billableOnly?: boolean; // true = only billable, false = only non-billable, undefined = all
}

export interface FocusSessionFull extends FocusSessionWithCard {
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  hourlyRate: number | null;
}

export interface FocusProjectTime {
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  sessions: number;
  minutes: number;
  cost: number | null;
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
    billableMinutes: number;
    billableCost: number;
  };
  dailyData: FocusDailyData[];
}
