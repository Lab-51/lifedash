// === FILE PURPOSE ===
// Full page for focus time tracking — project filtering, stats, activity chart,
// session list with date grouping, and CSV export.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Timer, Download, Play, Clock, Calendar, BarChart3 } from 'lucide-react';
import { useProjectStore } from '../stores/projectStore';
import { useFocusStore } from '../stores/focusStore';
import type { FocusTimeReport, FocusSessionFull } from '../../shared/types/focus';

type Period = 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom';

function getMonday(d: Date): Date {
  const day = d.getDay();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + (day === 0 ? -6 : 1));
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function periodRange(period: Period, cs: string, ce: string): [string, string] {
  const now = new Date();
  if (period === 'thisWeek') return [toISO(getMonday(now)), toISO(now)];
  if (period === 'thisMonth') return [toISO(new Date(now.getFullYear(), now.getMonth(), 1)), toISO(now)];
  if (period === 'lastMonth') {
    return [toISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)), toISO(new Date(now.getFullYear(), now.getMonth(), 0))];
  }
  return [cs || toISO(now), ce || toISO(now)];
}

function daysInRange(s: string, e: string): number {
  return Math.max(Math.floor((new Date(e).getTime() - new Date(s).getTime()) / 86_400_000) + 1, 1);
}

