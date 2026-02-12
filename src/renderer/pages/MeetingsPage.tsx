// === FILE PURPOSE ===
// Placeholder page for the Meetings view.
// Will be replaced with meeting recorder and transcript list in a later phase.

// === DEPENDENCIES ===
// lucide-react (Mic icon)

import { Mic } from 'lucide-react';

function MeetingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-surface-100">Meetings</h1>
      <p className="mt-1 text-surface-400">
        Record, transcribe, and review your meetings.
      </p>

      <div className="mt-12 flex flex-col items-center justify-center text-surface-500">
        <Mic size={48} className="mb-4 text-surface-600" />
        <p className="text-lg">Meeting recordings and transcripts will appear here</p>
      </div>
    </div>
  );
}

export default MeetingsPage;
