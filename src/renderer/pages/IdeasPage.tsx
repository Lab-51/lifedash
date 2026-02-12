// === FILE PURPOSE ===
// Placeholder page for the Ideas repository view.
// Will be replaced with the idea capture and browsing UI in a later phase.

// === DEPENDENCIES ===
// lucide-react (Lightbulb icon)

import { Lightbulb } from 'lucide-react';

function IdeasPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-surface-100">Ideas</h1>
      <p className="mt-1 text-surface-400">
        Capture and organize your ideas in one place.
      </p>

      <div className="mt-12 flex flex-col items-center justify-center text-surface-500">
        <Lightbulb size={48} className="mb-4 text-surface-600" />
        <p className="text-lg">Your idea repository will appear here</p>
      </div>
    </div>
  );
}

export default IdeasPage;
