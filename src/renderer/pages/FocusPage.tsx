// === FILE PURPOSE ===
// Full page for focus time tracking — project filtering, stats, activity chart,
// session list with date grouping, and CSV export.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Timer, Download, Play, Clock, Calendar, BarChart3, Pencil, Trash2, Check, X, DollarSign, Minus, FolderOpen } from 'lucide-react';
import { useProjectStore } from '../stores/projectStore';
import { useFocusStore } from '../stores/focusStore';
import { toast } from '../hooks/useToast';
import type { FocusTimeReport, FocusSessionFull } from '../../shared/types/focus';
import { billableHours } from '../../shared/utils/billing';
import HudSelect from '../components/HudSelect';

type Period = 'thisWeek' | 'lastWeek' | 'last7Days' | 'thisMonth' | 'lastMonth' | 'allTime' | 'custom';

function getMonday(d: Date): Date {
  const day = d.getDay();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + (day === 0 ? -6 : 1));
}
function getSunday(mon: Date): Date {
  return new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function periodRange(period: Period, cs: string, ce: string): [string, string] {
  const now = new Date();
  if (period === 'thisWeek') {
    const mon = getMonday(now);
    return [toISO(mon), toISO(getSunday(mon))];
  }
  if (period === 'lastWeek') {
    const thisMon = getMonday(now);
    const lastMon = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - 7);
    return [toISO(lastMon), toISO(getSunday(lastMon))];
  }
  if (period === 'last7Days') {
    const sixAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    return [toISO(sixAgo), toISO(now)];
  }
  if (period === 'thisMonth') return [toISO(new Date(now.getFullYear(), now.getMonth(), 1)), toISO(now)];
  if (period === 'lastMonth') {
    return [toISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)), toISO(new Date(now.getFullYear(), now.getMonth(), 0))];
  }
  if (period === 'allTime') return ['2020-01-01', toISO(now)];
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
function fmtCost(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function exportCSV(sessions: FocusSessionFull[], startDate: string, endDate: string, projectName?: string) {
  const hdr = ['Date', 'Time', 'Duration (min)', 'Project', 'Card', 'Note', 'Billable', 'Hourly Rate', 'Cost'];
  const rows = sessions.map(s => {
    const dt = new Date(s.completedAt);
    const cost = s.billable && s.hourlyRate ? (billableHours(s.durationMinutes) * s.hourlyRate).toFixed(2) : '';
    return [
      dt.toLocaleDateString('en-US'),
      dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      String(s.durationMinutes), s.projectName || 'No project',
      s.cardTitle || '', (s.note || '').replace(/,/g, ';'),
      s.billable ? 'Yes' : 'No',
      s.hourlyRate != null ? String(s.hourlyRate) : '',
      cost,
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
  { key: 'thisWeek', label: 'This Week' }, { key: 'lastWeek', label: 'Last Week' },
  { key: 'last7Days', label: 'Last 7 Days' }, { key: 'thisMonth', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' }, { key: 'allTime', label: 'All Time' }, { key: 'custom', label: 'Custom' },
];
const PAGE = 50;
const cardCls = 'hud-panel-accent clip-corner-cut-sm';
const inputCls = 'px-2 py-1.5 text-sm rounded-lg border border-[var(--color-border)] bg-surface-950 text-[var(--color-text-primary)] dark:[color-scheme:dark] focus:outline-none focus:border-[var(--color-accent-dim)]';

export default function FocusPage() {
  const projects = useProjectStore(s => s.projects);
  const activeProjects = useMemo(() => projects.filter(p => !p.archived), [projects]);

  const [report, setReport] = useState<FocusTimeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('thisWeek');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [projectId, setProjectId] = useState('');
  const [billableFilter, setBillableFilter] = useState<'' | 'true' | 'false'>('');
  const [displayCount, setDisplayCount] = useState(PAGE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editProject, setEditProject] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editBillable, setEditBillable] = useState(true);
  const pendingDeleteRef = useRef<{ id: string; timeout: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timeout);
      }
    };
  }, []);

  const startEdit = useCallback((s: FocusSessionFull) => {
    setEditingId(s.id);
    setEditProject(s.projectId || '');
    setEditNote(s.note || '');
    setEditBillable(s.billable);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    await useFocusStore.getState().updateSession(editingId, {
      projectId: editProject || null,
      note: editNote || null,
      billable: editBillable,
    });
    setEditingId(null);
  }, [editingId, editProject, editNote, editBillable]);

  const handleDelete = useCallback((session: FocusSessionFull) => {
    // Cancel any previous pending delete
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timeout);
    }

    // Optimistically remove from report
    setReport(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sessions: prev.sessions.filter(s => s.id !== session.id),
      };
    });

    const timeout = setTimeout(async () => {
      await useFocusStore.getState().deleteSession(session.id);
      pendingDeleteRef.current = null;
    }, 5000);

    pendingDeleteRef.current = { id: session.id, timeout };

    toast('Session deleted', 'info', {
      label: 'Undo',
      onClick: () => {
        if (pendingDeleteRef.current?.id === session.id) {
          clearTimeout(pendingDeleteRef.current.timeout);
          pendingDeleteRef.current = null;
          // Restore by re-fetching
          useFocusStore.setState({ lastSavedAt: Date.now() });
        }
      },
    }, 5000);
  }, []);

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
      .focusGetTimeReport({
        startDate, endDate,
        projectId: projectId || undefined,
        billableOnly: billableFilter === 'true' ? true : billableFilter === 'false' ? false : undefined,
      })
      .then(data => { if (!cancelled) setReport(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [startDate, endDate, projectId, billableFilter, focusMode, lastSavedAt]);

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
  const rawDaily = report?.dailyData ?? [];

  type ChartBucket = { key: string; label: string; minutes: number; sessions: number };
  type Granularity = 'daily' | 'weekly' | 'monthly';
  const chartInfo = useMemo<{ data: ChartBucket[]; granularity: Granularity }>(() => {
    const len = rawDaily.length;
    if (len <= 31) {
      return { granularity: 'daily', data: rawDaily.map(d => ({ key: d.date, label: new Date(d.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), minutes: d.minutes, sessions: d.sessions })) };
    }
    if (len <= 180) {
      // Weekly buckets (Mon-Sun)
      const map = new Map<string, ChartBucket>();
      for (const d of rawDaily) {
        const dt = new Date(d.date);
        const mon = getMonday(dt);
        const k = toISO(mon);
        const cur = map.get(k);
        if (cur) { cur.minutes += d.minutes; cur.sessions += d.sessions; }
        else map.set(k, { key: k, label: `Week of ${mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, minutes: d.minutes, sessions: d.sessions });
      }
      return { granularity: 'weekly', data: [...map.values()] };
    }
    // Monthly buckets
    const map = new Map<string, ChartBucket>();
    for (const d of rawDaily) {
      const k = d.date.slice(0, 7); // YYYY-MM
      const cur = map.get(k);
      if (cur) { cur.minutes += d.minutes; cur.sessions += d.sessions; }
      else map.set(k, { key: k, label: new Date(k + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), minutes: d.minutes, sessions: d.sessions });
    }
    return { granularity: 'monthly', data: [...map.values()] };
  }, [rawDaily]);

  const chartData = chartInfo.data;
  const chartGranularity = chartInfo.granularity;
  const maxMin = Math.max(...chartData.map(d => d.minutes), 1);
  const totalChart = chartData.reduce((s, d) => s + d.minutes, 0);

  // Controls bar (inline to save lines)
  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
        {PERIODS.map(({ key, label }) => (
          <button key={key} onClick={() => setPeriod(key)} className={`px-3 py-1.5 text-sm font-medium transition-colors ${period === key ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] border-[var(--color-border-accent)]' : 'bg-[var(--color-chrome)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]'}`}>
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
      <HudSelect
        value={projectId}
        onChange={(v) => setProjectId(v)}
        icon={FolderOpen}
        placeholder="All Projects"
        compact
        options={[
          { value: '', label: 'All Projects' },
          ...activeProjects.map(p => ({ value: p.id, label: p.name })),
        ]}
      />
      <HudSelect
        value={billableFilter}
        onChange={(v) => setBillableFilter(v as '' | 'true' | 'false')}
        icon={DollarSign}
        placeholder="All Sessions"
        compact
        options={[
          { value: '', label: 'All Sessions' },
          { value: 'true', label: 'Billable' },
          { value: 'false', label: 'Non-billable' },
        ]}
      />
      <button onClick={() => useFocusStore.getState().setShowStartModal(true)} className="ml-auto btn-primary clip-corner-cut-sm inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium">
        <Play size={14} /> Start Focus
      </button>
    </div>
  );

  const header = (
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-4 mb-1">
          <div className="h-px w-12 bg-gradient-to-r from-transparent to-[var(--color-accent)] opacity-40" />
          <span className="font-data text-[11px] tracking-[0.3em] text-[var(--color-accent)] text-glow">SYS.FOCUS</span>
          <div className="h-px w-12 bg-gradient-to-l from-transparent to-[var(--color-accent)] opacity-40" />
        </div>
        <div className="flex items-center gap-2.5">
          <Timer size={22} className="text-[var(--color-accent)]" />
          <h1 className="font-hud text-xl text-[var(--color-accent)] text-glow">Focus Time Tracking</h1>
        </div>
      </div>
      <button onClick={handleExport} disabled={!report || !allSessions.length} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
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
          <button onClick={() => useFocusStore.getState().setShowStartModal(true)} className="mt-5 btn-primary clip-corner-cut-sm inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium">
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
            {[0, 1, 2, 3].map(i => <div key={i} className="h-20 bg-surface-100 dark:bg-surface-800 rounded-2xl animate-pulse" />)}
          </div>
          <div className="h-40 bg-surface-100 dark:bg-surface-800 rounded-2xl animate-pulse" />
          <div className="h-32 bg-surface-100 dark:bg-surface-800 rounded-2xl animate-pulse" />
        </div>
      ) : summary ? (
        <>
          {/* Summary Stats */}
          <div className={`grid gap-4 ${summary.billableCost > 0 ? 'grid-cols-5' : 'grid-cols-4'}`}>
            <div className={`${cardCls} p-4`}>
              <div className="flex items-center gap-1.5 mb-1"><BarChart3 size={16} className="text-[var(--color-accent)]" /><span className="font-hud text-[10px] text-[var(--color-text-muted)]">Total Sessions</span></div>
              <p className="font-data text-2xl font-bold text-[var(--color-text-primary)]">{summary.totalSessions}</p>
            </div>
            <div className={`${cardCls} p-4`}>
              <div className="flex items-center gap-1.5 mb-1"><Clock size={16} className="text-[var(--color-accent)]" /><span className="font-hud text-[10px] text-[var(--color-text-muted)]">Total Time</span></div>
              <p className="font-data text-2xl font-bold text-[var(--color-text-primary)]">{fmt(summary.totalMinutes)}</p>
              {billableFilter === '' && summary.billableMinutes > 0 && summary.billableMinutes < summary.totalMinutes && (
                <p className="text-xs text-surface-400 mt-0.5">{fmt(summary.billableMinutes)} billable</p>
              )}
            </div>
            <div className={`${cardCls} p-4`}>
              <div className="flex items-center gap-1.5 mb-1"><Timer size={16} className="text-[var(--color-accent)]" /><span className="font-hud text-[10px] text-[var(--color-text-muted)]">Avg Session</span></div>
              <p className="font-data text-2xl font-bold text-[var(--color-text-primary)]">{summary.avgSessionMinutes}m</p>
            </div>
            <div className={`${cardCls} p-4`}>
              <div className="flex items-center gap-1.5 mb-1"><Calendar size={16} className="text-[var(--color-accent)]" /><span className="font-hud text-[10px] text-[var(--color-text-muted)]">Active Days</span></div>
              <p className="font-data text-2xl font-bold text-[var(--color-text-primary)]">{summary.activeDays} of {totalDays}</p>
            </div>
            {summary.billableCost > 0 && (
              <div className={`${cardCls} p-4`}>
                <div className="flex items-center gap-1.5 mb-1"><DollarSign size={16} className="text-[var(--color-accent)]" /><span className="font-hud text-[10px] text-[var(--color-text-muted)]">Billable Amount</span></div>
                <p className="font-data text-2xl font-bold text-[var(--color-text-primary)]">{fmtCost(summary.billableCost)}</p>
              </div>
            )}
          </div>

          {/* Project Breakdown */}
          {!projectId && report!.projectBreakdown.length > 0 && (
            <div className={`${cardCls} p-5`}>
              <h3 className="font-hud text-xs text-[var(--color-accent)] mb-4">Project Breakdown</h3>
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
                      {pb.cost !== null && pb.cost > 0 && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 w-20 text-right shrink-0">{fmtCost(pb.cost)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Activity Chart */}
          {chartData.length > 0 && (
            <div className={`${cardCls} p-5`}>
              <div className="flex items-end gap-px h-28">
                {chartData.map(b => {
                  const h = b.minutes > 0 ? Math.max((b.minutes / maxMin) * 100, 4) : 2;
                  return <div key={b.key} className="flex-1 rounded-t-sm transition-all duration-200 hover:opacity-80 cursor-default" style={{ height: `${h}%`, backgroundColor: b.minutes > 0 ? 'rgb(16 185 129)' : 'var(--color-surface-300)' }} title={`${b.label}: ${fmt(b.minutes)} (${b.sessions} session${b.sessions !== 1 ? 's' : ''})`} />;
                })}
              </div>
              <div className="flex gap-px mt-1">
                {chartData.length <= 7
                  ? chartData.map(b => (
                      <div key={b.key} className="flex-1 text-center">
                        <span className="text-[8px] text-surface-500">{chartGranularity === 'daily' ? new Date(b.key).toLocaleDateString('en-US', { weekday: 'short' }) : b.label}</span>
                      </div>
                    ))
                  : chartData.map((b, i) => {
                      const iv = Math.max(Math.floor(chartData.length / 10), 1);
                      const lbl = chartGranularity === 'monthly' ? new Date(b.key + '-01').toLocaleDateString('en-US', { month: 'short' }) : String(new Date(b.key).getDate());
                      return <div key={b.key} className="flex-1 text-center">{i % iv === 0 ? <span className="text-[8px] text-surface-500">{lbl}</span> : null}</div>;
                    })}
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-surface-200 dark:border-surface-700">
                <span className="text-xs text-surface-500 font-medium">{chartGranularity === 'daily' && chartData.length === 7 ? 'Weekly Activity' : chartGranularity === 'monthly' ? 'Monthly Activity' : chartGranularity === 'weekly' ? 'Weekly Activity' : `${chartData.length}-Day Activity`}</span>
                <span className="text-xs text-surface-400">{fmt(totalChart)} total</span>
              </div>
            </div>
          )}

          {/* Session List */}
          <div className={`${cardCls} p-5`}>
            <h3 className="font-hud text-xs text-[var(--color-accent)] mb-4">Sessions</h3>
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
                        <div key={s.id} className="group">
                          {editingId === s.id ? (
                            /* Inline edit form */
                            <div className="px-3 py-3 rounded-lg bg-surface-50 dark:bg-surface-800/50 space-y-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <HudSelect
                                    value={editProject}
                                    onChange={(v) => setEditProject(v)}
                                    icon={FolderOpen}
                                    placeholder="No project"
                                    options={[
                                      { value: '', label: 'No project' },
                                      ...activeProjects.map(p => ({ value: p.id, label: p.name })),
                                    ]}
                                  />
                                </div>
                                <input
                                  type="text"
                                  value={editNote}
                                  onChange={e => setEditNote(e.target.value)}
                                  placeholder="Note"
                                  className={`flex-1 ${inputCls}`}
                                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                                />
                                <label className="flex items-center gap-1.5 text-sm text-surface-700 dark:text-surface-300 shrink-0 cursor-pointer">
                                  <input type="checkbox" checked={editBillable} onChange={e => setEditBillable(e.target.checked)} className="accent-emerald-500 cursor-pointer" />
                                  Billable
                                </label>
                                <button onClick={saveEdit} className="p-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition-colors" title="Save">
                                  <Check size={14} />
                                </button>
                                <button onClick={cancelEdit} className="p-1.5 rounded-md bg-surface-200 dark:bg-surface-700 hover:bg-surface-300 dark:hover:bg-surface-600 text-surface-700 dark:text-surface-300 transition-colors" title="Cancel">
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* Normal display row */
                            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-800/50 transition-colors">
                              <span className="text-xs text-surface-500 w-16 shrink-0">{fmtTime(s.completedAt)}</span>
                              <span className="flex items-center gap-1 text-sm font-medium text-surface-900 dark:text-surface-100 w-16 shrink-0">
                                <Timer size={12} className="text-emerald-500" />{s.durationMinutes} min
                              </span>
                              <span className="shrink-0" title={s.billable ? 'Billable' : 'Non-billable'}>
                                {s.billable ? <DollarSign size={12} className="text-emerald-500" /> : <Minus size={12} className="text-surface-400" />}
                              </span>
                              {s.projectColor && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.projectColor }} />}
                              <span className="text-xs text-surface-400 w-28 truncate shrink-0">{s.projectName || 'No project'}</span>
                              <span className="text-xs text-surface-600 dark:text-surface-300 truncate flex-1 min-w-0">{s.cardTitle || ''}</span>
                              {s.note && <span className="text-xs text-surface-400 truncate max-w-[160px]">{s.note}</span>}
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                <button onClick={() => startEdit(s)} className="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-700 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors" title="Edit session">
                                  <Pencil size={13} />
                                </button>
                                <button onClick={() => handleDelete(s)} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-surface-400 hover:text-red-500 transition-colors" title="Delete session">
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          )}
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
