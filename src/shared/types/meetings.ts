// === Meeting, transcript, template, and recording types ===

// TYPE-ONLY import on purpose: ./briefStructure imports zod, and this module IS
// re-exported from the types barrel the renderer bundles. `import type` is erased
// at compile time, so the structure's shape reaches the renderer while zod does
// not — which is why briefStructure.ts stays out of the barrel (BRIEF-QUAL.1).
import type { MeetingStructure } from './briefStructure';

export type MeetingStatus = 'recording' | 'processing' | 'completed';

export type MeetingTemplateType = 'none' | 'standup' | 'retro' | 'planning' | 'brainstorm' | 'one_on_one';

export interface MeetingTemplate {
  type: MeetingTemplateType;
  name: string;
  description: string;
  icon: string; // Lucide icon name
  agenda: string[]; // Suggested agenda items
  aiPromptHint: string; // Injected into AI summarization prompt
}

export const MEETING_TEMPLATES: MeetingTemplate[] = [
  {
    type: 'none',
    name: 'General',
    description: 'No specific template — general meeting',
    icon: 'MessageSquare',
    agenda: [],
    aiPromptHint: '',
  },
  {
    type: 'standup',
    name: 'Daily Standup',
    description: 'Quick status update — what was done, what is planned, any blockers',
    icon: 'Users',
    agenda: ['What I did yesterday', 'What I plan to do today', 'Blockers or concerns'],
    aiPromptHint:
      'This is a daily standup meeting. Focus on: (1) work completed since last standup, (2) planned work for today, (3) blockers or impediments. Keep the summary structured around these three areas.',
  },
  {
    type: 'retro',
    name: 'Retrospective',
    description: 'Team reflection — what went well, what to improve, action items',
    icon: 'RotateCcw',
    agenda: ['What went well', 'What could be improved', 'Action items for next sprint'],
    aiPromptHint:
      'This is a retrospective meeting. Organize the summary into: (1) What went well — positive outcomes and successes, (2) What could be improved — pain points and challenges, (3) Action items — concrete steps the team agreed to take.',
  },
  {
    type: 'planning',
    name: 'Sprint Planning',
    description: 'Plan upcoming work — priorities, capacity, commitments',
    icon: 'CalendarCheck',
    agenda: [
      'Sprint goal',
      'Priority items for the sprint',
      'Capacity and availability',
      'Commitments and assignments',
    ],
    aiPromptHint:
      'This is a sprint/iteration planning meeting. Focus on: (1) the sprint goal or objectives, (2) which items were prioritized, (3) capacity considerations, (4) who committed to what work. Track any estimated effort or story points mentioned.',
  },
  {
    type: 'brainstorm',
    name: 'Brainstorming',
    description: 'Creative ideation session — explore ideas freely',
    icon: 'Lightbulb',
    agenda: ['Problem statement or opportunity', 'Idea generation', 'Discussion and evaluation', 'Next steps'],
    aiPromptHint:
      'This is a brainstorming session. Capture all ideas discussed, even partial ones. Group related ideas together. Note which ideas received the most interest or support. Highlight any novel or unconventional suggestions.',
  },
  {
    type: 'one_on_one',
    name: '1-on-1',
    description: 'One-on-one meeting — feedback, goals, personal development',
    icon: 'UserCheck',
    agenda: [
      'Check-in and wellbeing',
      'Progress on goals',
      'Feedback (both directions)',
      'Development and growth',
      'Action items',
    ],
    aiPromptHint:
      'This is a 1-on-1 meeting. Focus on: (1) personal updates and wellbeing, (2) progress on previously set goals, (3) feedback exchanged, (4) career development topics, (5) agreed action items. Be sensitive with personal topics — summarize without including private details.',
  },
];

export interface Meeting {
  id: string;
  projectId: string | null;
  title: string;
  template: MeetingTemplateType;
  startedAt: string; // ISO timestamp
  endedAt: string | null;
  audioPath: string | null;
  status: MeetingStatus;
  prepBriefing: string | null;
  transcriptionLanguage: string | null;
  /**
   * True when auto-detect routed this meeting to the system Unassigned project
   * (i.e. classifier confidence was below threshold). UI uses this to surface
   * a "set project?" prompt. Manually picking a project should set this back
   * to false (handled in Task 4).
   */
  unassignedPending: boolean;
  /** Prefixed calendar event id this session was recorded for (Phase G), if any. */
  calendarEventId?: string | null;
  /** Prefixed calendar series id, if the linked event belongs to a series (Phase G). */
  calendarSeriesId?: string | null;
  /** Display names as the user typed them, in entry order (BRIEF-QUAL.1). Null
   *  when never set — participantRosterService is the merge point that also
   *  brings in calendar attendees and known project people. */
  participants: string[] | null;
  /** Speaker LABEL -> display NAME (SPEAKER.1). The transcript rows keep their
   *  raw labels; this map is applied at render and at prompt time, so a wrong
   *  resolution is one click to undo. Optional so every pre-SPEAKER.1 fixture
   *  and caller stays valid; absent and null both mean "no names". */
  speakerNames?: SpeakerNameMap | null;
  createdAt: string;
}

