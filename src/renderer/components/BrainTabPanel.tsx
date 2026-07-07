// === FILE PURPOSE ===
// Brain canvas tab — V3.2 placeholder shared between SessionWorkspace and
// LiveModeOverlay (Task 4 extraction of Task 2's local panel). No graph is built
// yet; the living mind-map graph arrives in V3.2.
//
// === DEPENDENCIES ===
// lucide-react

import { Network } from 'lucide-react';

export default function BrainTabPanel() {
  return (
    <div
      role="tabpanel"
      id="panel-brain"
      aria-labelledby="tab-brain"
      className="flex-1 flex flex-col items-center justify-center text-center py-16 px-6"
    >
      <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] flex items-center justify-center mb-5">
        <Network size={28} className="text-[var(--color-accent-dim)]" />
      </div>
      <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-1.5">Brain</h3>
      <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">The living graph arrives in V3.2.</p>
    </div>
  );
}
