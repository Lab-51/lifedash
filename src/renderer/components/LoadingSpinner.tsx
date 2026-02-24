// === FILE PURPOSE ===
// Animated spinner for loading states. Renders a spinning Loader2 icon
// centered in its container with an optional text label below.

// === DEPENDENCIES ===
// lucide-react (Loader2)

import { Loader2 } from 'lucide-react';

const sizeMap = {
  sm: 16,
  md: 24,
  lg: 32,
} as const;

interface LoadingSpinnerProps {
  /** Spinner diameter: sm (16px), md (24px), lg (32px). Defaults to 'md'. */
  size?: 'sm' | 'md' | 'lg';
  /** Optional accessible label shown below the spinner. */
  label?: string;
}

function LoadingSpinner({ size = 'md', label }: LoadingSpinnerProps) {
  const px = sizeMap[size];

  return (
    <div className="flex flex-col items-center justify-center gap-3" role="status">
      <Loader2
        size={px}
        className="animate-spin text-[var(--color-accent)]"
        aria-hidden="true"
      />
      {label && (
        <span className="text-sm text-[var(--color-text-secondary)] font-data">{label}</span>
      )}
      {/* Screen-reader-only fallback when no visible label */}
      {!label && <span className="sr-only">Loading...</span>}
    </div>
  );
}

export default LoadingSpinner;
