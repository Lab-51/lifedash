// === FILE PURPOSE ===
// Reusable level badge component that renders a tier-styled pill showing
// the player's level number and optional tier name. Supports three sizes
// and automatically applies the tier's colors, glow, gradient, and shimmer
// animation (for Divine/Ultimate tiers 21-30).

import { getTier } from '../../shared/types/gamification';

// Inject shimmer keyframes into document.head once at module load
if (typeof document !== 'undefined' && !document.getElementById('level-badge-shimmer-style')) {
  const style = document.createElement('style');
  style.id = 'level-badge-shimmer-style';
  style.textContent = `@keyframes level-badge-shimmer { 0% { background-position: 200% center; } 100% { background-position: -200% center; } }`;
  document.head.appendChild(style);
}

interface LevelBadgeProps {
  level: number;
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'h-5 text-[0.625rem] px-2 gap-1',
  md: 'h-6 text-xs px-2.5 gap-1.5',
  lg: 'h-8 text-sm px-3 gap-1.5',
} as const;

export default function LevelBadge({ level, size = 'md', showName = true, className = '' }: LevelBadgeProps) {
  const tier = getTier(level);

  // Determine background: gradient (inline style) or Tailwind bg class
  const bgStyle: React.CSSProperties = {};
  let bgClass = '';

  if (tier.colors.gradient) {
    bgStyle.background = tier.colors.gradient;
    if (tier.animate) {
      bgStyle.backgroundSize = '200% 100%';
      bgStyle.animation = tier.family === 'ultimate'
        ? 'level-badge-shimmer 2s ease infinite'
        : 'level-badge-shimmer 3s ease infinite';
    }
  } else {
    bgClass = tier.colors.bg;
  }

  // Glow effect
  if (tier.colors.glow) {
    bgStyle.boxShadow = tier.colors.glow;
  }

  return (
    <div
      className={`inline-flex items-center rounded-full border font-bold ${SIZE_CLASSES[size]} ${bgClass} ${tier.colors.border} ${tier.colors.text} ${className}`}
      style={bgStyle}
    >
      <span className="animate-data-flicker">Lv.{level}</span>
      {showName && <span className="font-medium opacity-80">{tier.name}</span>}
    </div>
  );
}
