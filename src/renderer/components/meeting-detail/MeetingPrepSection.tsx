// Collapsible meeting prep briefing section — shows AI-generated prep notes.

import { useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardList } from 'lucide-react';
import { renderPrepLine } from './utils';

interface MeetingPrepSectionProps {
  prepBriefing: string;
}

export default function MeetingPrepSection({ prepBriefing }: MeetingPrepSectionProps) {
  const [showPrep, setShowPrep] = useState(false);

  if (!prepBriefing || prepBriefing.trim() === '') return null;

  return (
    <div className="mb-5">
      <button
        type="button"
        onClick={() => setShowPrep(!showPrep)}
        className="w-full flex items-center justify-between gap-2 mb-2 group"
      >
        <h3 className="text-sm font-medium text-surface-400 flex items-center gap-1.5">
          <ClipboardList size={14} />
          Meeting Prep
        </h3>
        {showPrep ? (
          <ChevronDown
            size={16}
            className="text-surface-500 group-hover:text-surface-700 dark:text-surface-300 transition-colors"
          />
        ) : (
          <ChevronRight
            size={16}
            className="text-surface-500 group-hover:text-surface-700 dark:text-surface-300 transition-colors"
          />
        )}
      </button>
      {showPrep && (
        <div className="bg-surface-100/50 dark:bg-surface-800/30 border border-surface-200 dark:border-surface-700/50 rounded-lg p-3">
          <div className="space-y-0.5">{prepBriefing.split('\n').map(renderPrepLine)}</div>
        </div>
      )}
    </div>
  );
}
