// === FILE PURPOSE ===
// Meeting Prep Section — collapsible card showing AI-generated prep data
// for the selected project before a recording begins. Displays card changes,
// pending actions, high-priority items, and an AI briefing.
//
// === DEPENDENCIES ===
// react, lucide-react, recordingStore, shared types (MeetingPrepData)

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, AlertCircle } from 'lucide-react';
import { useRecordingStore } from '../stores/recordingStore';
import type { MeetingPrepData } from '../../shared/types';

interface MeetingPrepSectionProps {
  projectId: string;
}

/** Simple markdown-ish renderer: ## as bold headings, - as bullets, plain text. */
function renderBriefing(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      nodes.push(<div key={i} className="h-1.5" />);
    } else if (trimmed.startsWith('## ')) {
      nodes.push(
        <p key={i} className="text-xs font-semibold text-surface-200 mt-2 mb-0.5">
          {trimmed.slice(3)}
        </p>,
      );
    } else if (trimmed.startsWith('# ')) {
      nodes.push(
        <p key={i} className="text-xs font-bold text-surface-100 mt-2 mb-0.5">
          {trimmed.slice(2)}
        </p>,
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      nodes.push(
        <p key={i} className="text-xs text-surface-300 pl-3">
          <span className="text-surface-500 mr-1">{'\u2022'}</span>
          {trimmed.slice(2)}
        </p>,
      );
    } else {
      nodes.push(
        <p key={i} className="text-xs text-surface-300">{trimmed}</p>,
      );
    }
  }

  return nodes;
}

/** Format a date string to a short readable form. */
function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export default function MeetingPrepSection({ projectId }: MeetingPrepSectionProps) {
  const [prepData, setPrepData] = useState<MeetingPrepData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const setPrepBriefing = useRecordingStore(s => s.setPrepBriefing);

  // Track the projectId we last fetched for so we can detect changes
  const lastFetchedProjectId = useRef<string | null>(null);

  const fetchPrep = async (pid: string) => {
    setLoading(true);
    setError(null);
    setPrepData(null);
    setPrepBriefing(null);

    try {
      const data = await window.electronAPI.meetingsGeneratePrep(pid);
      setPrepData(data);
      setExpanded(true);
      setPrepBriefing(data.aiBriefing);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate meeting prep';
      setError(msg);
      setExpanded(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId && projectId !== lastFetchedProjectId.current) {
      lastFetchedProjectId.current = projectId;
      fetchPrep(projectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Clear prep briefing from store when component unmounts
  useEffect(() => {
    return () => {
      setPrepBriefing(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRegenerate = () => {
    lastFetchedProjectId.current = projectId;
    fetchPrep(projectId);
  };

  const totalChanges =
    (prepData?.cardChanges.created.length ?? 0) +
    (prepData?.cardChanges.completed.length ?? 0) +
    (prepData?.cardChanges.moved.length ?? 0);

  // --- Loading skeleton ---
  if (loading) {
    return (
      <div className="bg-surface-800/50 rounded-lg border border-surface-700 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded bg-surface-600 animate-pulse" />
          <div className="h-3 w-40 rounded bg-surface-600 animate-pulse" />
        </div>
        <div className="h-2.5 w-full rounded bg-surface-700 animate-pulse" />
        <div className="h-2.5 w-3/4 rounded bg-surface-700 animate-pulse" />
        <div className="h-2.5 w-5/6 rounded bg-surface-700 animate-pulse" />
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <div className="bg-surface-800/50 rounded-lg border border-surface-700 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-amber-400">{error}</p>
          </div>
          <button
            onClick={handleRegenerate}
            className="flex items-center gap-1 text-xs text-surface-400 hover:text-surface-200 transition-colors shrink-0"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  // --- No data yet ---
  if (!prepData) return null;

  return (
    <div className="bg-surface-800/50 rounded-lg border border-surface-700">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-surface-700/30 transition-colors rounded-lg"
      >
        <span className="text-sm font-medium text-surface-200 truncate">
          Meeting Prep for &ldquo;{prepData.projectName}&rdquo;
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRegenerate();
            }}
            className="text-surface-500 hover:text-surface-300 p-0.5 transition-colors"
            title="Regenerate prep"
          >
            <RefreshCw size={12} />
          </button>
          {expanded ? (
            <ChevronDown size={16} className="text-surface-400" />
          ) : (
            <ChevronRight size={16} className="text-surface-400" />
          )}
        </div>
      </button>

      {/* Collapsible content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Last meeting reference */}
          {prepData.lastMeetingTitle && (
            <p className="text-xs text-surface-400">
              Since last meeting: &ldquo;{prepData.lastMeetingTitle}&rdquo;
              {prepData.lastMeetingDate && (
                <span className="ml-1">({formatShortDate(prepData.lastMeetingDate)})</span>
              )}
            </p>
          )}
          {!prepData.lastMeetingTitle && (
            <p className="text-xs text-surface-500">No previous meetings for this project</p>
          )}

          {/* Card changes */}
          {totalChanges > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-surface-300">
                Changes ({totalChanges}):
              </p>
              {prepData.cardChanges.created.length > 0 && (
                <p className="text-xs text-emerald-400 pl-2">
                  + {prepData.cardChanges.created.length} card{prepData.cardChanges.created.length !== 1 ? 's' : ''} created
                </p>
              )}
              {prepData.cardChanges.completed.length > 0 && (
                <p className="text-xs text-emerald-400 pl-2">
                  {'\u2713'} {prepData.cardChanges.completed.length} card{prepData.cardChanges.completed.length !== 1 ? 's' : ''} completed
                </p>
              )}
              {prepData.cardChanges.moved.length > 0 && (
                <p className="text-xs text-blue-400 pl-2">
                  {'\u2192'} {prepData.cardChanges.moved.length} card{prepData.cardChanges.moved.length !== 1 ? 's' : ''} moved
                </p>
              )}
            </div>
          )}

          {/* Pending actions */}
          {prepData.pendingActions.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-surface-300">
                Pending Actions ({prepData.pendingActions.length}):
              </p>
              {prepData.pendingActions.map((action, i) => (
                <p key={i} className="text-xs text-surface-300 pl-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-1.5 align-middle" />
                  &ldquo;{action.description}&rdquo;
                  <span className="text-surface-500 ml-1">(from {action.meetingTitle})</span>
                </p>
              ))}
            </div>
          )}

          {/* High priority cards */}
          {prepData.highPriorityCards.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-surface-300">
                High Priority ({prepData.highPriorityCards.length}):
              </p>
              {prepData.highPriorityCards.map((card, i) => (
                <p key={i} className="text-xs text-surface-300 pl-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 mr-1.5 align-middle" />
                  &ldquo;{card.title}&rdquo;
                  <span className="text-surface-500 ml-1">in {card.column}</span>
                  {card.dueDate && (
                    <span className="text-surface-500 ml-1">
                      (due {formatShortDate(card.dueDate)})
                    </span>
                  )}
                </p>
              ))}
            </div>
          )}

          {/* AI Briefing */}
          {prepData.aiBriefing && (
            <div className="space-y-1 pt-2 border-t border-surface-700">
              <p className="text-xs font-medium text-surface-300">AI Briefing</p>
              <div className="space-y-0.5">
                {renderBriefing(prepData.aiBriefing)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
