// === FILE PURPOSE ===
// In-brain Inspector — SESSION subview. Renders the rich intelligence stack
// SessionWorkspace's right rail composes, by REUSING the existing sections
// (Brief / ActionItems / Transcript / LiveProposals / LiveAssistant) — no rebuilt
// detail views. The meeting is fetched via the `getMeeting` IPC into LOCAL state
// (NOT the shared meetingStore.selectedMeeting, which the host SessionWorkspace
// page owns — clobbering it would corrupt the underlying page), and brief/action-
// item generation runs through the real meetingStore actions + a local re-fetch
// so it stays functional, never faked.
//
// MeetingAnalyticsSection is deliberately NOT reused here: it reads/writes a
// single non-keyed global meetingStore.analytics slot and exposes an "Identify
// Speakers" (diarize) action, both of which would cross-contaminate the host
// page's analytics / selectedMeeting when the inspector shows a DIFFERENT meeting.
// The header already surfaces duration/status; deep analytics stay on the full page.
//
// === DEPENDENCIES ===
// react, meetingStore (generate/convert actions), projectStore (project name),
// getMeeting IPC, Brief/ActionItem/Transcript/LiveProposals/LiveAssistant
// sections, ConvertActionModal

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMeetingStore } from '../../stores/meetingStore';
import { useProjectStore } from '../../stores/projectStore';
import BriefSection from '../BriefSection';
import ActionItemList from '../ActionItemList';
import ConvertActionModal from '../ConvertActionModal';
import TranscriptSection from '../meeting-detail/TranscriptSection';
import LiveProposalsSection from '../meeting-detail/LiveProposalsSection';
import LiveAssistantSection from '../meeting-detail/LiveAssistantSection';
import type { ActionItem, MeetingWithTranscript } from '../../../shared/types';

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

export default function SessionInspector({ meetingId }: { meetingId: string }) {
  const [meeting, setMeeting] = useState<MeetingWithTranscript | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [prevMeetingId, setPrevMeetingId] = useState(meetingId);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [converting, setConverting] = useState<ActionItem | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  // Tracks the meeting currently being inspected so an out-of-order async result
  // (a reload resolving after the user drilled to a different session) can be
  // dropped instead of writing stale data. Kept current via an effect (never
  // written during render).
  const currentIdRef = useRef(meetingId);
  useEffect(() => {
    currentIdRef.current = meetingId;
  }, [meetingId]);

  // A different session was drilled into: reset to loading DURING RENDER (adjust-
  // state-on-change) so the load effect never has to call setState synchronously.
  if (meetingId !== prevMeetingId) {
    setPrevMeetingId(meetingId);
    setMeeting(null);
    setLoadState('loading');
  }

  const projects = useProjectStore((s) => s.projects);
  const generatingBrief = useMeetingStore((s) => s.generatingBrief);
  const generatingActions = useMeetingStore((s) => s.generatingActions);
  const generateBrief = useMeetingStore((s) => s.generateBrief);
  const generateActionItems = useMeetingStore((s) => s.generateActionItems);
  const updateActionItemStatus = useMeetingStore((s) => s.updateActionItemStatus);
  const convertActionToCard = useMeetingStore((s) => s.convertActionToCard);

  // Post-action refresh (after brief/action-item generation or convert) — fetches
  // into LOCAL state so the host page's meetingStore.selectedMeeting is never
  // disturbed. Called from event handlers only, never an effect.
  const reload = useCallback(async () => {
    try {
      const loaded = await window.electronAPI.getMeeting(meetingId);
      if (currentIdRef.current !== meetingId) return; // drilled away — drop stale result
      setMeeting(loaded);
      setLoadState(loaded ? 'ready' : 'missing');
    } catch {
      if (currentIdRef.current === meetingId) setLoadState('error');
    }
  }, [meetingId]);

  // Initial load — setState lives inside the async .then/.catch (the same shape
  // as SessionWorkspace's own load effect), so there's no synchronous
  // setState-in-effect. Cancelled-guarded against an out-of-order resolution.
  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .getMeeting(meetingId)
      .then((loaded) => {
        if (cancelled) return;
        setMeeting(loaded);
        setLoadState(loaded ? 'ready' : 'missing');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const handleCopy = (field: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  if (loadState === 'loading') {
    return (
      <div className="text-sm text-[var(--color-text-muted)] py-6 text-center animate-pulse">Loading session…</div>
    );
  }
  if (loadState === 'error' || loadState === 'missing' || !meeting) {
    return (
      <div className="text-sm text-[var(--color-text-secondary)] py-6 text-center">
        {loadState === 'missing' ? 'This session is no longer available.' : 'Could not load this session.'}
      </div>
    );
  }

  const isCompleted = meeting.status === 'completed';
  const projectName = meeting.projectId ? projects.find((p) => p.id === meeting.projectId)?.name : undefined;

  return (
    <div data-testid="brain-inspector-session" className="flex flex-col gap-5">
      <BriefSection
        meetingId={meeting.id}
        brief={meeting.brief}
        isCompleted={isCompleted}
        generatingBrief={generatingBrief}
        onGenerate={async () => {
          await generateBrief(meeting.id);
          await reload();
        }}
      />

      <ActionItemList
        meetingId={meeting.id}
        actionItems={meeting.actionItems}
        isCompleted={isCompleted}
        generatingActions={generatingActions}
        onGenerate={async () => {
          await generateActionItems(meeting.id);
          await reload();
        }}
        onUpdateStatus={async (id, status) => {
          await updateActionItemStatus(id, status);
          await reload();
        }}
        onConvert={setConverting}
      />

      {isCompleted && <LiveProposalsSection meetingId={meeting.id} projectName={projectName ?? 'Unassigned'} />}
      {isCompleted && <LiveAssistantSection meetingId={meeting.id} />}

      <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-[var(--color-border)]">
        <TranscriptSection
          meeting={meeting}
          transcriptEndRef={transcriptEndRef}
          onCopySummary={() => meeting.brief && handleCopy('summary', meeting.brief.summary)}
          onCopyActions={() => handleCopy('actions', meeting.actionItems.map((i) => `- ${i.description}`).join('\n'))}
          copiedField={copiedField}
          onCopy={handleCopy}
        />
      </div>

      {converting && (
        <ConvertActionModal
          actionItem={converting}
          preselectedProjectId={meeting.projectId ?? undefined}
          preselectedProjectName={projectName}
          onConvert={convertActionToCard}
          onClose={() => {
            setConverting(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}
