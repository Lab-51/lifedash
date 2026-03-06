// === FILE PURPOSE ===
// Step-by-step spotlight overlay that introduces LifeDash features on first launch.
// Shows before the Setup Wizard for new users. Uses a box-shadow cutout approach
// to spotlight sidebar nav items during relevant steps.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Rocket,
  FolderKanban,
  Mic,
  Brain,
  Lightbulb,
  PartyPopper,
} from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FeatureTourProps {
  onComplete: (proceedToWizard: boolean) => void;
}

interface TourStep {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** If set, spotlight the element with this data-tour-id attribute */
  spotlightTarget?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Steps
// ─────────────────────────────────────────────────────────────────────────────

const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to LifeDash',
    description:
      'Your all-in-one workspace for projects, meetings, ideas, and brainstorming — powered by AI when you want it.',
    icon: Rocket,
  },
  {
    id: 'projects',
    title: 'Projects',
    description:
      'Organize your work with boards and cards. Drag tasks between columns to track progress — like a personal Trello.',
    icon: FolderKanban,
    spotlightTarget: 'nav-projects',
  },
  {
    id: 'meetings',
    title: 'Meetings',
    description:
      'Record any meeting and get an automatic transcript. AI generates summaries and action items you can push to your projects.',
    icon: Mic,
    spotlightTarget: 'nav-meetings',
  },
  {
    id: 'brainstorm',
    title: 'Brainstorm',
    description:
      'Chat with AI to explore ideas, solve problems, or plan your next move. It knows about your projects for context.',
    icon: Brain,
    spotlightTarget: 'nav-brainstorm',
  },
  {
    id: 'ideas',
    title: 'Ideas',
    description:
      'Capture ideas on the fly — tag them, rate them, and turn the best ones into real projects or tasks.',
    icon: Lightbulb,
    spotlightTarget: 'nav-ideas',
  },
  {
    id: 'ready',
    title: "You're ready to explore!",
    description:
      "Next, we'll optionally help you connect an AI service to unlock smart features like summaries, brainstorming, and insights.",
    icon: PartyPopper,
  },
];

const SPOTLIGHT_PADDING = 8;
const SPOTLIGHT_RADIUS = 12;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function FeatureTour({ onComplete }: FeatureTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const step = TOUR_STEPS[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === TOUR_STEPS.length - 1;
  const isCentered = !step.spotlightTarget;

  // Fade in on mount
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Locate spotlight target when step changes
  useEffect(() => {
    if (!step.spotlightTarget) {
      setSpotlightRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour-id="${step.spotlightTarget}"]`);
    if (el) {
      setSpotlightRect(el.getBoundingClientRect());
    } else {
      setSpotlightRect(null);
    }
  }, [currentStep, step.spotlightTarget]);

  const markComplete = useCallback(async () => {
    await useSettingsStore.getState().setSetting('featureTour.completed', 'true');
  }, []);

  const handleNext = useCallback(() => {
    if (isLast) return;
    setCurrentStep(s => s + 1);
  }, [isLast]);

  const handleBack = useCallback(() => {
    if (isFirst) return;
    setCurrentStep(s => s - 1);
  }, [isFirst]);

  const handleSkip = useCallback(async () => {
    await markComplete();
    onComplete(false);
  }, [markComplete, onComplete]);

  const handleSetupAI = useCallback(async () => {
    await markComplete();
    onComplete(true);
  }, [markComplete, onComplete]);

  const handleSkipForNow = useCallback(async () => {
    await markComplete();
    onComplete(false);
  }, [markComplete, onComplete]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (!isLast) handleNext();
      } else if (e.key === 'ArrowLeft') {
        handleBack();
      } else if (e.key === 'Escape') {
        handleSkip();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isLast, handleNext, handleBack, handleSkip]);

  const StepIcon = step.icon;

  // Compute tooltip position: to the right of spotlight, or centered
  const tooltipStyle: React.CSSProperties = {};
  if (!isCentered && spotlightRect) {
    tooltipStyle.position = 'absolute';
    tooltipStyle.left = spotlightRect.right + 24;
    tooltipStyle.top = spotlightRect.top + spotlightRect.height / 2;
    tooltipStyle.transform = 'translateY(-50%)';
  }

  return (
    <div
      className={`fixed inset-0 z-[100] transition-opacity duration-500 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* SVG backdrop with transparent cutout for spotlight */}
      <svg
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: 'none' }}
      >
        <defs>
          <mask id="tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {spotlightRect && (
              <rect
                x={spotlightRect.left - SPOTLIGHT_PADDING}
                y={spotlightRect.top - SPOTLIGHT_PADDING}
                width={spotlightRect.width + SPOTLIGHT_PADDING * 2}
                height={spotlightRect.height + SPOTLIGHT_PADDING * 2}
                rx={SPOTLIGHT_RADIUS}
                ry={SPOTLIGHT_RADIUS}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.7)"
          mask="url(#tour-spotlight-mask)"
          style={{ pointerEvents: 'auto' }}
        />
      </svg>

      {/* Spotlight ring glow */}
      {spotlightRect && (
        <div
          className="absolute rounded-xl border-2 border-[var(--color-accent)] pointer-events-none animate-pulse"
          style={{
            left: spotlightRect.left - SPOTLIGHT_PADDING,
            top: spotlightRect.top - SPOTLIGHT_PADDING,
            width: spotlightRect.width + SPOTLIGHT_PADDING * 2,
            height: spotlightRect.height + SPOTLIGHT_PADDING * 2,
            boxShadow: '0 0 20px var(--color-accent-dim), inset 0 0 10px var(--color-accent-subtle)',
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        className={`tour-tooltip hud-panel-accent clip-corner-cut-sm p-6 transition-all duration-300 ${
          visible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'
        }`}
        style={
          isCentered
            ? {
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 420,
                maxWidth: 'calc(100vw - 40px)',
              }
            : {
                ...tooltipStyle,
                width: 360,
                maxWidth: 'calc(100vw - 140px)',
              }
        }
      >
        {/* Step icon */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-[var(--color-accent-subtle)] flex items-center justify-center">
            <StepIcon size={22} className="text-[var(--color-accent)]" />
          </div>
          <h2 className="font-hud text-lg text-[var(--color-text-primary)] text-glow">
            {step.title}
          </h2>
        </div>

        {/* Description */}
        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-6">
          {step.description}
        </p>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-5">
          {TOUR_STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentStep(i)}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                i === currentStep
                  ? 'bg-[var(--color-accent)] w-6'
                  : i < currentStep
                    ? 'bg-[var(--color-accent-dim)]'
                    : 'bg-[var(--color-border)]'
              }`}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>

        {/* Actions */}
        {isLast ? (
          <div className="flex flex-col gap-2">
            <button
              onClick={handleSetupAI}
              className="btn-primary w-full py-2.5 px-4 font-hud text-sm"
            >
              Set up AI
            </button>
            <button
              onClick={handleSkipForNow}
              className="w-full py-2 px-4 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            >
              Skip for now
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <button
              onClick={handleSkip}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            >
              Skip tour
            </button>

            <div className="flex items-center gap-2">
              {!isFirst && (
                <button
                  onClick={handleBack}
                  className="px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-lg transition-colors"
                >
                  Back
                </button>
              )}
              <button
                onClick={handleNext}
                className="btn-primary px-4 py-1.5 text-sm font-hud"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
