// === FILE PURPOSE ===
// Slim banner shown above a session's Board tab when it is temporarily showing a
// FOREIGN project (the "viewed-project override", STORY-PROJECTS-IN-SESSION). Since
// projects have no standalone destination anymore, opening another project from
// inside a session (e.g. a Brain "Everything"-scope card) surfaces it in THIS
// session's board with this banner + a real Back button — never a navigation away.
// Shared by both hosts (SessionWorkspace + LiveModeOverlay).

import { ArrowLeft } from 'lucide-react';

export default function ViewingProjectBanner({ projectName, onBack }: { projectName: string; onBack: () => void }) {
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-1.5 text-xs bg-[var(--color-accent-subtle)] border-b border-[var(--color-border-accent)]">
      <span className="min-w-0 truncate text-[var(--color-text-secondary)]">
        Viewing <span className="font-medium text-[var(--color-text-primary)]">{projectName}</span>
      </span>
      <button
        type="button"
        onClick={onBack}
        className="ml-auto shrink-0 flex items-center gap-1 font-medium text-[var(--color-accent)] hover:underline"
      >
        <ArrowLeft size={12} />
        Back to this session&apos;s board
      </button>
    </div>
  );
}
