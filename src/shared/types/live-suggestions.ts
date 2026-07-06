// === Live Suggestion types — proactive in-meeting proposals (LIVE.2) ===
// The proactive-triage loop watches the live transcript during a recording and
// proposes action items / decisions / questions the user can one-tap accept
// later. Its own table (not action_items) because live proposals have a distinct
// lifecycle (proposed-during vs extracted-after) — see src/main/db/schema/live-suggestions.ts.

export type LiveSuggestionType = 'action_item' | 'decision' | 'question' | 'project';
export type LiveSuggestionStatus = 'proposed' | 'accepted' | 'dismissed';

export interface LiveSuggestion {
  id: string;
  meetingId: string;
  type: LiveSuggestionType;
  title: string;
  description: string | null;
  status: LiveSuggestionStatus;
  /** Set when a 'proposed' suggestion is accepted into a card (Task 2). */
  acceptedCardId: string | null;
  /** Set when a 'project' proposal is accepted — the project it created + linked (LIVE.3). */
  acceptedProjectId: string | null;
  createdAt: string;
  updatedAt: string;
}