function fmt(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
function fmtDateHdr(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function exportCSV(sessions: FocusSessionFull[], startDate: string, endDate: string, projectName?: string) {
  const hdr = ['Date', 'Time', 'Duration (min)', 'Project', 'Card', 'Note'];
  const rows = sessions.map(s => {
    const dt = new Date(s.completedAt);
    return [
      dt.toLocaleDateString('en-US'),
      dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      String(s.durationMinutes), s.projectName || 'No project',
      s.cardTitle || '', (s.note || '').replace(/,/g, ';'),
    ].join(',');
  });
  const blob = new Blob([[hdr.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const sfx = projectName ? `-${projectName.toLowerCase().replace(/\s+/g, '-')}` : '';
  a.download = `focus-report-${startDate}-to-${endDate}${sfx}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'thisWeek', label: 'This Week' }, { key: 'thisMonth', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' }, { key: 'custom', label: 'Custom' },
];
const PAGE = 50;
const cardCls = 'bg-white dark:bg-surface-900/50 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm';
const inputCls = 'px-2 py-1.5 text-sm rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100';

export default function FocusPage() {
  const projects = useProjectStore(s => s.projects);
  const activeProjects = useMemo(() => projects.filter(p => !p.archived), [projects]);

  const [report, setReport] = useState<FocusTimeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('thisWeek');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [projectId, setProjectId] = useState('');
  const [displayCount, setDisplayCount] = useState(PAGE);

  const focusMode = useFocusStore(s => s.mode);
  const lastSavedAt = useFocusStore(s => s.lastSavedAt);

  const [startDate, endDate] = periodRange(period, customStart, customEnd);
  const totalDays = daysInRange(startDate, endDate);

  useEffect(() => {
    if (focusMode !== 'idle') return; // don't fetch while in focus/break/completed
    let cancelled = false;
    setLoading(true);
    setDisplayCount(PAGE);
    window.electronAPI
      .focusGetTimeReport({ startDate, endDate, projectId: projectId || undefined })
      .then(data => { if (!cancelled) setReport(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [startDate, endDate, projectId, focusMode, lastSavedAt]);

  const grouped = useMemo(() => {
    if (!report) return [];
    const map = new Map<string, FocusSessionFull[]>();
    for (const s of report.sessions) {
      const d = s.completedAt.slice(0, 10);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(s);
    }
    return [...map.entries()].map(([date, sessions]) => ({ date, label: fmtDateHdr(date), sessions }));
  }, [report]);

  const allSessions = report?.sessions ?? [];
  const handleExport = useCallback(() => {
    if (!report || !report.sessions.length) return;
    exportCSV(report.sessions, startDate, endDate, projectId ? activeProjects.find(p => p.id === projectId)?.name : undefined);
  }, [report, projectId, activeProjects, startDate, endDate]);

  const summary = report?.summary;
  const daily = report?.dailyData ?? [];
  const maxMin = Math.max(...daily.map(d => d.minutes), 1);
  const totalChart = daily.reduce((s, d) => s + d.minutes, 0);

  // Controls bar (inline to save lines)
  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
        {PERIODS.map(({ key, label }) => (
          <button key={key} onClick={() => setPeriod(key)} className={`px-3 py-1.5 text-sm font-medium transition-colors ${period === key ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-surface-900 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'}`}>
            {label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="flex items-center gap-2">
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className={inputCls} />
          <span className="text-surface-400 text-sm">to</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className={inputCls} />
        </div>
      )}
      <select value={projectId} onChange={e => setProjectId(e.target.value)} className={`px-3 py-1.5 text-sm rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100`}>
        <option value="">All Projects</option>
        {activeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button onClick={() => useFocusStore.getState().setShowStartModal(true)} className="ml-auto inline-flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors">
        <Play size={14} /> Start Focus
      </button>
    </div>
  );

  const header = (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <Timer size={22} className="text-emerald-500" />
        <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100">Focus Time Tracking</h1>
      </div>
      <button onClick={handleExport} disabled={!report || !allSessions.length} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-surface-200 dark:border-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        <Download size={15} /> Export CSV
      </button>
    </div>
  );

  // Empty state
  if (!loading && summary && summary.totalSessions === 0) {
    return (
      <div className="p-6 space-y-6 max-w-6xl mx-auto w-full">
        {header}
        {controls}
        <div className={`${cardCls} p-12 text-center`}>
          <Timer size={44} className="mx-auto mb-4 text-surface-300 dark:text-surface-600" />
          <p className="text-lg font-medium text-surface-900 dark:text-surface-100">No focus sessions in this period</p>
          <p className="text-sm text-surface-500 mt-2 max-w-md mx-auto">Try selecting a different date range or start a new focus session.</p>
          <button onClick={() => useFocusStore.getState().setShowStartModal(true)} className="mt-5 inline-flex items-center gap-1.5 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors">
            <Play size={14} /> Start Focus Session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto w-full overflow-y-auto">
      {header}
      {controls}

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {[0,1,2,3].map(i => <div key={i} className="h-20 bg-surface-100 dark:bg-surface-800 rounded-2xl animate-pulse" />)}
          </div>
          <div className="h-40 bg-surface-100 dark:bg-surface-800 rounded-2xl animate-pulse" />
          <div className="h-32 bg-surface-100 dark:bg-surface-800 rounded-2xl animate-pulse" />
        </div>
      ) : summary ? (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-4">
            {([
              ['Total Sessions', String(summary.totalSessions), <BarChart3 key="b" size={16} className="text-emerald-500" />],
              ['Total Time', fmt(summary.totalMinutes), <Clock key="c" size={16} className="text-emerald-500" />],
              ['Avg Session', `${summary.avgSessionMinutes}m`, <Timer key="t" size={16} className="text-emerald-500" />],
              ['Active Days', `${summary.activeDays} of ${totalDays}`, <Calendar key="d" size={16} className="text-emerald-500" />],
            ] as [string, string, React.ReactNode][]).map(([label, value, icon]) => (
              <div key={label} className={`${cardCls} p-4`}>
                <div className="flex items-center gap-1.5 mb-1">{icon}<span className="text-xs font-medium text-surface-500 uppercase tracking-wider">{label}</span></div>
                <p className="text-2xl font-bold text-surface-900 dark:text-surface-100">{value}</p>
              </div>
            ))}
          </div>

          {/* Project Breakdown */}
          {!projectId && report!.projectBreakdown.length > 0 && (
            <div className={`${cardCls} p-5`}>
              <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">Project Breakdown</h3>
              <div className="space-y-3">
                {report!.projectBreakdown.map(pb => {
                  const pct = summary.totalMinutes > 0 ? (pb.minutes / summary.totalMinutes) * 100 : 0;
                  return (
                    <div key={pb.projectId ?? '_none'} className="flex items-center gap-3">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: pb.projectColor || '#94a3b8' }} />
                      <span className="text-sm text-surface-900 dark:text-surface-100 w-36 truncate shrink-0">{pb.projectName || 'No project'}</span>
                      <div className="flex-1 h-2.5 bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: pb.projectColor || '#94a3b8' }} />
                      </div>
                      <span className="text-sm font-medium text-surface-900 dark:text-surface-100 w-20 text-right shrink-0">{fmt(pb.minutes)}</span>
                      <span className="text-xs text-surface-500 w-20 text-right shrink-0">{pb.sessions} session{pb.sessions !== 1 ? 's' : ''}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Activity Chart */}
          {daily.length > 0 && (
            <div className={`${cardCls} p-5`}>
              <div className="flex items-end gap-px h-28">
                {daily.map(day => {
                  const h = day.minutes > 0 ? Math.max((day.minutes / maxMin) * 100, 4) : 2;
                  const tip = new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                  return <div key={day.date} className="flex-1 rounded-t-sm transition-all duration-200 hover:opacity-80 cursor-default" style={{ height: `${h}%`, backgroundColor: day.minutes > 0 ? 'rgb(16 185 129)' : 'var(--color-surface-300)' }} title={`${tip}: ${day.minutes} min (${day.sessions} session${day.sessions !== 1 ? 's' : ''})`} />;
                })}
              </div>
              <div className="flex gap-px mt-1">
                {daily.map((day, i) => {
                  const iv = Math.max(Math.floor(daily.length / 10), 1);
                  return <div key={day.date} className="flex-1 text-center">{i % iv === 0 ? <span className="text-[8px] text-surface-500">{new Date(day.date).getDate()}</span> : null}</div>;
                })}
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-surface-200 dark:border-surface-700">
                <span className="text-xs text-surface-500 font-medium">{daily.length}-Day Activity</span>
                <span className="text-xs text-surface-400">{fmt(totalChart)} total</span>
              </div>
            </div>
          )}

          {/* Session List */}
          <div className={`${cardCls} p-5`}>
            <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">Sessions</h3>
            {(() => {
              let rendered = 0;
              const els: React.ReactNode[] = [];
              for (const g of grouped) {
                if (rendered >= displayCount) break;
                const vis = g.sessions.slice(0, displayCount - rendered);
                els.push(
                  <div key={g.date} className="mb-4 last:mb-0">
                    <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">{g.label}</p>
                    <div className="space-y-1">
                      {vis.map(s => (
                        <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">
                          <span className="text-xs text-surface-500 w-16 shrink-0">{fmtTime(s.completedAt)}</span>
                          <span className="flex items-center gap-1 text-sm font-medium text-surface-900 dark:text-surface-100 w-16 shrink-0">
                            <Timer size={12} className="text-emerald-500" />{s.durationMinutes} min
                          </span>
                          {s.projectColor && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.projectColor }} />}
                          <span className="text-xs text-surface-400 w-28 truncate shrink-0">{s.projectName || 'No project'}</span>
                          <span className="text-xs text-surface-600 dark:text-surface-300 truncate flex-1 min-w-0">{s.cardTitle || ''}</span>
                          {s.note && <span className="text-xs text-surface-400 truncate max-w-[160px]">{s.note}</span>}
                        </div>
                      ))}
                    </div>
                  </div>,
                );
                rendered += vis.length;
              }
              return els;
            })()}
            {allSessions.length > displayCount && (
              <div className="text-center pt-3">
                <button onClick={() => setDisplayCount(c => c + PAGE)} className="text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors font-medium">
                  Load More ({allSessions.length - displayCount} remaining)
                </button>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
