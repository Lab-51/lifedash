// === FILE PURPOSE ===
// Post-meeting "Live proposals" section (LIVE.2 Task 6) — surfaces un-actioned
// (`status='proposed'`) live-triage proposals so the user can late-accept/dismiss
// them after the meeting ends. Proposals must never silently die at meeting end:
// this section is the whole point.
//
// Loads independently via the `listLiveSuggestions` IPC (own local state, not
// `liveSuggestionsStore`) because that store is scoped to the CURRENT recording
// and clears on stop — it has nothing left for a meeting once recording ends.
// Mirrors `LiveAssistantSection`'s own-local-state/own-IPC-load idiom, and reuses
// `LiveProposalChips` (shared with the in-meeting `LiveProposalsFeed`) for the
// actual chip rendering — no rebuilt markup.

import { useEffect, useState } from 'react';
import LiveProposalChips, { type ProposalConfirmation } from '../LiveProposalChips';
import { toast } from '../../hooks/useToast';
import type { LiveSuggestion } from '../../../shared/types';

/** How long an "Added to ... Inbox" confirmation banner stays visible before auto-expiring. */
const CONFIRMATION_MS = 4000;

interface LiveProposalsSectionProps {
  meetingId: string;
  /** Resolved project name for the "Added to {project} Inbox" confirmation banner. */
  projectName: string;
}

export default function LiveProposalsSection({ meetingId, projectName }: LiveProposalsSectionProps) {
  const [suggestions, setSuggestions] = useState<LiveSuggestion[]>([]);
  const [confirmations, setConfirmations] = useState<ProposalConfirmation[]>([]);
  // Ids with an accept/dismiss IPC in flight — their chip buttons are disabled so a
  // double-click can't fire two IPCs (defense-in-depth for the accept-lifecycle race).
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  function markBusy(id: string): void {
    setBusyIds((prev) => new Set(prev).add(id));
  }
  function clearBusy(id: string): void {
    setBusyIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .listLiveSuggestions(meetingId)
      .then((loaded) => {
        if (!cancelled) setSuggestions(loaded);
      })
      .catch(() => {
        // Best-effort — same posture as LiveAssistantSection's load.
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  // Auto-expire confirmation banners (mirrors LiveProposalsFeed).
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
    if (busyIds.has(suggestion.id)) return;
    markBusy(suggestion.id);
    try {
      const updated = await window.electronAPI.acceptLiveSuggestion(suggestion.id);
      // null = already processed/claimed elsewhere — leave the chip for a fresh load.
      if (!updated) return;
      setSuggestions((prev) => prev.map((s) => (s.id === suggestion.id ? updated : s)));
      if (updated.type === 'action_item') {
        setConfirmations((prev) => [...prev, { id: suggestion.id, text: `Added to ${projectName} Inbox` }]);
      } else if (updated.type === 'project') {
        toast('Created project + linked meeting', 'success');
      }
    } catch {
      toast('Failed to accept proposal', 'error');
    } finally {
      clearBusy(suggestion.id);
    }
  }

  async function handleDismiss(id: string): Promise<void> {
    if (busyIds.has(id)) return;
    markBusy(id);
    try {
      const updated = await window.electronAPI.dismissLiveSuggestion(id);
      setSuggestions((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } catch {
      toast('Failed to dismiss proposal', 'error');
    } finally {
      clearBusy(id);
    }
  }

  const pending = suggestions.filter((s) => s.status === 'proposed');

  // Nothing pending and nothing just actioned — render nothing rather than an
  // empty section (mirrors LiveAssistantSection's idiom).
  if (pending.length === 0 && confirmations.length === 0) return null;

  return (
    <div className="mb-5">
      <h3 className="font-hud text-xs text-[var(--color-text-secondary)] mb-3">
        Live proposals
        <span className="ml-2 text-surface-500">({pending.length} pending)</span>
      </h3>
      <div className="rounded-xl bg-surface-100/50 dark:bg-surface-950/50 border border-[var(--color-border)]">
        <LiveProposalChips
          proposals={pending}
          confirmations={confirmations}
          onAccept={(suggestion) => void handleAccept(suggestion)}
          onDismiss={(id) => void handleDismiss(id)}
          busyIds={busyIds}
          maxHeightClassName="max-h-72"
        />
      </div>
    </div>
  );
}
