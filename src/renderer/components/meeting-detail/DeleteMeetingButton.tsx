// Delete meeting button with inline confirmation prompt.

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

interface DeleteMeetingButtonProps {
  onDelete: () => Promise<void>;
}

export default function DeleteMeetingButton({ onDelete }: DeleteMeetingButtonProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="pt-3 border-t border-[var(--color-border)]">
      {confirmDelete ? (
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-surface-600 dark:text-surface-300">Delete this meeting?</span>
          <button
            onClick={onDelete}
            className="text-sm font-medium bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-md transition-colors"
          >
            Yes, delete
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="text-sm font-medium text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-200 px-3 py-1.5 rounded-md transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          className="flex items-center gap-1.5 text-sm font-medium text-surface-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400 px-3 py-1.5 rounded-md transition-colors -ml-3"
        >
          <Trash2 size={16} />
          Delete Meeting
        </button>
      )}
    </div>
  );
}
