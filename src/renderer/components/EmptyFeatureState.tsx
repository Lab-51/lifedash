// === FILE PURPOSE ===
// Reusable rich empty state component for pages/widgets with no data.
// Shows an icon, description, benefit list, and CTA button(s).

import { CheckCircle2 } from 'lucide-react';

interface EmptyFeatureStateProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  benefits: string[];
  ctaLabel: string;
  ctaAction: () => void;
  secondaryCta?: { label: string; action: () => void };
  /** Use compact layout for dashboard widgets */
  compact?: boolean;
}

export default function EmptyFeatureState({
  icon: Icon,
  title,
  description,
  benefits,
  ctaLabel,
  ctaAction,
  secondaryCta,
  compact = false,
}: EmptyFeatureStateProps) {
  const iconSize = compact ? 28 : 48;
  const containerSize = compact ? 'w-14 h-14' : 'w-20 h-20';

  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6 px-4' : 'py-10 px-6'} max-w-md mx-auto`}>
      <div className={`${containerSize} rounded-full bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] flex items-center justify-center ${compact ? 'mb-3' : 'mb-5'}`}>
        <Icon size={iconSize} className="text-[var(--color-accent-dim)]" />
      </div>

      <h3 className={`font-hud tracking-wide text-[var(--color-text-primary)] ${compact ? 'text-sm mb-1' : 'text-base mb-2'}`}>
        {title}
      </h3>

      <p className={`text-[var(--color-text-secondary)] leading-relaxed ${compact ? 'text-xs mb-3' : 'text-sm mb-4'}`}>
        {description}
      </p>

      {!compact && (
        <ul className="space-y-1.5 mb-5 text-left">
          {benefits.map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
              <CheckCircle2 size={14} className="text-[var(--color-accent-dim)] mt-0.5 shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}

      <button onClick={ctaAction} className="btn-primary clip-corner-cut-sm px-5 py-2 text-sm font-medium">
        {ctaLabel}
      </button>

      {secondaryCta && (
        <button
          onClick={secondaryCta.action}
          className="mt-2 text-xs text-[var(--color-accent-dim)] hover:text-[var(--color-accent)] transition-colors"
        >
          {secondaryCta.label}
        </button>
      )}
    </div>
  );
}
