// === FILE PURPOSE ===
// Modal shown when a focus (Pomodoro) session completes.
// Lets the user log what they accomplished (saved as a card comment),
// shows XP/level/streak reward feedback, then transitions to break.

import { useEffect, useRef, useState } from 'react';
import { X, CheckCircle, Trophy } from 'lucide-react';
import { useFocusStore } from '../stores/focusStore';
import { useGamificationStore } from '../stores/gamificationStore';
import { toast } from '../hooks/useToast';
import { getTier } from '../../shared/types/gamification';
import type { GamificationStats, Achievement } from '../../shared/types/gamification';
import LevelBadge from './LevelBadge';

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
  const [showReward, setShowReward] = useState(false);
  const [rewardStats, setRewardStats] = useState<GamificationStats | null>(null);
  const [newAchievements, setNewAchievements] = useState<Achievement[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset state and auto-focus textarea when modal opens
  useEffect(() => {
    if (isOpen) {
      setNote('');
      setSaving(false);
      setShowReward(false);
      setRewardStats(null);
      setNewAchievements([]);
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

  const handleSkip = async () => {
    try {
      const { newAchievements: earned } = await useFocusStore.getState().saveSession({
        cardId: focusedCardId || undefined,
        durationMinutes: workDuration,
      });
      // Toast achievements even on skip
      if (earned.length > 0) {
        earned.forEach((a, i) => {
          setTimeout(() => {
            toast(`Achievement Unlocked: ${a.name} — ${a.description}`, 'success', undefined, 5000);
          }, i * 500);
        });
      }
    } catch (error) {
      console.error('Failed to save session on skip:', error);
    }
    useFocusStore.getState().stop();
    useFocusStore.getState().clearFocusedCard();
    onClose();
  };

  const handleStartBreak = () => {
    useFocusStore.getState().startBreak();
    toast(`Break time \u2014 ${breakDuration} min`, 'info');
    onClose();
  };

  const handleSaveAndBreak = async () => {
    setSaving(true);
    try {
      // Save session to persistent storage and get reward data
      const { newAchievements: earned } = await useFocusStore.getState().saveSession({
        cardId: focusedCardId || undefined,
        durationMinutes: workDuration,
        note: note.trim() || undefined,
      });

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

      // Show reward feedback
      setRewardStats(useGamificationStore.getState().stats);
      setNewAchievements(earned);
      setShowReward(true);

      // Toast each new achievement with staggered timing
      if (earned.length > 0) {
        earned.forEach((a, i) => {
          setTimeout(() => {
            toast(`Achievement Unlocked: ${a.name} — ${a.description}`, 'success', undefined, 5000);
          }, i * 500);
        });
      }

      // Auto-transition to break after 2 seconds
      setTimeout(() => {
        handleStartBreak();
      }, 2000);
    } catch (error) {
      console.error('Failed to save focus session:', error);
      toast('Failed to save session', 'error');
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50"
      onClick={showReward ? undefined : handleSkip}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 shadow-xl dark:shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-emerald-400" />
            <h2 className="text-sm font-medium text-surface-800 dark:text-surface-200">Focus Session Complete!</h2>
          </div>
          {!showReward && (
            <button
              onClick={handleSkip}
              className="p-1 rounded-md hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4">
          {showReward ? (
            /* Reward View */
            <div className="text-center space-y-4 py-4">
              {/* XP Earned */}
              <div className="text-3xl font-bold text-emerald-400">
                +{workDuration} XP
              </div>

              {/* Level Progress */}
              {rewardStats && (
                <div>
                  <div className="flex justify-center mb-2">
                    <LevelBadge level={rewardStats.level} size="lg" />
                  </div>
                  <div className="w-48 mx-auto h-2 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getTier(rewardStats.level).colors.text.replace('text-', 'bg-')} rounded-full transition-all duration-1000`}
                      style={{ width: `${rewardStats.xpProgress * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-surface-500 mt-1">
                    {rewardStats.xpNextLevel - rewardStats.totalXp} XP to next level
                  </p>
                </div>
              )}

              {/* Streak */}
              {rewardStats && rewardStats.currentStreak > 0 && (
                <p className="text-amber-400 font-semibold">
                  {rewardStats.currentStreak} day streak!
                </p>
              )}

              {/* New Achievements */}
              {newAchievements.length > 0 && (
                <div className="space-y-2 pt-2">
                  {newAchievements.map(a => (
                    <div key={a.id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                      <span className="text-amber-400">
                        <Trophy size={14} />
                      </span>
                      <span className="text-sm font-medium text-amber-200">{a.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Start Break button */}
              <div className="pt-2">
                <button
                  onClick={handleStartBreak}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-surface-900"
                >
                  Start Break
                </button>
              </div>
            </div>
          ) : (
            /* Default View */
            <>
              {/* Session summary */}
              <div className="text-center py-2">
                <p className="text-surface-800 dark:text-surface-200 text-sm">
                  You focused for <span className="font-semibold text-emerald-400">{workDuration} minutes</span>
                </p>
                <p className="text-surface-400 text-sm mt-1">
                  {focusedCardTitle
                    ? <>on &ldquo;<span className="text-surface-700 dark:text-surface-300">{focusedCardTitle}</span>&rdquo;</>
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
                  className="w-full px-3 py-2 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg text-sm text-surface-800 dark:text-surface-200 placeholder-surface-500 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 resize-none"
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default FocusCompleteModal;
