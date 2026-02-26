// === FILE PURPOSE ===
// Small inline PRO badge shown next to feature labels that require a Pro license.
// Renders a compact, accent-colored tag consistent with the HUD design system.

export function ProBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-hud
      tracking-wider uppercase border border-[var(--color-accent)]/30
      text-[var(--color-accent)] rounded">
      PRO
    </span>
  );
}
