// === FILE PURPOSE ===
// Shared canvas tab strip (Transcript | Board | Brain) — extracted from
// SessionWorkspace's local `CanvasTabs` (Task 2) so LiveModeOverlay (Task 4) and
// SessionWorkspace both render the SAME tablist instead of forking two
// implementations. Proper tablist: roving tabindex + arrow-key nav + aria wiring,
// plus an optional per-tab count badge (canvasBadgeStore) — the badge is a signal
// only, this component never switches tabs on its own.
//
// === DEPENDENCIES ===
// react

/** The three canvas surfaces every session (live or post-hoc) can switch between. */
export type CanvasTabId = 'transcript' | 'board' | 'brain';

export interface CanvasTabDef {
  id: CanvasTabId;
  label: string;
  /** Optional per-tab count badge (canvasBadgeStore); never auto-switches tabs. */
  badge?: number;
}

interface LiveCanvasTabsProps {
  tabs: CanvasTabDef[];
  active: CanvasTabId;
  onSelect: (id: CanvasTabId) => void;
}

export default function LiveCanvasTabs({ tabs, active, onSelect }: LiveCanvasTabsProps) {
  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    onSelect(tabs[(idx + dir + tabs.length) % tabs.length].id);
  };

  return (
    <div
      role="tablist"
      aria-label="Session canvas"
      className="flex items-center gap-1 border-b border-[var(--color-border)]"
    >
      {tabs.map((tab, idx) => {
        const isActive = tab.id === active;
        const showBadge = tab.badge != null && tab.badge > 0;
        return (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-hud tracking-wide transition-colors -mb-px border-b-2 ${
              isActive
                ? 'text-[var(--color-accent)] border-[var(--color-accent)] text-glow'
                : 'text-[var(--color-text-secondary)] border-transparent hover:text-[var(--color-text-primary)]'
            }`}
          >
            {tab.label}
            {showBadge && (
              <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-chrome)] font-data text-[0.6rem] font-bold leading-none">
                {tab.badge! > 9 ? '9+' : tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
