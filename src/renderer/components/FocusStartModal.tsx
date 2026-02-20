// === FILE PURPOSE ===
// Modal for starting a new focus (Pomodoro) session.
// Project-first selection: pick a project, then optionally pick a card from that project.

import { useEffect, useMemo, useState } from 'react';
import { X, Search, Timer, Clock, ArrowRight, DollarSign } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useBoardStore } from '../stores/boardStore';
import { useFocusStore } from '../stores/focusStore';
import { useProjectStore } from '../stores/projectStore';
import { useGamificationStore } from '../stores/gamificationStore';
import { toast } from '../hooks/useToast';

interface FocusStartModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DURATION_PRESETS = [25, 30, 45, 60] as const;

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function FocusStartModal({ isOpen, onClose }: FocusStartModalProps) {
  const navigate = useNavigate();
  const allCards = useBoardStore(s => s.allCards);
  const projects = useProjectStore(s => s.projects);
  const activeProjects = useMemo(() => projects.filter(p => !p.archived), [projects]);
  const workDuration = useFocusStore(s => s.workDuration);
  const breakDuration = useFocusStore(s => s.breakDuration);
  const stats = useGamificationStore(s => s.stats);

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCard, setSelectedCard] = useState<{ id: string; title: string } | null>(null);
  const [duration, setDuration] = useState(workDuration);
  const [isCustom, setIsCustom] = useState(false);

  const selectedProject = useMemo(
    () => activeProjects.find(p => p.id === selectedProjectId) ?? null,
    [activeProjects, selectedProjectId],
  );

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedProjectId('');
      setSearchQuery('');
      setSelectedCard(null);
      setDuration(workDuration);
      setIsCustom(!DURATION_PRESETS.includes(workDuration as typeof DURATION_PRESETS[number]));
    }
  }, [isOpen, workDuration]);

  // Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Cards for the selected project, filtered by search
  const projectCards = useMemo(() => {
    if (!selectedProjectId) return [];
    const cards = allCards.filter(c => !c.archived && !c.completed && c.projectId === selectedProjectId);
    if (!searchQuery.trim()) return cards;
    const q = searchQuery.toLowerCase();
    return cards.filter(c => c.title.toLowerCase().includes(q));
  }, [allCards, selectedProjectId, searchQuery]);

  const handleStart = () => {
    if (duration !== workDuration) {
      useFocusStore.getState().setDurations(duration, breakDuration);
    }
    useFocusStore.getState().startFocus(
      selectedCard?.id ?? null,
      selectedCard?.title ?? null,
    );
    onClose();
    toast(`Focus mode started — ${duration} min`, 'success');
  };

  if (!isOpen) return null;

  const selectCls = 'w-full px-3 py-2 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg text-sm text-surface-800 dark:text-surface-200 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 shadow-xl dark:shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-2">
            <Timer size={16} className="text-emerald-400" />
            <h2 className="text-sm font-medium text-surface-800 dark:text-surface-200">Start Focus Session</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-5">
          {/* Today's quick stats */}
          {stats && stats.focusTodaySessions > 0 && (
            <div className="flex items-center gap-4 px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800/50">
              <div className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
                <Timer size={14} />
                <span className="font-medium">Today:</span>
              </div>
              <span className="text-sm text-emerald-600 dark:text-emerald-400">
                {stats.focusTodaySessions} session{stats.focusTodaySessions !== 1 ? 's' : ''}
              </span>
              <span className="text-sm text-emerald-600 dark:text-emerald-400">
                {formatDuration(stats.focusTodayMinutes)}
              </span>
            </div>
          )}

          {/* Project selector */}
          <div>
            <label className="text-xs text-surface-500 uppercase tracking-wider mb-2 block">
              Project (optional)
            </label>
            <select
              value={selectedProjectId}
              onChange={e => {
                setSelectedProjectId(e.target.value);
                setSelectedCard(null);
                setSearchQuery('');
              }}
              className={selectCls}
            >
              <option value="">No project — general focus</option>
              {activeProjects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.hourlyRate != null ? ` ($${p.hourlyRate}/hr)` : ''}
                </option>
              ))}
            </select>
            {selectedProject?.hourlyRate != null && (
              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <DollarSign size={12} />
                <span>${selectedProject.hourlyRate}/hr — billable time will be tracked</span>
              </div>
            )}
          </div>

          {/* Card selector — only visible when a project is selected */}
          {selectedProjectId && (
            <div>
              <label className="text-xs text-surface-500 uppercase tracking-wider mb-2 block">
                Link a card (optional)
              </label>
              {selectedCard ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-surface-50 dark:bg-surface-800 rounded-lg border border-surface-200 dark:border-surface-700">
                  <span className="text-sm text-surface-800 dark:text-surface-200 truncate flex-1">{selectedCard.title}</span>
                  <button
                    onClick={() => setSelectedCard(null)}
                    className="p-0.5 rounded hover:bg-surface-200 dark:hover:bg-surface-600 text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
                    aria-label="Remove card"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search cards in this project..."
                      className="w-full pl-8 pr-3 py-2 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg text-sm text-surface-800 dark:text-surface-200 placeholder-surface-500 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
                    {projectCards.length > 0 ? (
                      projectCards.map((card) => (
                        <button
                          key={card.id}
                          onClick={() => {
                            setSelectedCard({ id: card.id, title: card.title });
                            setSearchQuery('');
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-100 transition-colors truncate"
                        >
                          {card.title}
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-2 text-xs text-surface-500">
                        {searchQuery ? 'No cards match your search' : 'No cards in this project'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Duration presets */}
          <div>
            <label className="text-xs text-surface-500 uppercase tracking-wider mb-2 block">
              Duration
            </label>
            <div className="flex items-center gap-2">
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => {
                    setDuration(preset);
                    setIsCustom(false);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    !isCustom && duration === preset
                      ? 'bg-primary-600 text-white ring-2 ring-primary-400'
                      : 'bg-surface-50 dark:bg-surface-800 text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700'
                  }`}
                >
                  {preset}m
                </button>
              ))}
              <button
                onClick={() => setIsCustom(true)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  isCustom
                    ? 'bg-primary-600 text-white ring-2 ring-primary-400'
                    : 'bg-surface-50 dark:bg-surface-800 text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700'
                }`}
              >
                Custom
              </button>
            </div>
            {isCustom && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={duration}
                  onChange={(e) => {
                    const val = Math.min(120, Math.max(1, parseInt(e.target.value, 10) || 1));
                    setDuration(val);
                  }}
                  className="w-20 px-3 py-1.5 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg text-sm text-surface-800 dark:text-surface-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
                <span className="text-sm text-surface-500">minutes</span>
              </div>
            )}
          </div>

          {/* Start button */}
          <button
            onClick={handleStart}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 dark:focus:ring-offset-surface-900"
          >
            Start Focus — {duration} min
          </button>

          {/* View Time Report CTA */}
          <button
            onClick={() => {
              onClose();
              navigate('/focus');
            }}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-sm text-surface-500 hover:text-emerald-500 transition-colors"
          >
            <Clock size={14} />
            View Time Report
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default FocusStartModal;
