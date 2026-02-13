// === Speaker diarization types ===

export interface DiarizationWord {
  text: string;
  startMs: number;
  endMs: number;
  speaker: string;  // Normalized: "Speaker 1", "Speaker 2", etc.
}

export interface DiarizationResult {
  words: DiarizationWord[];
  speakers: string[];        // Unique speaker labels found
  durationMs: number;        // Total audio duration
}
