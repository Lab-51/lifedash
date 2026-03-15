import { useFontScale } from '../hooks/useFontScale';
import type { FontScale } from '../hooks/useFontScale';

const FONT_SCALE_OPTIONS: { scale: FontScale; label: string }[] = [
  { scale: '14', label: 'Small' },
  { scale: '16', label: 'Default' },
  { scale: '18', label: 'Large' },
  { scale: '20', label: 'Extra Large' },
];

export default function FontScaleSelector() {
  const { fontScale, setFontScale } = useFontScale();

  return (
    <div className="flex gap-3">
      {FONT_SCALE_OPTIONS.map(({ scale, label }) => (
        <button
          key={scale}
          onClick={() => setFontScale(scale)}
          className={`flex-1 p-3 rounded-lg border text-center transition-all ${
            fontScale === scale
              ? 'border-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)] shadow-[0_0_12px_var(--color-chrome-glow)]'
              : 'border-[var(--color-border)] bg-[var(--color-chrome)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)]'
          }`}
        >
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{scale}px</div>
        </button>
      ))}
    </div>
  );
}
