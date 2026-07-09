// === FILE PURPOSE ===
// Step 3 of the orchestrated Digital Twin "Deep interview" flow (V3.3.5): the single
// on-screen question + answer turn. The parent owns the async question loop and
// synthesis; this component is the pure answering UI. Skip and Finish-now are always
// available (finish-anytime). Next is disabled until an answer is typed.
//
// Accessibility (finding #6.6): the question sits in a polite live region and is tied
// to the answer box (aria-describedby); focus moves to the answer box whenever a new
// question loads so keyboard/screen-reader users can act immediately.
//
// === DEPENDENCIES ===
// react, lucide-react.

import { useEffect, useId, useRef } from 'react';
import { ChevronRight, Check } from 'lucide-react';

export interface DeepInterviewStepProps {
  question: string;
  answer: string;
  questionNumber: number;
  maxQuestions: number;
  onAnswerChange: (v: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  onFinish: () => void;
}

export default function DeepInterviewStep({
  question,
  answer,
  questionNumber,
  maxQuestions,
  onAnswerChange,
  onSubmit,
  onSkip,
  onFinish,
}: DeepInterviewStepProps) {
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const questionId = useId();

  // Move focus to the answer box when a question loads (it lands on <body> otherwise),
  // re-running when the question text changes so each new turn re-focuses.
  useEffect(() => {
    answerRef.current?.focus();
  }, [question]);

  return (
    <div className="space-y-3">
      <p className="text-xs font-data tracking-wide text-[var(--color-text-secondary)]" aria-live="polite">
        Question {questionNumber} of up to {maxQuestions}
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
          onChange={(e) => onAnswerChange(e.target.value)}
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
          onClick={onSkip}
          className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Skip question
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onFinish}
            className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <Check size={16} />
            Finish now
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!answer.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] transition-all disabled:opacity-50"
          >
            Next question
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
