// === FILE PURPOSE ===
// Optional "interview me" AI-assist affordance for one wizard step (V3.3 Task 4).
// Collapsed by default (an opt-in button); when opened it shows the step's
// free-form question, a textarea, and a "Draft from my answer" button. On submit
// it calls twinDraftSection and hands the parsed DRAFT to the parent, which
// merges it into the editable form — the form stays the source of truth. AI is
// never required: an unconfigured model or a failed extraction shows a quiet,
// NON-BLOCKING message ("fill the fields manually") and the step remains fully
// usable. Fully keyboard-operable; status announced via role="status".
//
// === DEPENDENCIES ===
// react, lucide-react.

import { useState } from 'react';
import { Wand2, Loader2, ChevronDown } from 'lucide-react';
import type { TwinProfileSectionKey, TwinInterviewDraft, TwinProfileSections } from '../../../shared/types/twin';

interface TwinInterviewAssistProps<K extends TwinProfileSectionKey> {
  section: K;
  /** The free-form prompt shown to the user (from the step config). */
  question: string;
  /** Called with the parsed draft on success — parent merges it into the form. */
  onDraft: (draft: TwinProfileSections[K]) => void;
}

type AssistOutcome = { kind: 'idle' } | { kind: 'filled' } | { kind: 'no-model' } | { kind: 'failed' };

const OUTCOME_MESSAGE: Record<Exclude<AssistOutcome['kind'], 'idle'>, string> = {
  filled: 'Drafted below — review and edit before continuing.',
  'no-model': 'No AI model is configured. Fill the fields manually below.',
  failed: "Couldn't draft from your answer. Fill the fields manually, or try rewording.",
};

export default function TwinInterviewAssist<K extends TwinProfileSectionKey>({
  section,
  question,
  onDraft,
}: TwinInterviewAssistProps<K>) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<AssistOutcome>({ kind: 'idle' });

  const handleDraft = async () => {
    const text = answer.trim();
    if (!text || busy) return;
    setBusy(true);
    setOutcome({ kind: 'idle' });
    try {
      const result: TwinInterviewDraft<K> = await window.electronAPI.twinDraftSection(section, text);
      if (result.status === 'ok') {
        onDraft(result.draft);
        setOutcome({ kind: 'filled' });
      } else {
        setOutcome({ kind: result.reason === 'no-model' ? 'no-model' : 'failed' });
      }
    } catch {
      // Any unexpected rejection degrades to manual — never blocks the wizard.
      setOutcome({ kind: 'failed' });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-dim)] transition-colors"
      >
        <Wand2 size={14} />
        Interview me instead
      </button>
    );
  }

  const messageTone =
    outcome.kind === 'filled'
      ? 'text-[var(--color-accent)]'
      : outcome.kind === 'idle'
        ? ''
        : 'text-[var(--color-text-secondary)]';

  return (
    <div className="rounded-lg border border-[var(--color-border-accent)] bg-[var(--color-accent-muted)]/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)]">
          <Wand2 size={14} />
          Interview me
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close interview assist"
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <label className="block">
        <span className="block text-xs text-[var(--color-text-secondary)] mb-1.5">{question}</span>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={3}
          placeholder="Answer in your own words — the assistant drafts the fields for you to edit."
          className="w-full text-sm bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] resize-y"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleDraft()}
          disabled={busy || !answer.trim()}
          className="flex items-center gap-1.5 text-xs border border-[var(--color-accent-dim)] text-[var(--color-accent)] hover:border-[var(--color-accent)] px-2.5 py-1 rounded transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          {busy ? 'Drafting…' : 'Draft from my answer'}
        </button>
        {outcome.kind !== 'idle' && (
          <p role="status" className={`text-xs break-words min-w-0 ${messageTone}`}>
            {OUTCOME_MESSAGE[outcome.kind]}
          </p>
        )}
      </div>
    </div>
  );
}
