// === FILE PURPOSE ===
// Placeholder page for the AI Brainstorm view.
// Will be replaced with the AI chat / brainstorming UI in a later phase.

// === DEPENDENCIES ===
// lucide-react (Brain icon)

import { Brain } from 'lucide-react';

function BrainstormPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-surface-100">Brainstorm</h1>
      <p className="mt-1 text-surface-400">
        Use AI to brainstorm and explore ideas.
      </p>

      <div className="mt-12 flex flex-col items-center justify-center text-surface-500">
        <Brain size={48} className="mb-4 text-surface-600" />
        <p className="text-lg">AI brainstorming sessions will appear here</p>
      </div>
    </div>
  );
}

export default BrainstormPage;
