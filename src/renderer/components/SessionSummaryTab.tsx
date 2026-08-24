// === FILE PURPOSE ===
// SessionSummaryTab (POST-FLOW.1, reshaped by its follow-up) — the Summary tab
// for a COMPLETED session. The brief used to sit in the ~380px right rail; the
// user's design call was "after the meeting ends the summary should pop as the
// first thing — having it on the side could be missed by users most of the time".
//
// POST-FLOW.1 first shipped this as a full-width hero stacked ABOVE the tab
// strip. That was the wrong shape and the user said so: it pushed Meeting /
// Board / Brain down the page, so making the brief prominent cost every OTHER
// surface its visibility. It is now a first-class TAB instead — peer to the
// others, selected by default when a finished session opens (see
// useSessionLoad in SessionWorkspace), which delivers "first thing" without
// burying anything. The tab exists for completed sessions only.
//
// The block itself is NOT new: SessionIntelligence moved here verbatim from
// SessionWorkspace (which still renders it in the rail for LIVE sessions) and
// keeps owning the provider gate, the auto-generate chain and the inline
// push-to-column picker. It renders the SAME BriefSection + ActionItemList as
// before — this task adds state AROUND that block, never a second brief
// renderer, so an AI-RESIL.1 failure card still surfaces exactly as today.
//
// Exactly one of three things sits above the brief:
//   (a) nothing — a brief (or a failure card) exists; BriefSection shows it.
//   (b) the "Writing your brief…" banner, NAMING the routed summarization
//       provider/model, so a multi-minute local run reads as working, not hung.
//   (c) nothing — no summarization route resolves, so nothing will ever arrive
//       (TWIN-LEARN.1 skips auto-generation silently when no model resolves) and
//       an in-flight banner would be a lie. SessionIntelligence's own
//       EmptyAIState is the surface, and there is NO spinner anywhere.
//
// Deliberately NOT a dialog / pop-up / focus-steal: the target user is in
// back-to-back calls, and generation can finish minutes later.
//
// === DEPENDENCIES ===
// react, lucide-react (Info, Loader2 — the icons this block and BriefSection
// already use), meetingStore, settingsStore, BriefSection, ActionItemList,
// EmptyAIState, toast, lib/summarizationRoute (which model is writing the brief).

import { useState, useEffect, useRef } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { useMeetingStore } from '../stores/meetingStore';
import { useSettingsStore } from '../stores/settingsStore';
import { toast } from '../hooks/useToast';
import BriefSection from './BriefSection';
import ActionItemList from './ActionItemList';
import EmptyAIState from './EmptyAIState';
import { resolveSummarizationRoute, type SummarizationRoute } from '../lib/summarizationRoute';
import type { ActionItem, Column, MeetingWithTranscript } from '../../shared/types';

/** Reactive `resolveSummarizationRoute` — re-resolves when Settings rewrites the
 *  routing JSON or a provider is enabled/disabled. */
function useSummarizationRoute(): SummarizationRoute | null {
  const providers = useSettingsStore((s) => s.providers);
  const taskModelsJson = useSettingsStore((s) => s.settings['ai.taskModels']);
  return resolveSummarizationRoute(providers, taskModelsJson);
}

/**
 * State (b). Prominent because the alternative — a 16px line in a side rail — is
 * indistinguishable from "hung" when the routed model is a local 14B that needs
 * minutes. Names the model for the same reason.
 */
function WritingBriefBanner({ route }: { route: SummarizationRoute }) {
  return (
    <div
      data-testid="brief-writing-banner"
      role="status"
      className="flex items-start gap-3 rounded-lg p-4 bg-amber-500/10 border border-amber-500/25 overflow-hidden"
    >
      <Loader2 size={18} className="text-amber-400 mt-0.5 shrink-0 animate-spin" />
      <div className="min-w-0 overflow-hidden break-words">
        <p className="text-sm font-medium text-amber-300">Writing your brief…</p>
        <p className="text-xs text-[var(--color-text-secondary)] mt-1">
          {route.model ? `${route.label} · ${route.model}` : route.label} is working on this session. Keep using the app
          — the brief appears here the moment it lands.
        </p>
      </div>
    </div>
  );
}

interface IntelligenceProps {
  meeting: MeetingWithTranscript;
  autoGenerate: boolean;
  onConvert: (item: ActionItem) => void;
}

