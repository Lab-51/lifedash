// === FILE PURPOSE ===
// Twin Memory ledger (V3.4 Task 3) — the auditability half of the twin's locked
// safety triad (provenance / one-tap forget / global pause). Lists every ACTIVE
// learned fact newest-first (twin:memory-list is already reverse-chron), resolves
// "learned in <session>" from the app's own meetings store (never a raw id, never
// fabricated), and hosts the "Pause learning" kill-switch. Forgetting a fact calls
// twin:memory-forget immediately (soft delete) and offers a ~5s undo via
// twin:memory-restore — the gate itself is enforced main-side (Task 2); this panel
// only reflects and flips the twin.learningPaused setting, it never re-implements
// the gate.
//
// === DEPENDENCIES ===
// react, react-router-dom, lucide-react, stores/meetingStore, stores/settingsStore,
// ../LoadingSpinner, twin/TwinMemoryFactRow, twin/TwinMemoryUndoSnackbar

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Pause, Play } from 'lucide-react';
import LoadingSpinner from '../LoadingSpinner';
import { useMeetingStore } from '../../stores/meetingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { TWIN_LEARNING_PAUSED_SETTING_KEY, type TwinFact } from '../../../shared/types/twin';
import TwinMemoryFactRow from './TwinMemoryFactRow';
import TwinMemoryUndoSnackbar from './TwinMemoryUndoSnackbar';

const FALLBACK_SESSION_LABEL = 'a past session';

export interface TwinMemoryPanelProps {
  /** Reports the live ACTIVE-fact count so the parent can badge the Memory tab. */
  onCountChange?: (count: number) => void;
}

export default function TwinMemoryPanel({ onCountChange }: TwinMemoryPanelProps) {
  const navigate = useNavigate();
  const meetings = useMeetingStore((s) => s.meetings);
  const settings = useSettingsStore((s) => s.settings);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const paused = settings[TWIN_LEARNING_PAUSED_SETTING_KEY] === 'true';

  const [facts, setFacts] = useState<TwinFact[] | null>(null); // null = still loading
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forgotten, setForgotten] = useState<TwinFact | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loadFacts = useCallback(async () => {
    try {
      const result = await window.electronAPI.twinMemoryList({ status: 'active' });
      setFacts(result);
      setLoadError(null);
    } catch {
      setLoadError('Failed to load learned facts.');
    }
  }, []);

  useEffect(() => {
    void loadFacts();
  }, [loadFacts]);

  // Report the live active-fact count to the parent (Memory tab badge).
  useEffect(() => {
    onCountChange?.(facts?.length ?? 0);
  }, [facts, onCountChange]);

  const togglePause = () => {
    void setSetting(TWIN_LEARNING_PAUSED_SETTING_KEY, paused ? 'false' : 'true');
  };

  const handleForget = useCallback(async (fact: TwinFact) => {
    try {
      const result = await window.electronAPI.twinMemoryForget(fact.id);
      if (!result) {
        setLoadError('Could not forget that fact — it may have already been removed.');
        return;
      }
      setFacts((prev) => (prev ? prev.filter((f) => f.id !== fact.id) : prev));
      setForgotten(fact);
    } catch {
      setLoadError('Failed to forget that fact — please try again.');
    }
  }, []);

  // Shared close path for both undo and auto-expiry — always hands focus back to
  // a stable, findable anchor since the fact's own row (and Forget button) is gone.
  const closeSnackbar = useCallback(() => {
    setForgotten(null);
    headingRef.current?.focus();
  }, []);

  const handleUndo = useCallback(async () => {
    if (!forgotten) return;
    try {
      const result = await window.electronAPI.twinMemoryRestore(forgotten.id);
      if (!result) {
        setLoadError('Could not restore that fact.');
      } else {
        await loadFacts();
      }
    } catch {
      setLoadError('Failed to restore that fact — please try again.');
    } finally {
      closeSnackbar();
    }
  }, [forgotten, closeSnackbar, loadFacts]);

  /** Resolve provenance from the app's own meetings store — never a raw id. */
  const resolveSession = (fact: TwinFact): { label: string; linkable: boolean } => {
    if (!fact.sourceMeetingId) return { label: FALLBACK_SESSION_LABEL, linkable: false };
    const meeting = meetings.find((m) => m.id === fact.sourceMeetingId);
    return { label: meeting?.title || FALLBACK_SESSION_LABEL, linkable: true };
  };

  if (facts === null) {
    return (
      <div className="flex items-center justify-center py-16">
        {loadError ? <p className="text-sm text-red-400">{loadError}</p> : <LoadingSpinner />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-sm font-hud tracking-wide text-[var(--color-text-primary)] outline-none"
        >
          Learned facts
        </h2>
        <button
          type="button"
          onClick={togglePause}
          aria-pressed={paused}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
            paused
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
              : 'border-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)] hover:bg-[var(--color-accent-dim)]'
          }`}
        >
          {paused ? <Play size={13} /> : <Pause size={13} />}
          {paused ? 'Resume learning' : 'Pause learning'}
        </button>
      </div>

      {paused && (
        <div role="status" className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
          Learning is paused — no new facts are being learned or applied.
        </div>
      )}

      {loadError && <p className="text-sm text-red-400">{loadError}</p>}

      {forgotten && (
        <TwinMemoryUndoSnackbar
          key={forgotten.id}
          factText={forgotten.fact}
          onUndo={() => void handleUndo()}
          onExpire={closeSnackbar}
        />
      )}

      {facts.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-16 px-6 hud-panel clip-corner-cut-sm">
          <Brain size={28} className="text-[var(--color-accent-dim)] mb-3" />
          <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-1.5">No facts learned yet</h3>
          <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
            After your sessions, the twin quietly learns durable facts about the people, projects, and preferences you
            mention — like names, ongoing work, and how you like things done — so briefs, chat, and triage get more
            personal over time. Every fact stays visible here, sourced to the session it came from, and is one-tap
            forgettable.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {facts.map((fact) => {
            const { label, linkable } = resolveSession(fact);
            return (
              <TwinMemoryFactRow
                key={fact.id}
                fact={fact}
                sessionLabel={label}
                sessionLinkable={linkable}
                onOpenSession={() => navigate(`/session/${fact.sourceMeetingId}`)}
                onForget={() => void handleForget(fact)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
