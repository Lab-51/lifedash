// === Meeting, transcript, template, and recording types ===

export type MeetingStatus = 'recording' | 'processing' | 'completed';

export type MeetingTemplateType = 'none' | 'standup' | 'retro' | 'planning' | 'brainstorm' | 'one_on_one';

export interface MeetingTemplate {
  type: MeetingTemplateType;
  name: string;
  description: string;
  icon: string;           // Lucide icon name
  agenda: string[];       // Suggested agenda items
  aiPromptHint: string;   // Injected into AI summarization prompt
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
    aiPromptHint: 'This is a daily standup meeting. Focus on: (1) work completed since last standup, (2) planned work for today, (3) blockers or impediments. Keep the summary structured around these three areas.',
  },
  {
    type: 'retro',
    name: 'Retrospective',
    description: 'Team reflection — what went well, what to improve, action items',
    icon: 'RotateCcw',
    agenda: ['What went well', 'What could be improved', 'Action items for next sprint'],
    aiPromptHint: 'This is a retrospective meeting. Organize the summary into: (1) What went well — positive outcomes and successes, (2) What could be improved — pain points and challenges, (3) Action items — concrete steps the team agreed to take.',
  },
  {
    type: 'planning',
    name: 'Sprint Planning',
    description: 'Plan upcoming work — priorities, capacity, commitments',
    icon: 'CalendarCheck',
    agenda: ['Sprint goal', 'Priority items for the sprint', 'Capacity and availability', 'Commitments and assignments'],
    aiPromptHint: 'This is a sprint/iteration planning meeting. Focus on: (1) the sprint goal or objectives, (2) which items were prioritized, (3) capacity considerations, (4) who committed to what work. Track any estimated effort or story points mentioned.',
  },
  {
    type: 'brainstorm',
    name: 'Brainstorming',
    description: 'Creative ideation session — explore ideas freely',
    icon: 'Lightbulb',
    agenda: ['Problem statement or opportunity', 'Idea generation', 'Discussion and evaluation', 'Next steps'],
    aiPromptHint: 'This is a brainstorming session. Capture all ideas discussed, even partial ones. Group related ideas together. Note which ideas received the most interest or support. Highlight any novel or unconventional suggestions.',
  },
  {
    type: 'one_on_one',
    name: '1-on-1',
    description: 'One-on-one meeting — feedback, goals, personal development',
    icon: 'UserCheck',
    agenda: ['Check-in and wellbeing', 'Progress on goals', 'Feedback (both directions)', 'Development and growth', 'Action items'],
    aiPromptHint: 'This is a 1-on-1 meeting. Focus on: (1) personal updates and wellbeing, (2) progress on previously set goals, (3) feedback exchanged, (4) career development topics, (5) agreed action items. Be sensitive with personal topics — summarize without including private details.',
  },
];

export interface Meeting {
  id: string;
  projectId: string | null;
  title: string;
  template: MeetingTemplateType;
  startedAt: string;    // ISO timestamp
  endedAt: string | null;
  audioPath: string | null;
  status: MeetingStatus;
  prepBriefing: string | null;
  transcriptionLanguage: string | null;
  createdAt: string;
}

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  content: string;
  startTime: number;    // milliseconds from recording start
  endTime: number;
  speaker: string | null;  // null = not diarized
  createdAt: string;
}

export interface MeetingBrief {
  id: string;
  meetingId: string;
  summary: string;
  createdAt: string;
}

export interface CreateMeetingInput {
  title: string;
  projectId?: string;
  template?: MeetingTemplateType;
  prepBriefing?: string;
  transcriptionLanguage?: string;
}

export interface UpdateMeetingInput {
  title?: string;
  projectId?: string | null;
  endedAt?: string;
  audioPath?: string;
  status?: MeetingStatus;
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

/** Recording state pushed from main to renderer via events */
export interface RecordingState {
  isRecording: boolean;
  meetingId: string | null;
  elapsed: number;           // seconds since recording started
  lastTranscript: string;    // most recent transcript text
}