// ---------------------------------------------------------------------------
// Intelligence block — provider-gated Brief + Action items, plus the auto-push
// column picker and the autoGenerate-on-open behavior carried over from the
// pre-V3.1 meeting detail dialog. Owns its own push-column state so both hosts
// (the Summary tab below for completed sessions, SessionWorkspace's rail for live ones)
// stay thin layouts. MOVED HERE VERBATIM from SessionWorkspace by POST-FLOW.1
// Task 2 — one block, two placements, never two brief renderers.
// ---------------------------------------------------------------------------
function IntelligenceBlock({ meeting, autoGenerate, onConvert }: IntelligenceProps) {
  const generateBrief = useMeetingStore((s) => s.generateBrief);
  const generateActionItems = useMeetingStore((s) => s.generateActionItems);
  const generatingBrief = useMeetingStore((s) => s.generatingBrief);
  const generatingActions = useMeetingStore((s) => s.generatingActions);
  const error = useMeetingStore((s) => s.error);
  const updateActionItemStatus = useMeetingStore((s) => s.updateActionItemStatus);
  const convertActionToCard = useMeetingStore((s) => s.convertActionToCard);
  const hasAnyEnabledProvider = useSettingsStore((s) => s.hasAnyEnabledProvider);

  const [pushColumns, setPushColumns] = useState<Column[]>([]);
  const [selectedPushColumnId, setSelectedPushColumnId] = useState<string | undefined>(undefined);
  const [pushing, setPushing] = useState(false);
  const autoBriefTriggered = useRef(false);
  const autoActionsTriggered = useRef(false);

  // Auto-generate brief when the page opens post-recording.
  useEffect(() => {
    if (!autoGenerate || autoBriefTriggered.current) return;
    if (meeting.status !== 'completed' || meeting.segments.length === 0) return;
    if (meeting.brief || generatingBrief || generatingActions) return;
    autoBriefTriggered.current = true;
    void generateBrief(meeting.id);
  }, [autoGenerate, meeting, generatingBrief, generatingActions, generateBrief]);

  // Auto-generate action items once the brief completes.
  useEffect(() => {
    if (!autoGenerate || autoActionsTriggered.current) return;
    if (!meeting.brief || meeting.actionItems.length > 0 || generatingActions) return;
    autoActionsTriggered.current = true;
    void generateActionItems(meeting.id);
  }, [autoGenerate, meeting, generatingActions, generateActionItems]);

  // Load columns for inline push when the meeting has a linked project.
  useEffect(() => {
    if (!meeting.projectId) {
      setPushColumns([]);
      setSelectedPushColumnId(undefined);
      return;
    }
    let cancelled = false;
    void window.electronAPI
      .getBoards(meeting.projectId)
      .then((boards) => {
        if (cancelled || boards.length === 0) {
          if (!cancelled) setPushColumns([]);
          return;
        }
        return window.electronAPI.getColumns(boards[0].id);
      })
      .then((cols) => {
        if (cancelled || !cols) return;
        const sorted = [...cols].sort((a, b) => a.position - b.position);
        setPushColumns(sorted);
        if (sorted.length > 0) setSelectedPushColumnId(sorted[0].id);
      });
    return () => {
      cancelled = true;
    };
  }, [meeting.projectId]);

  const handlePushToColumn = async (items: Array<{ id: string; text: string }>, columnId: string) => {
    setPushing(true);
    try {
      for (const item of items) {
        await convertActionToCard(item.id, columnId);
      }
      const colName = pushColumns.find((c) => c.id === columnId)?.name ?? 'column';
      toast(`Pushed ${items.length} item${items.length !== 1 ? 's' : ''} to ${colName}`, 'success');
    } catch {
      toast('Failed to push items', 'error');
    } finally {
      setPushing(false);
    }
  };

  if (!hasAnyEnabledProvider()) {
    return <EmptyAIState featureName="meeting intelligence" />;
  }

  return (
    <>
      {autoGenerate && error && !meeting.brief && !generatingBrief && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-start gap-2">
            <Info size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-300">
              Configure an AI provider in Settings to generate meeting intelligence.
            </p>
          </div>
        </div>
      )}

      <BriefSection
        meetingId={meeting.id}
        brief={meeting.brief}
        isCompleted={meeting.status === 'completed'}
        generatingBrief={generatingBrief}
        onGenerate={() => generateBrief(meeting.id)}
      />

      <ActionItemList
        meetingId={meeting.id}
        actionItems={meeting.actionItems}
        isCompleted={meeting.status === 'completed'}
        generatingActions={generatingActions}
        onGenerate={() => generateActionItems(meeting.id)}
        onUpdateStatus={updateActionItemStatus}
        onConvert={onConvert}
        meetingProjectId={meeting.projectId ?? undefined}
        columns={meeting.projectId ? pushColumns : undefined}
        selectedColumnId={selectedPushColumnId}
        onColumnChange={setSelectedPushColumnId}
        onPushToColumn={meeting.projectId ? handlePushToColumn : undefined}
        pushing={pushing}
      />
    </>
  );
}

/**
 * RAIL placement — live/processing sessions only. A completed session's block
 * moved into the Summary tab below, so this renders nothing for it.
 *
 * Both placements are SELF-GATING (the UpcomingEventBanner idiom: "renders
 * nothing when nothing qualifies, so the host mounts it always") rather than
 * wrapped in `{status === 'completed' && …}` at the call site. That is not
 * cosmetic: SessionWorkspace sits exactly on the complexity ceiling of 15 and is
 * NOT in eslint.config.mjs's COMPLEXITY_BASELINE, so two call-site conditionals
 * are a lint ERROR there.
 */
export function SessionIntelligence(props: IntelligenceProps) {
  return props.meeting.status === 'completed' ? null : <IntelligenceBlock {...props} />;
}

// ---------------------------------------------------------------------------
// SUMMARY TAB placement — completed sessions only (see SessionIntelligence
// above for why the gate lives here rather than at the call site).
// ---------------------------------------------------------------------------
export default function SessionSummaryTab(props: IntelligenceProps) {
  const { meeting } = props;
  const generatingBrief = useMeetingStore((s) => s.generatingBrief);
  const route = useSummarizationRoute();

  if (meeting.status !== 'completed') return null;

  // State (b) — and ONLY when a generation is genuinely in flight. `route !== null`
  // alone would also be true for an old session that was recorded before any AI was
  // configured and never got a brief: nothing is running there, and promising a
  // brief that will never arrive is the same defect as the no-AI infinite spinner
  // this must never show. `generatingBrief` stays true for the whole run — the
  // renderer's generateBrief IPC joins main's in-flight auto-run rather than
  // starting a second one (generateBriefShared).
  const writing = !meeting.brief && generatingBrief && route !== null;

  return (
    <div
      data-testid="session-summary-tab"
      role="tabpanel"
      id="panel-summary"
      aria-labelledby="tab-summary"
      className="p-6 space-y-4"
    >
      {writing && <WritingBriefBanner route={route} />}
      <IntelligenceBlock {...props} />
    </div>
  );
}
