// === Meeting intelligence types: action items, briefs, and analysis inputs ===

import type { Meeting, TranscriptSegment, MeetingBrief } from './meetings';

export type ActionItemStatus = 'pending' | 'approved' | 'dismissed' | 'converted';

export interface ActionItem {
  id: string;
  meetingId: string;
  cardId: string | null;
  description: string;
  status: ActionItemStatus;
  createdAt: string;
}

export interface GenerateBriefInput {
  meetingId: string;
}

export interface GenerateActionsInput {
  meetingId: string;
}

export interface UpdateActionItemInput {
  status: ActionItemStatus;
}

export interface ConvertActionToCardInput {
  actionItemId: string;
  columnId: string;
}

export interface ConvertActionToCardResult {
  actionItem: ActionItem;
  cardId: string;
}

/** Meeting with its transcript segments, brief, and action items (for detail view) */
export interface MeetingWithTranscript extends Meeting {
  segments: TranscriptSegment[];
  brief: MeetingBrief | null;
  actionItems: ActionItem[];
}
