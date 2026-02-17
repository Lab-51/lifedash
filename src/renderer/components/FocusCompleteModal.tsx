// === FILE PURPOSE ===
// Modal shown when a focus (Pomodoro) session completes.
// Lets the user log what they accomplished (saved as a card comment)
// and either start a break or skip.

import { useEffect, useRef, useState } from 'react';
import { X, CheckCircle } from 'lucide-react';
import { useFocusStore } from '../stores/focusStore';
import { toast } from '../hooks/useToast';

interface FocusCompleteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function FocusCompleteModal({ isOpen, onClose }: FocusCompleteModalProps) {
  const workDuration = useFocusStore(s => s.workDuration);
  const breakDuration = useFocusStore(s => s.breakDuration);
  const focusedCardId = useFocusStore(s => s.focusedCardId);
  const focusedCardTitle = useFocusStore(s => s.focusedCardTitle);
  const sessionCount = useFocusStore(s => s.sessionCount);

  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset state and auto-focus textarea when modal opens
  useEffect(() => {
    if (isOpen) {
      setNote('');
      setSaving(false);
      // Small delay so the DOM element is rendered before focusing
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Escape key acts as Skip
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleSkip();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleSkip = () => {
    useFocusStore.getState().stop();
    useFocusStore.getState().clearFocusedCard();
    onClose();
  };

  const handleSaveAndBreak = async () => {
    setSaving(true);
    try {
      // Log comment to the linked card if one exists
      if (focusedCardId) {
        const trimmed = note.trim();
        const content = trimmed
          ? `\uD83C\uDF45 Focus session completed (${workDuration} min)\n\n${trimmed}`
          : `\uD83C\uDF45 Focus session completed (${workDuration} min)`;

        await window.electronAPI.addCardComment({
          cardId: focusedCardId,
          content,
        });
      }

      useFocusStore.getState().startBreak();
      toast(`Break time \u2014 ${breakDuration} min`, 'info');
      onClose();
    } catch (error) {
      console.error('Failed to save focus session comment:', error);
      toast('Failed to save session note', 'error');
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleSkip}
    >
      <div
        className="w-full max-w-md bg-surface-900 rounded-xl border border-surface-700 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-emerald-400" />
            <h2 className="text-sm font-medium text-surface-200">Focus Session Complete!</h2>
          </div>
          <button
            onClick={handleSkip}
            className="p-1 rounded-md hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4">
          {/* Session summary */}
          <div className="text-center py-2">
            <p className="text-surface-200 text-sm">
              You focused for <span className="font-semibold text-emerald-400">{workDuration} minutes</span>
            </p>
            <p className="text-surface-400 text-sm mt-1">
              {focusedCardTitle
                ? <>on &ldquo;<span className="text-surface-300">{focusedCardTitle}</span>&rdquo;</>
                : 'General focus'
              }
            </p>
          </div>

          {/* Accomplishment note */}
          <div>
            <label className="text-xs text-surface-500 uppercase tracking-wider mb-2 block">
              What did you accomplish?
            </label>
            <textarea
              ref={textareaRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="What did you accomplish during this session?"
              className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 resize-none"
            />
          </div>

          {/* Session count */}
          <p className="text-xs text-surface-500 text-center">
            Session #{sessionCount} today
          </p>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={handleSkip}
              disabled={saving}
              className="px-4 py-2 text-sm text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-50"
            >
              Skip
            </button>
            <button
              onClick={handleSaveAndBreak}
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-surface-900 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save & Start Break'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FocusCompleteModal;
