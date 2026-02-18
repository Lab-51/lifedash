// === FILE PURPOSE ===
// Modal displaying focus session history — period summary, 30-day chart, and session list.
// Opened from FocusStatsWidget, FocusOverlay, or SidebarModern.

import { useState, useEffect, useCallback } from 'react';
import { X, Timer, Clock, Calendar, CalendarDays, Infinity, ChevronDown } from 'lucide-react';
import type { FocusSessionWithCard, FocusPeriodStats, FocusDailyData } from '../../shared/types/focus';

interface FocusHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 20;

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const PERIOD_CARDS = [
  { key: 'today' as const, label: 'Today', icon: Clock, highlight: true },
  { key: 'thisWeek' as const, label: 'This Week', icon: Calendar, highlight: false },
  { key: 'thisMonth' as const, label: 'This Month', icon: CalendarDays, highlight: false },
  { key: 'allTime' as const, label: 'All Time', icon: Infinity, highlight: false },
];

export default function FocusHistoryModal({ isOpen, onClose }: FocusHistoryModalProps) {
  const [periodStats, setPeriodStats] = useState<FocusPeriodStats | null>(null);
  const [sessions, setSessions] = useState<FocusSessionWithCard[]>([]);
  const [totalSessions, setTotalSessions] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    Promise.all([
      window.electronAPI.focusGetPeriodStats(),
      window.electronAPI.focusGetHistory({ offset: 0, limit: PAGE_SIZE }),
    ]).then(([stats, history]) => {
      setPeriodStats(stats);
      setSessions(history.sessions);
      setTotalSessions(history.total);
      setLoading(false);
    });
  }, [isOpen]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    const result = await window.electronAPI.focusGetHistory({
      offset: sessions.length,
      limit: PAGE_SIZE,
    });
    setSessions(prev => [...prev, ...result.sessions]);
    setLoadingMore(false);
  }, [sessions.length]);

  if (!isOpen) return null;

  const dailyData: FocusDailyData[] = periodStats?.dailyData ?? [];
  const maxMinutes = Math.max(...dailyData.map(d => d.minutes), 1);
  const totalChartMinutes = dailyData.reduce((sum, d) => sum + d.minutes, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700 shadow-xl dark:shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-surface-700 shrink-0">
          <div className="flex items-center gap-2">
            <Timer size={18} className="text-emerald-500" />
            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Focus History</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content — single scrollable area */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {loading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-20 bg-surface-100 dark:bg-surface-800 rounded-lg animate-pulse" />
                ))}
              </div>
              <div className="h-32 bg-surface-100 dark:bg-surface-800 rounded-lg animate-pulse" />
            </div>
          ) : (
            <>
              {/* Period Summary Cards */}
              {periodStats && (
                <div className="grid grid-cols-4 gap-3">
                  {PERIOD_CARDS.map(({ key, label, icon: Icon, highlight }) => {
                    const bucket = periodStats[key];
                    return (
                      <div
                        key={key}
                        className={`rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 p-3 ${
                          highlight ? 'border-l-2 border-l-emerald-500' : ''
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Icon size={14} className={highlight ? 'text-emerald-500' : 'text-surface-400'} />
                          <span className="text-xs font-medium text-surface-500">{label}</span>
                        </div>
                        <p className="text-lg font-bold text-surface-900 dark:text-surface-100">
                          {formatDuration(bucket.minutes)}
                        </p>
                        <p className="text-xs text-surface-400">
                          {bucket.sessions} session{bucket.sessions !== 1 ? 's' : ''}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 30-Day Activity Chart */}
              {dailyData.length > 0 && (
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 p-4">
                  <div className="flex items-end gap-px h-24">
                    {dailyData.map((day) => {
                      const height = day.minutes > 0
                        ? Math.max((day.minutes / maxMinutes) * 100, 4)
                        : 2;
                      const date = new Date(day.date);
                      const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                      return (
                        <div
                          key={day.date}
                          className="flex-1 rounded-t-sm transition-all duration-200 hover:opacity-80 cursor-default"
                          style={{
                            height: `${height}%`,
                            backgroundColor: day.minutes > 0
                              ? 'rgb(16 185 129)'
                              : 'var(--color-surface-300)',
                          }}
                          title={`${dayLabel}: ${day.minutes} min (${day.sessions} session${day.sessions !== 1 ? 's' : ''})`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex gap-px mt-1">
                    {dailyData.map((day, i) => (
                      <div key={day.date} className="flex-1 text-center">
                        {i % 5 === 0 ? (
                          <span className="text-[8px] text-surface-500">
                            {new Date(day.date).getDate()}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-surface-200 dark:border-surface-700">
                    <span className="text-xs text-surface-500 font-medium">30-Day Activity</span>
                    <span className="text-xs text-surface-400">{formatDuration(totalChartMinutes)} total</span>
                  </div>
                </div>
              )}

              {/* Session History */}
              <div>
                <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">
                  Session History
                </h3>
                {sessions.length === 0 ? (
                  <div className="text-center py-8 text-surface-500">
                    <Timer size={32} className="mx-auto mb-2 text-surface-400" />
                    <p>No focus sessions yet.</p>
                    <p className="text-sm mt-1">Start one to begin tracking!</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {sessions.map((session) => (
                      <div
                        key={session.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
                      >
                        {/* Date */}
                        <span className="text-xs text-surface-500 w-20 shrink-0">
                          {formatRelativeDate(session.completedAt)}
                        </span>
                        {/* Duration */}
                        <span className="flex items-center gap-1 text-sm font-medium text-surface-900 dark:text-surface-100 w-16 shrink-0">
                          <Timer size={12} className="text-emerald-500" />
                          {session.durationMinutes} min
                        </span>
                        {/* Card name */}
                        <span className="text-xs text-surface-400 truncate flex-1 min-w-0">
                          {session.cardTitle || 'No card'}
                        </span>
                        {/* Note preview */}
                        {session.note && (
                          <span className="text-xs text-surface-400 truncate max-w-[160px]">
                            {session.note}
                          </span>
                        )}
                      </div>
                    ))}

                    {/* Load More */}
                    {sessions.length < totalSessions && (
                      <div className="text-center pt-2">
                        <button
                          onClick={loadMore}
                          disabled={loadingMore}
                          className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors disabled:opacity-50"
                        >
                          <ChevronDown size={14} />
                          {loadingMore ? 'Loading...' : `Load More (${totalSessions - sessions.length} remaining)`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
