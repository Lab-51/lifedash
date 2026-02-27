// === FILE PURPOSE ===
// Modal shown when a focus (Pomodoro) session completes.
// Lets the user log what they accomplished (saved as a card comment),
// shows XP/level/streak reward feedback, then transitions to break.

import { useEffect, useRef, useState } from 'react';
import { X, CheckCircle, Trophy } from 'lucide-react';
import { useFocusStore } from '../stores/focusStore';
import { useGamificationStore } from '../stores/gamificationStore';
import { useProjectStore } from '../stores/projectStore';
import { billableHours } from '../../shared/utils/billing';
import { useBoardStore } from '../stores/boardStore';
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
  const completedDuration = useFocusStore(s => s.completedDuration);
  const breakDuration = useFocusStore(s => s.breakDuration);
  const focusedCardId = useFocusStore(s => s.focusedCardId);
  const focusedCardTitle = useFocusStore(s => s.focusedCardTitle);
  const focusedProjectId = useFocusStore(s => s.focusedProjectId);
  const sessionCount = useFocusStore(s => s.sessionCount);

  // Use completedDuration (actual elapsed time) — falls back to workDuration for safety
  const actualDuration = completedDuration || workDuration;

  const allCards = useBoardStore(s => s.allCards);
  const projects = useProjectStore(s => s.projects);

  const [note, setNote] = useState('');
  const [billable, setBillable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showReward, setShowReward] = useState(false);
  const [rewardStats, setRewardStats] = useState<GamificationStats | null>(null);
  const [newAchievements, setNewAchievements] = useState<Achievement[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Look up hourly rate: prefer direct projectId, fall back to card's project
  const focusedProject = (() => {
    if (focusedProjectId) return projects.find(p => p.id === focusedProjectId) ?? null;
    if (!focusedCardId) return null;
    const card = allCards.find(c => c.id === focusedCardId);
    if (!card) return null;
    return projects.find(p => p.id === card.projectId) ?? null;
  })();
  const hourlyRate = focusedProject?.hourlyRate ?? null;

  // Reset state and auto-focus textarea when modal opens
  useEffect(() => {
    if (isOpen) {
      setNote('');
      setBillable(true);
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
        projectId: focusedProjectId || undefined,
        durationMinutes: actualDuration,
        billable,
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
      toast('Failed to save session', 'error');
    }
    // stop() resets mode to 'idle' which closes this modal (isOpen={mode==='completed'})
    // and also clears focusedCard — no separate onClose/clearFocusedCard needed
    useFocusStore.getState().stop();
  };

  const handleStartBreak = () => {
    useFocusStore.getState().startBreak();
    toast(`Break time \u2014 ${breakDuration} min`, 'info');
    // startBreak() sets mode to 'break', which closes this modal automatically.
    // Do NOT call onClose/stop here — that would immediately kill the break timer.
  };

  const willBreakRef = useRef(false);

  const doSave = async (startBreak: boolean) => {
    setSaving(true);
    willBreakRef.current = startBreak;
    try {
      const { newAchievements: earned } = await useFocusStore.getState().saveSession({
        cardId: focusedCardId || undefined,
        projectId: focusedProjectId || undefined,
        durationMinutes: actualDuration,
        note: note.trim() || undefined,
        billable,
      });

      if (focusedCardId) {
        const trimmed = note.trim();
        const content = trimmed
          ? `\uD83C\uDF45 Focus session completed (${actualDuration} min)\n\n${trimmed}`
          : `\uD83C\uDF45 Focus session completed (${actualDuration} min)`;
        await window.electronAPI.addCardComment({ cardId: focusedCardId, content });
      }

      setRewardStats(useGamificationStore.getState().stats);
      setNewAchievements(earned);
      setShowReward(true);

      if (earned.length > 0) {
        earned.forEach((a, i) => {
          setTimeout(() => {
            toast(`Achievement Unlocked: ${a.name} — ${a.description}`, 'success', undefined, 5000);
          }, i * 500);
        });
      }

      setTimeout(() => {
        if (willBreakRef.current) {
          handleStartBreak();
        } else {
          useFocusStore.getState().stop();
        }
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
        className="w-full max-w-md hud-panel-accent clip-corner-cut shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border-accent)]">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-[var(--color-accent)]" />
            <h2 className="font-hud text-xs text-[var(--color-accent)] text-glow">Focus Session Complete!</h2>
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
              <div className="font-data text-3xl font-bold text-[var(--color-accent)] text-glow">
                +{actualDuration} XP
              </div>

              {/* Level Progress */}
              {rewardStats && (
                <div>
                  <div className="flex justify-center mb-2">
                    <LevelBadge level={rewardStats.level} size="lg" />
                  </div>
                  <div className="w-48 mx-auto h-2 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getTier(rewardStats.level).colors.text} rounded-full transition-all duration-1000`}
                      style={{ width: `${rewardStats.xpProgress * 100}%`, backgroundColor: 'currentColor' }}
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
                  className="px-4 py-2 bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] rounded-lg text-sm font-medium transition-colors"
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
                  You focused for <span className="font-semibold text-emerald-400">{actualDuration} minutes</span>
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
                  className="w-full text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] resize-none"
                />
              </div>

              {/* Billable toggle + cost preview */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <button
                    type="button"
                    onClick={() => setBillable(!billable)}
                    className={`relative w-9 h-5 rounded-full transition-colors ${billable ? 'bg-emerald-500' : 'bg-surface-300 dark:bg-surface-600'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${billable ? 'translate-x-4' : ''}`} />
                  </button>
                  <span className="text-sm text-surface-600 dark:text-surface-400">Billable</span>
                </label>
                {hourlyRate != null && billable && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">
                    ~${(billableHours(actualDuration) * hourlyRate).toFixed(2)} ({actualDuration}m → {billableHours(actualDuration)}h @ ${hourlyRate}/hr)
                  </span>
                )}
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
                  className="px-4 py-2 text-sm text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors disabled:opacity-50"
                >
                  Skip
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => doSave(false)}
                    disabled={saving}
                    className="px-4 py-2 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => doSave(true)}
                    disabled={saving}
                    className="px-4 py-2 bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save & Break'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default FocusCompleteModal;
