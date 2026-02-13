// === Notification preference and digest types ===

export interface NotificationPreferences {
  enabled: boolean;                // Master toggle
  dueDateReminders: boolean;       // Notify when cards are due within 24h
  dailyDigest: boolean;            // Morning summary of tasks/meetings
  dailyDigestHour: number;         // Hour (0-23) to send daily digest (default: 9)
  recordingReminders: boolean;     // Remind to record upcoming meetings
}

export interface DailyDigestData {
  dueToday: Array<{ title: string; projectName: string }>;
  overdue: Array<{ title: string; projectName: string; dueDate: string }>;
  recentMeetings: Array<{ title: string; date: string }>;
}
