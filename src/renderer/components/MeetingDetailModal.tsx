// === FILE PURPOSE ===
// Meeting detail modal — orchestrator that composes section components.
// Manages modal shell, state, data fetching, and auto-generation logic.
//
// === DEPENDENCIES ===
// react, meetingStore, section components from ./meeting-detail/

import { useState, useEffect, useRef, useCallback } from 'react';
import FocusTrap from './FocusTrap';
import { Info } from 'lucide-react';
import { useMeetingStore } from '../stores/meetingStore';
import { useProjectStore } from '../stores/projectStore';
import { useSettingsStore } from '../stores/settingsStore';
import { toast } from '../hooks/useToast';
import BriefSection from './BriefSection';
import ActionItemList from './ActionItemList';
import ConvertActionModal from './ConvertActionModal';
import MeetingAnalyticsSection from './MeetingAnalyticsSection';
import EmptyAIState from './EmptyAIState';
import type { ActionItem, Column } from '../../shared/types';
import {
  MeetingHeader,
  MeetingPrepSection,
  TranscriptSection,
  DeleteMeetingButton,
  formatMeetingAsMarkdown,
  slugify,
} from './meeting-detail';

interface MeetingDetailModalProps {
  onClose: () => void;
  /** When true, auto-generate brief + action items on open (post-recording) */
  autoGenerate?: boolean;
  initialTranscriptSearch?: string;
}

