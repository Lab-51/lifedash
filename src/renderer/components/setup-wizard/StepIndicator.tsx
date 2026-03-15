// Progress indicator showing the current wizard step position.

import { CheckCircle } from 'lucide-react';
import type { WizardStep } from './types';
import { ORDERED_STEPS, STEP_LABELS } from './types';

/** Maps any step to its indicator position in ORDERED_STEPS */
function getIndicatorStep(step: WizardStep): WizardStep {
  if (step === 'pick-provider' || step === 'tutorial') return 'have-key';
  return step;
}

export default function StepIndicator({ current }: { current: WizardStep }) {
  // Don't show indicator on welcome or have-key entry screen
  if (current === 'welcome') return null;

  const indicatorStep = getIndicatorStep(current);
  const currentIdx = ORDERED_STEPS.indexOf(indicatorStep);

  return (
    <div className="flex items-center gap-1 justify-center mb-5">
      {ORDERED_STEPS.map((step, idx) => {
        const isActive = step === indicatorStep;
        const isDone = idx < currentIdx;

        return (
          <div key={step} className="flex items-center gap-1">
            <div
              className={`flex items-center justify-center w-6 h-6 rounded-full text-[0.625rem] font-hud tracking-wider border transition-all ${
                isActive
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                  : isDone
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-500'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
              }`}
            >
              {isDone ? <CheckCircle size={12} /> : idx + 1}
            </div>
            <span
              className={`text-[0.625rem] font-data tracking-wider uppercase transition-colors ${
                isActive ? 'text-[var(--color-accent)]' : isDone ? 'text-emerald-500' : 'text-[var(--color-text-muted)]'
              }`}
            >
              {STEP_LABELS[step]}
            </span>
            {idx < ORDERED_STEPS.length - 1 && (
              <div className={`w-4 h-px mx-1 ${isDone ? 'bg-emerald-500/40' : 'bg-[var(--color-border)]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