/** Speaker label (`Me`, `Speaker 2`) -> the display name for that speaker. */
export type SpeakerNameMap = Record<string, string>;

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  content: string;
  startTime: number; // milliseconds from recording start
  endTime: number;
  speaker: string | null; // null = not diarized
  createdAt: string;
}

export interface MeetingBrief {
  id: string;
  meetingId: string;
  summary: string;
  /** The validated extraction the brief was WRITTEN from (BRIEF-QUAL.1). Null on
   *  a failure card, and on every brief generated before this phase — readers
   *  must treat it as optional context, never as a precondition. */
  structure: MeetingStructure | null;
  createdAt: string;
}

export interface CreateMeetingInput {
  title: string;
  projectId?: string;
  template?: MeetingTemplateType;
  prepBriefing?: string;
  transcriptionLanguage?: string;
  /** Optional calendar linkage (Phase G) — prefixed ids, persisted as-is. */
  calendarEventId?: string;
  calendarSeriesId?: string;
  /** Display names as the user typed them (BRIEF-QUAL.1). */
  participants?: string[];
}

export interface UpdateMeetingInput {
  title?: string;
  projectId?: string | null;
  endedAt?: string;
  audioPath?: string;
  status?: MeetingStatus;
  unassignedPending?: boolean;
}

export interface TranscriptSearchResult {
  segmentId: string;
  meetingId: string;
  meetingTitle: string;
  content: string;
  startTime: number;
  speaker: string | null;
}

export interface MeetingPrepData {
  projectName: string;
  lastMeetingTitle: string | null;
  lastMeetingDate: string | null;
  cardChanges: {
    created: { title: string; column: string }[];
    completed: { title: string }[];
    moved: { title: string; from: string; to: string }[];
  };
  pendingActions: { description: string; meetingTitle: string }[];
  highPriorityCards: { title: string; column: string; dueDate: string | null }[];
  aiBriefing: string;
}

/**
 * One audio-callback's worth of 16 kHz Int16 PCM, split by capture channel
 * (SPEAKER.1). All three views cover the SAME frames — the merger feeds a single
 * 2-channel ScriptProcessor, so `mixed[i] === mic[i] + system[i]` sample-wise.
 *
 * `mixed` is the mono sum and is the ONLY stream written to the WAV file on
 * disk, so that file stays byte-identical to pre-SPEAKER.1 recordings.
 * `mic` is null when the microphone is off for this recording or its track has
 * ended (the renderer clears it while it tries to re-acquire the device).
 */
export interface AudioChunkPayload {
  mixed: ArrayBuffer;
  mic: ArrayBuffer | null;
  system: ArrayBuffer;
}

/**
 * The main-process view of {@link AudioChunkPayload} — the same three channels
 * once the preload bridge has wrapped them as Node buffers. Type-only here so
 * the IPC boundary, audioProcessor and transcriptionService share one shape.
 */
export interface AudioChunkBuffers {
  mixed: Buffer;
  mic: Buffer | null;
  system: Buffer;
}

/** Recording state pushed from main to renderer via events */
export interface RecordingState {
  isRecording: boolean;
  meetingId: string | null;
  elapsed: number; // seconds since recording started
  lastTranscript: string; // most recent transcript text
}

/** Granular progress during the stop/processing flow */
export interface TranscriptionProgress {
  phase: 'saving-audio' | 'transcribing' | 'finalizing';
  currentSegment: number; // 1-based
  totalSegments: number;
  percentComplete: number; // 0-100
  backendUsed: string; // 'metal' | 'vulkan' | 'cuda' | 'cpu' | 'deepgram' | 'assemblyai'
}

// ---------------------------------------------------------------------------
// Deletion (MEET-DEL.1) — delete-impact preview + transactional delete options
// ---------------------------------------------------------------------------

/** Options for `meetings:delete`. Omitted (or `keepLearnedFacts` false/absent)
 *  takes the default path — forgetting is the default; keeping is the explicit,
 *  visible exception (see DECISIONS.md and src/main/db/schema/twin.ts). */
export interface DeleteMeetingOptions {
  keepLearnedFacts?: boolean;
}

/** Read-only preview of what deleting a meeting would affect, returned by
 *  `meetings:get-delete-impact` so a confirm UI can show the user what's about
 *  to be lost before they commit to the default (forget) or keep path. Has no
 *  side effects. */
export interface MeetingDeleteImpact {
  /** Learned facts sourced from this meeting — active + forgotten combined,
   *  since deletion expunges both. */
  factCount: number;
  /** The first 8 fact labels (by creation order), resolved via
   *  shared/twin/factLabel.ts's labelFor() — never a raw null. */
  factLabels: string[];
  /** Size in bytes of the recording at `audioPath`. 0 if `audioPath` is null or
   *  the file is missing on disk. */
  audioBytes: number;
  hasBrief: boolean;
  transcriptSegmentCount: number;
}