export default function MeetingDetailModal({
  onClose,
  autoGenerate = false,
  initialTranscriptSearch,
}: MeetingDetailModalProps) {
  const selectedMeeting = useMeetingStore((s) => s.selectedMeeting);
  const updateMeeting = useMeetingStore((s) => s.updateMeeting);
  const deleteMeeting = useMeetingStore((s) => s.deleteMeeting);
  const clearSelectedMeeting = useMeetingStore((s) => s.clearSelectedMeeting);
  const generateBrief = useMeetingStore((s) => s.generateBrief);
  const generateActionItems = useMeetingStore((s) => s.generateActionItems);
  const generatingBrief = useMeetingStore((s) => s.generatingBrief);
  const generatingActions = useMeetingStore((s) => s.generatingActions);
  const error = useMeetingStore((s) => s.error);
  const updateActionItemStatus = useMeetingStore((s) => s.updateActionItemStatus);
  const convertActionToCard = useMeetingStore((s) => s.convertActionToCard);
  const loadAnalytics = useMeetingStore((s) => s.loadAnalytics);
  const clearAnalytics = useMeetingStore((s) => s.clearAnalytics);
  const projects = useProjectStore((s) => s.projects);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const hasAnyEnabledProvider = useSettingsStore((s) => s.hasAnyEnabledProvider);

  const [convertingAction, setConvertingAction] = useState<ActionItem | null>(null);
  const [pushColumns, setPushColumns] = useState<Column[]>([]);
  const [selectedPushColumnId, setSelectedPushColumnId] = useState<string | undefined>(undefined);
  const [pushing, setPushing] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const prevSegmentCount = useRef(0);
  const autoGenerateBriefTriggered = useRef(false);
  const autoGenerateActionsTriggered = useRef(false);

  // Custom Escape handler: skip when focus is in input/textarea/contenteditable
  const escapeDeactivates = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return false;
    return true;
  }, []);

  // Load projects for linking dropdown
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Load analytics for completed meetings
  useEffect(() => {
    if (selectedMeeting?.id && selectedMeeting.status === 'completed') {
      loadAnalytics(selectedMeeting.id);
    }
  }, [selectedMeeting?.id, selectedMeeting?.status, loadAnalytics]);

  // Auto-scroll to bottom when new segments arrive during recording
  useEffect(() => {
    if (!selectedMeeting) return;
    const count = selectedMeeting.segments.length;
    if (count > prevSegmentCount.current && selectedMeeting.status === 'recording') {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevSegmentCount.current = count;
  }, [selectedMeeting?.segments.length, selectedMeeting?.status]);

  // Auto-generate brief when modal opens post-recording
  useEffect(() => {
    if (!autoGenerate) return;
    if (autoGenerateBriefTriggered.current) return;
    if (!selectedMeeting) return;
    if (selectedMeeting.status !== 'completed') return;
    if (selectedMeeting.segments.length === 0) return;
    if (selectedMeeting.brief) return;
    if (generatingBrief || generatingActions) return;

    autoGenerateBriefTriggered.current = true;
    generateBrief(selectedMeeting.id);
  }, [autoGenerate, selectedMeeting, generatingBrief, generatingActions, generateBrief]);

  // Auto-generate action items after brief completes
  useEffect(() => {
    if (!autoGenerate) return;
    if (autoGenerateActionsTriggered.current) return;
    if (!selectedMeeting) return;
    if (!selectedMeeting.brief) return;
    if (selectedMeeting.actionItems.length > 0) return;
    if (generatingActions) return;

    autoGenerateActionsTriggered.current = true;
    generateActionItems(selectedMeeting.id);
  }, [autoGenerate, selectedMeeting, generatingActions, generateActionItems]);

  // Load columns for inline push when meeting has a linked project
  useEffect(() => {
    if (!selectedMeeting?.projectId) {
      setPushColumns([]);
      setSelectedPushColumnId(undefined);
      return;
    }
    let cancelled = false;
    window.electronAPI
      .getBoards(selectedMeeting.projectId)
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
  }, [selectedMeeting?.projectId]);

  if (!selectedMeeting) return null;

  const meeting = selectedMeeting;

  // Resolve linked project name
  const linkedProject = meeting.projectId ? projects.find((p) => p.id === meeting.projectId) : null;
  const linkedProjectName = linkedProject?.name ?? undefined;

  // --- Handlers ---

  const handleClose = () => {
    clearAnalytics();
    clearSelectedMeeting();
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  };

  const handleDelete = async () => {
    await deleteMeeting(meeting.id);
    onClose();
  };

  const handleExport = () => {
    const markdown = formatMeetingAsMarkdown(meeting, linkedProjectName);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = slugify(meeting.title);
    const dateStr = new Date(meeting.startedAt).toISOString().slice(0, 10);
    a.download = `meeting-${slug}-${dateStr}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Meeting exported as Markdown', 'success');
  };

  const handleCopy = (field: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const copySummary = () => {
    if (meeting.brief) handleCopy('summary', meeting.brief.summary);
  };

  const copyActionItems = () => {
    const text = meeting.actionItems
      .map((item) => {
        const checkbox = item.status === 'approved' ? '[x]' : '[ ]';
        return `- ${checkbox} ${item.description}`;
      })
      .join('\n');
    handleCopy('actions', text);
  };

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

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-surface-900/40 dark:bg-black/80 backdrop-blur-[2px]"
        onClick={handleOverlayClick}
      >
        <FocusTrap active={true} onDeactivate={handleClose} escapeDeactivates={escapeDeactivates}>
          <div className="hud-panel-accent clip-corner-cut shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4 p-8">
            <MeetingHeader
              meeting={meeting}
              projects={projects}
              onUpdateMeeting={updateMeeting}
              onExport={handleExport}
              onClose={handleClose}
            />

            {meeting.prepBriefing && <MeetingPrepSection prepBriefing={meeting.prepBriefing} />}

            {/* Meeting Analytics */}
            <div className="mb-5">
              <MeetingAnalyticsSection meetingId={meeting.id} isCompleted={meeting.status === 'completed'} />
            </div>

            {/* Meeting Intelligence (Brief + Action Items) */}
            {hasAnyEnabledProvider() ? (
              <>
                {autoGenerate && error && !meeting.brief && !generatingBrief && (
                  <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <div className="flex items-start gap-2">
                      <Info size={14} className="text-amber-400 mt-0.5 shrink-0" />
                      <p className="text-sm text-amber-300">
                        Configure an AI provider in Settings to generate meeting intelligence.
                      </p>
                    </div>
                  </div>
                )}

                <div className="mb-5">
                  <BriefSection
                    meetingId={meeting.id}
                    brief={meeting.brief}
                    isCompleted={meeting.status === 'completed'}
                    generatingBrief={generatingBrief}
                    onGenerate={() => generateBrief(meeting.id)}
                  />
                </div>

                <div className="mb-5">
                  <ActionItemList
                    meetingId={meeting.id}
                    actionItems={meeting.actionItems}
                    isCompleted={meeting.status === 'completed'}
                    generatingActions={generatingActions}
                    onGenerate={() => generateActionItems(meeting.id)}
                    onUpdateStatus={updateActionItemStatus}
                    onConvert={(item) => setConvertingAction(item)}
                    meetingProjectId={meeting.projectId ?? undefined}
                    columns={meeting.projectId ? pushColumns : undefined}
                    selectedColumnId={selectedPushColumnId}
                    onColumnChange={setSelectedPushColumnId}
                    onPushToColumn={meeting.projectId ? handlePushToColumn : undefined}
                    pushing={pushing}
                  />
                </div>
              </>
            ) : (
              <div className="mb-5">
                <EmptyAIState featureName="meeting intelligence" />
              </div>
            )}

            <TranscriptSection
              meeting={meeting}
              transcriptEndRef={transcriptEndRef}
              initialSearch={initialTranscriptSearch}
              onCopySummary={copySummary}
              onCopyActions={copyActionItems}
              copiedField={copiedField}
              onCopy={handleCopy}
            />

            <DeleteMeetingButton onDelete={handleDelete} />
          </div>
        </FocusTrap>
      </div>
      {convertingAction && (
        <ConvertActionModal
          actionItem={convertingAction}
          preselectedProjectId={meeting.projectId ?? undefined}
          preselectedProjectName={linkedProjectName}
          onConvert={convertActionToCard}
          onClose={() => setConvertingAction(null)}
        />
      )}
    </>
  );
}
