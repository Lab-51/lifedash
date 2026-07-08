// === FILE PURPOSE ===
// Digital Twin "Deep interview" mode panel (V3.3.5 — Task 2). Mounted by
// TwinWizard's mode fork when the user picks the deep, multi-turn interview
// (distinct from the Quick-form per-step "Interview me"). Seeded by the user's
// free-form `brief`.
//
// === FLOW ===
// On mount it asks the model for the first question (twinInterviewNext). The user
// answers in a textarea and each turn is accumulated into `qa`; "Next question"
// fetches the following one. "Skip question" and "Finish now" are ALWAYS available
// (finish-anytime). When the model reports it has enough (or the 8-question cap is
// hit) the panel synthesizes the Q&A into a Partial<TwinProfileSections> draft
// (twinInterviewSynthesize) and hands it UP via onDraft — the wizard seeds its
// EXISTING editable review from it and the user saves there. NOTHING auto-saves
// and this panel builds NO review UI of its own.
//
// === FAILURE TOLERANCE ===
// AI is never required. Any skipped/failed turn (no model configured, or generation
// failed after one retry) shows a NON-BLOCKING notice offering the manual Quick
// form (via onBack). An AI failure must NEVER block the user.
//
// === DEPENDENCIES ===
// react, lucide-react, shared/types/twin.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MessagesSquare, ChevronLeft, ChevronRight, Loader2, Check, AlertTriangle } from 'lucide-react';
import type { TwinProfileSections, TwinQATurn } from '../../../shared/types/twin';

/** Upper bound on questions — mirrors the service cap; drives the progress copy. */
const MAX_QUESTIONS = 8;

export interface DeepInterviewPanelProps {
  /** The user's free-form brief, seeding the interview. May be empty. */
  brief: string;
  /** Return to the wizard's mode-choice screen. */
  onBack: () => void;
  /**
   * Hand the synthesized profile draft UP to the wizard, which seeds its shared
   * editable review from it (the user edits + saves there — nothing auto-saves).
   */
  onDraft: (draft: Partial<TwinProfileSections>) => void;
}

/** 'loading' = fetching the next question; 'answering' = a question is on screen. */
type Phase = 'loading' | 'answering' | 'synthesizing' | 'notice';

/** Why the AI path stopped — drives the non-blocking notice copy. */
type NoticeReason = 'no-model' | 'failed';

const NOTICE_MESSAGE: Record<NoticeReason, string> = {
  'no-model': 'No AI model is configured for the interview. You can fill the form instead — nothing is lost.',
  failed: "The interview couldn't continue right now. You can fill the form instead — nothing is lost.",
};

