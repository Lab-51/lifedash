// === Meeting analytics and speaker statistics types ===

export interface SpeakerStats {
  speaker: string;           // "Speaker 1", "Speaker 2", or "Unknown"
  segmentCount: number;      // Number of transcript segments
  wordCount: number;         // Total words spoken
  talkTimeMs: number;        // Total talk time in milliseconds
  talkTimePercent: number;   // Percentage of total talk time (0-100)
}

export interface MeetingAnalytics {
  meetingId: string;
  durationMs: number;              // Total meeting duration (endedAt - startedAt)
  totalSegments: number;           // Number of transcript segments
  totalWords: number;              // Total word count across all segments
  hasDiarization: boolean;         // Whether speaker labels are available
  speakers: SpeakerStats[];        // Per-speaker breakdown (empty if no diarization)
  actionItemCounts: {
    total: number;
    pending: number;
    approved: number;
    dismissed: number;
    converted: number;
  };
  wordsPerMinute: number;          // Average speaking pace
}
