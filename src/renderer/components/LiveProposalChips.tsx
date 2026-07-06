// === FILE PURPOSE ===
// Pure presentational rendering for live-triage proposal chips (LIVE.2 Task 5/6):
// the confirmation banners + Accept/Dismiss chip list. Extracted so both the
// store-driven `LiveProposalsFeed` (Live Mode's right column, during a recording)
// and the prop-driven `meeting-detail/LiveProposalsSection` (post-meeting, loads
// independently via IPC since the live store clears on stop) share one rendering
// implementation instead of duplicating the chip markup.
//
// === DEPENDENCIES ===
// lucide-react, shared LiveSuggestion type

import { CheckSquare, GitCommitHorizontal, HelpCircle, FolderPlus, Check, X } from 'lucide-react';
import type { LiveSuggestion } from '../../shared/types';

export interface ProposalConfirmation {
  id: string;
  text: string;
}

const TYPE_ICON: Record<LiveSuggestion['type'], typeof CheckSquare> = {
  action_item: CheckSquare,
  decision: GitCommitHorizontal,
  question: HelpCircle,
  project: FolderPlus,
};

const TYPE_LABEL: Record<LiveSuggestion['type'], string> = {
  action_item: 'Action item',
  decision: 'Decision',
  question: 'Question',
  project: 'Create project',
};

interface LiveProposalChipsProps {
  proposals: LiveSuggestion[];
  confirmations: ProposalConfirmation[];
  onAccept: (suggestion: LiveSuggestion) => void;
  onDismiss: (id: string) => void;
  /** Overrides the scroll container's max-height for denser embeds (e.g. inside a modal). */
  maxHeightClassName?: string;
  /** Ids whose accept/dismiss IPC is in flight — their buttons are disabled so a
   * double-click can't fire two IPCs. Omitted where the caller guards elsewhere
   * (e.g. LiveProposalsFeed's synchronous store flip). */
  busyIds?: ReadonlySet<string>;
}

export default function LiveProposalChips({
  proposals,
  confirmations,
  onAccept,
  onDismiss,
  maxHeightClassName = 'max-h-[40vh]',
  busyIds,
}: LiveProposalChipsProps) {
  return (
    <div
      data-testid="live-proposals-feed"
      className={`flex flex-col gap-2 px-3 py-3 overflow-y-auto ${maxHeightClassName}`}
    >
      {confirmations.map((c) => (
        <div
          key={`confirm-${c.id}`}
          role="status"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 animate-in fade-in slide-in-from-top-1 duration-300"
        >
          <Check size={13} className="shrink-0" />
          {c.text}
        </div>
      ))}

      {/* Newest-first — callers append new proposals to the end as they arrive/load. */}
      {[...proposals].reverse().map((suggestion) => {
        const Icon = TYPE_ICON[suggestion.type];
        // A 'project' chip creates a project on accept, so its verb reads "Create".
        const acceptLabel = suggestion.type === 'project' ? 'Create' : 'Accept';
        const busy = busyIds?.has(suggestion.id) ?? false;
        return (
          <div
            key={suggestion.id}
            className="hud-panel clip-corner-cut-sm px-3 py-2.5 animate-in fade-in slide-in-from-top-1 duration-300"
          >
            <div className="flex items-start gap-2">
              <Icon size={14} className="text-[var(--color-accent)] shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-[0.625rem] font-data uppercase tracking-wide text-[var(--color-text-muted)]">
                  {TYPE_LABEL[suggestion.type]}
                </p>
                <p className="text-xs text-[var(--color-text-primary)] break-words">{suggestion.title}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5 mt-2">
              <button
                onClick={() => onAccept(suggestion)}
                disabled={busy}
                aria-label={`${acceptLabel}: ${suggestion.title}`}
                title={acceptLabel}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[0.6875rem] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check size={12} /> {acceptLabel}
              </button>
              <button
                onClick={() => onDismiss(suggestion.id)}
                disabled={busy}
                aria-label={`Dismiss: ${suggestion.title}`}
                title="Dismiss"
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-transparent hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-muted)] text-[0.6875rem] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={12} /> Dismiss
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