export default function DeepInterviewPanel({ brief, onBack, onDraft }: DeepInterviewPanelProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [qa, setQa] = useState<TwinQATurn[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [notice, setNotice] = useState<NoticeReason | null>(null);

  // Tracks whether the panel is still mounted, so a slow synthesize/next call that
  // resolves AFTER the user navigated away (Back / wizard close) can't snap them into
  // an abandoned review or update unmounted state (finding #6.4). Set true on (re)mount
  // so React.StrictMode's mount→cleanup→mount cycle leaves it true.
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  // a11y (finding #6.6): each new question replaces the answering block, dropping
  // keyboard focus to <body>. Move focus to the answer box when a question loads and
  // tie the question text to it (aria-describedby) so screen-reader users hear the
  // question when focus lands — keeping the core loop usable without a mouse.
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const questionId = useId();
  useEffect(() => {
    if (phase === 'answering') answerRef.current?.focus();
  }, [phase, question]);

  // Synthesize the Q&A into a draft and hand it UP; the wizard takes over on success.
  const finish = useCallback(
    async (finalQa: TwinQATurn[]) => {
      setPhase('synthesizing');
      try {
        const res = await window.electronAPI.twinInterviewSynthesize({ brief, qa: finalQa });
        if (!activeRef.current) return; // navigated away mid-synthesis — do not forward
        if (res.status === 'ok') {
          onDraft(res.draft); // wizard unmounts this panel and opens its editable review
          return;
        }
        setNotice(res.reason === 'no-model' ? 'no-model' : 'failed');
        setPhase('notice');
      } catch {
        if (!activeRef.current) return;
        setNotice('failed');
        setPhase('notice');
      }
    },
    [brief, onDraft],
  );

  // Ask the model for the next question given the Q&A so far; auto-synthesize on done.
  // Intentionally does NOT set the transient 'loading' phase itself: on mount that
  // phase is the initial state, and for user-driven turns the calling handler sets
  // it — so this never triggers a synchronous setState when invoked from the mount
  // effect (react-hooks/set-state-in-effect). All state changes here follow an await.
  const loadNext = useCallback(
    async (currentQa: TwinQATurn[]) => {
      try {
        const res = await window.electronAPI.twinInterviewNext({ brief, profileSoFar: {}, qa: currentQa });
        if (!activeRef.current) return; // navigated away while fetching the next question
        if (res.status === 'ok') {
          setQuestion(res.question);
          setAnswer('');
          setPhase('answering');
          return;
        }
        if (res.status === 'done') {
          await finish(currentQa);
          return;
        }
        setNotice(res.reason === 'no-model' ? 'no-model' : 'failed');
        setPhase('notice');
      } catch {
        if (!activeRef.current) return;
        setNotice('failed');
        setPhase('notice');
      }
    },
    [brief, finish],
  );

  // Ask the first question once on mount. The ref guard makes the effect idempotent
  // under React.StrictMode's double-invoke (the app mounts under StrictMode). The
  // fetch is deferred a microtask so no state update runs synchronously in the effect
  // body (react-hooks/set-state-in-effect); the spinner shows via the initial 'loading'
  // phase until loadNext resolves.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    queueMicrotask(() => void loadNext([]));
  }, [loadNext]);

  const submitAnswer = () => {
    const text = answer.trim();
    if (!text) return;
    const next = [...qa, { question, answer: text }];
    setQa(next);
    setPhase('loading'); // event handler — synchronous setState here is fine
    void loadNext(next);
  };

  const skipQuestion = () => {
    // Record the skip (empty answer) so the model won't re-ask and the cap still advances.
    const next = [...qa, { question, answer: '' }];
    setQa(next);
    setPhase('loading');
    void loadNext(next);
  };

  const finishNow = () => {
    const text = answer.trim();
    const finalQa = text ? [...qa, { question, answer: text }] : qa;
    setQa(finalQa);
    void finish(finalQa);
  };

  const questionNumber = Math.min(qa.length + 1, MAX_QUESTIONS);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        disabled={phase === 'synthesizing'}
        className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40"
      >
        <ChevronLeft size={16} />
        Back to options
      </button>

      <div className="flex items-center gap-2">
        <MessagesSquare size={18} className="text-[var(--color-accent)] shrink-0" />
        <h3 className="font-hud text-base text-[var(--color-text-primary)]">Deep interview</h3>
      </div>

      {brief.trim() && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent-muted)]/30 p-3">
          <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">Your brief</p>
          <p className="text-sm text-[var(--color-text-primary)] break-words overflow-hidden">{brief.trim()}</p>
        </div>
      )}

      {phase === 'loading' && (
        <div className="flex items-center gap-2 py-8 text-sm text-[var(--color-text-secondary)]" role="status">
          <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
          Thinking of the next question…
        </div>
      )}

      {phase === 'synthesizing' && (
        <div className="flex items-center gap-2 py-8 text-sm text-[var(--color-text-secondary)]" role="status">
          <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
          Building your profile draft…
        </div>
      )}

      {phase === 'answering' && (
        <div className="space-y-3">
          <p className="text-xs font-data tracking-wide text-[var(--color-text-secondary)]" aria-live="polite">
            Question {questionNumber} of up to {MAX_QUESTIONS}
          </p>

          <p
            id={questionId}
            aria-live="polite"
            className="text-sm font-medium text-[var(--color-text-primary)] break-words"
          >
            {question}
          </p>

          <label className="block">
            <span className="sr-only">Your answer</span>
            <textarea
              ref={answerRef}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={4}
              aria-label="Your answer"
              aria-describedby={questionId}
              placeholder="Answer in your own words…"
              className="w-full text-sm bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] resize-y"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={skipQuestion}
              className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Skip question
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={finishNow}
                className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <Check size={16} />
                Finish now
              </button>
              <button
                type="button"
                onClick={submitAnswer}
                disabled={!answer.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] transition-all disabled:opacity-50"
              >
                Next question
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'notice' && notice && (
        <div className="space-y-3 py-4">
          <div className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]" role="status">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-[var(--color-accent)]" />
            <p className="break-words min-w-0">{NOTICE_MESSAGE[notice]}</p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] transition-all"
          >
            Fill the form instead
          </button>
        </div>
      )}
    </div>
  );
}
