// === FILE PURPOSE ===
// Ambient feed of proactive-triage proposals (LIVE.2 Task 5) — newest-first chips
// for the action items / decisions / questions the triage loop (Task 1) proposes
// while recording. One-tap Accept (creates a card for action_item via the Task 2
// accept IPC; decision/question sets status only, no card) or Dismiss. Mounts
// above LiveAssistantChat in LiveModeOverlay's right column.
//
// NOT modal: chips never steal focus or block interaction with the transcript or
// chat beside them (session decision — the user is in a meeting). Accept on an
// action_item shows a brief "Added to {project} Inbox" confirmation banner that
// auto-expires. Accept on a 'project' chip (LIVE.3) created + linked a project in
// the accept IPC, so here we confirm it and refresh the project/meeting stores so
// the overlay header flips to the new project without a remount.
//
// The chip/confirmation rendering itself lives in `LiveProposalChips` (shared with
// the post-meeting `meeting-detail/LiveProposalsSection`, Task 6) — this component
// owns the store subscription, confirmation-banner lifecycle, and the accept
// side-effect (project-name resolution for the banner text).
//
// === DEPENDENCIES ===
// liveSuggestionsStore, recordingStore, meetingStore, projectStore, LiveProposalChips

import { useEffect, useState } from 'react';
import { useLiveSuggestionsStore } from '../stores/liveSuggestionsStore';
import { useRecordingStore } from '../stores/recordingStore';
import { useMeetingStore } from '../stores/meetingStore';
import { useProjectStore } from '../stores/projectStore';
import LiveProposalChips, { type ProposalConfirmation } from './LiveProposalChips';
import type { LiveSuggestion } from '../../shared/types';

/** How long an "Added to ... Inbox" confirmation banner stays visible before auto-expiring. */
const CONFIRMATION_MS = 4000;

export default function LiveProposalsFeed() {
  // Subscribe to the raw array (stable reference unless the store actually
  // updates it) and derive the pending list in render. A `.filter(...)` selector
  // must NOT be passed directly to the store hook: it allocates a new array on
  // every call, which trips useSyncExternalStore's "getSnapshot should be
  // cached" infinite-loop guard.
  const suggestions = useLiveSuggestionsStore((s) => s.suggestions);
  const proposals = suggestions.filter((s) => s.status === 'proposed');
  const accept = useLiveSuggestionsStore((s) => s.accept);
  const dismiss = useLiveSuggestionsStore((s) => s.dismiss);
  const meetingId = useRecordingStore((s) => s.meetingId);
  const meetings = useMeetingStore((s) => s.meetings);
  const projects = useProjectStore((s) => s.projects);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const loadMeetings = useMeetingStore((s) => s.loadMeetings);

  const [confirmations, setConfirmations] = useState<ProposalConfirmation[]>([]);

  // Auto-expire confirmation banners.
  useEffect(() => {
    if (confirmations.length === 0) return;
    const timers = confirmations.map((c) =>
      setTimeout(() => {
        setConfirmations((prev) => prev.filter((x) => x.id !== c.id));
      }, CONFIRMATION_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [confirmations]);

  async function handleAccept(suggestion: LiveSuggestion): Promise<void> {
    const updated = await accept(suggestion.id);
    if (!updated) return; // rolled back on IPC error — chip stays for the user to retry
    if (updated.type === 'action_item') {
      const meeting = meetingId ? meetings.find((m) => m.id === meetingId) : undefined;
      const project = meeting?.projectId ? projects.find((p) => p.id === meeting.projectId) : undefined;
      const projectName = project?.name ?? 'Unassigned';
      setConfirmations((prev) => [...prev, { id: suggestion.id, text: `Added to ${projectName} Inbox` }]);
    } else if (updated.type === 'project') {
      // Accept created + linked the project. Refresh both stores so LiveModeOverlay's
      // header flips from unlinked to the new project name without a remount, and the
      // agent's board tools pick up the project on the next message.
      setConfirmations((prev) => [
        ...prev,
        { id: suggestion.id, text: `Created project "${updated.title}" — meeting linked` },
      ]);
      void loadProjects();
      void loadMeetings();
    }
  }

  const hasContent = proposals.length > 0 || confirmations.length > 0;

  if (!hasContent) {
    return (
      <div data-testid="live-proposals-feed" className="px-4 py-3">
        <p className="text-xs text-[var(--color-text-muted)] text-center">Listening for action items…</p>
      </div>
    );
  }

  return (
    <LiveProposalChips
      proposals={proposals}
      confirmations={confirmations}
      onAccept={(suggestion) => void handleAccept(suggestion)}
      onDismiss={(id) => void dismiss(id)}
    />
  );
}
