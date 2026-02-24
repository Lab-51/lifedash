// === FILE PURPOSE ===
// AI usage dashboard with visual charts for the Settings page.
// Shows summary cards (tokens, cost, API calls), a 30-day daily usage bar chart,
// and horizontal bar breakdowns by task type and model.
// Pure CSS — no chart library.

import { useState, useEffect, useCallback } from 'react';
import { BarChart3, RefreshCw, Hash, DollarSign, Zap } from 'lucide-react';
import type { AIUsageSummary as UsageSummaryType, AIUsageDaily } from '../../shared/types';

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/** Compact number: 1234567 -> "1.2M", 45300 -> "45.3K", 892 -> "892" */
function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Format cost: 0 -> "$0.00", 0.0012 -> "$0.0012", 1.23 -> "$1.23" */
function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/** Format task type ID to human label: task_generation -> Task Generation */
function formatTaskType(type: string): string {
  return type
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Format date for bar tooltip: "2026-02-17" -> "Feb 17" */
function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Color maps
// ---------------------------------------------------------------------------

const TASK_TYPE_COLORS: Record<string, { bar: string; bg: string }> = {
  brainstorming:   { bar: 'bg-emerald-500', bg: 'bg-emerald-500/20' },
  summarization:   { bar: 'bg-blue-500',    bg: 'bg-blue-500/20' },
  transcription:   { bar: 'bg-amber-500',   bg: 'bg-amber-500/20' },
  standup:         { bar: 'bg-rose-500',     bg: 'bg-rose-500/20' },
  task_generation: { bar: 'bg-violet-500',   bg: 'bg-violet-500/20' },
  task_structuring:{ bar: 'bg-violet-400',   bg: 'bg-violet-400/20' },
  idea_analysis:   { bar: 'bg-indigo-500',   bg: 'bg-indigo-500/20' },
};
const DEFAULT_COLOR = { bar: 'bg-surface-400', bg: 'bg-surface-400/20' };

function getTaskColor(type: string) {
  return TASK_TYPE_COLORS[type] ?? DEFAULT_COLOR;
}

// Provider/model colors cycle
const MODEL_COLORS = [
  { bar: 'bg-primary-500', bg: 'bg-primary-500/20' },
  { bar: 'bg-teal-500',    bg: 'bg-teal-500/20' },
  { bar: 'bg-orange-500',  bg: 'bg-orange-500/20' },
  { bar: 'bg-pink-500',    bg: 'bg-pink-500/20' },
  { bar: 'bg-cyan-500',    bg: 'bg-cyan-500/20' },
  { bar: 'bg-lime-500',    bg: 'bg-lime-500/20' },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Summary stat card matching dashboard design pattern */
function StatCard({ label, value, icon: Icon, accentClass }: {
  label: string;
  value: string;
  icon: typeof Hash;
  accentClass: string;
}) {
  return (
    <div className="hud-panel clip-corner-cut-sm p-4 flex items-center justify-between">
      <div>
        <p className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)] mb-1">{label}</p>
        <p className="text-2xl font-[var(--font-display)] font-bold text-[var(--color-text-primary)]">{value}</p>
      </div>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${accentClass}`}>
        <Icon size={20} />
      </div>
    </div>
  );
}

/** Single vertical bar for the daily chart */
function DailyBar({ day, maxTokens, onHover, onLeave, isHovered }: {
  day: AIUsageDaily;
  maxTokens: number;
  onHover: () => void;
  onLeave: () => void;
  isHovered: boolean;
}) {
  const pct = maxTokens > 0 ? (day.tokens / maxTokens) * 100 : 0;
  const barHeight = day.tokens > 0 ? Math.max(pct, 2) : 0;

  return (
    <div
      className="relative flex-1 flex flex-col items-center justify-end h-full group cursor-default"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      {/* Tooltip */}
      {isHovered && (
        <div className="absolute bottom-full mb-2 z-10 px-2.5 py-1.5 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg text-xs whitespace-nowrap pointer-events-none">
          <div className="font-medium text-surface-900 dark:text-surface-100">{formatShortDate(day.date)}</div>
          <div className="text-surface-400">
            {formatCompactNumber(day.tokens)} tokens &middot; {formatCost(day.cost)}
          </div>
          <div className="text-surface-500">{day.count} call{day.count !== 1 ? 's' : ''}</div>
        </div>
      )}
      {/* Bar */}
      <div
        className={`w-full rounded-t transition-all duration-150 ${
          isHovered ? 'bg-primary-400' : 'bg-primary-500'
        }`}
        style={{ height: `${barHeight}%`, minWidth: '2px' }}
      />
    </div>
  );
}

/** Horizontal progress bar row for breakdowns */
function BreakdownRow({ label, value, maxValue, barColor, bgColor, suffix }: {
  label: string;
  value: number;
  maxValue: number;
  barColor: string;
  bgColor: string;
  suffix: string;
}) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-surface-700 dark:text-surface-300 font-medium">{label}</span>
        <span className="text-surface-400">{suffix}</span>
      </div>
      <div className={`h-2 rounded-full ${bgColor} overflow-hidden`}>
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-300`}
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function UsageSummary() {
  const [summary, setSummary] = useState<UsageSummaryType | null>(null);
  const [daily, setDaily] = useState<AIUsageDaily[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryData, dailyData] = await Promise.all([
        window.electronAPI.getAIUsageSummary(),
        window.electronAPI.getAIUsageDaily(),
      ]);
      setSummary(summaryData);
      setDaily(dailyData);
    } catch (err) {
      console.error('Failed to fetch usage data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // Loading state
  if (loading) {
    return (
      <div className="text-sm text-surface-500 py-4">Loading usage data...</div>
    );
  }

  // Empty state
  const totalCalls = daily.reduce((sum, d) => sum + d.count, 0);
  if (!summary || (summary.totalTokens === 0 && totalCalls === 0)) {
    return (
      <div className="flex flex-col items-center justify-center text-surface-500 py-8">
        <BarChart3 size={36} className="mb-3 text-surface-600" />
        <p className="text-sm font-medium">No AI usage recorded yet</p>
        <p className="text-xs text-surface-600 mt-1 max-w-xs text-center">
          Start using AI features to see stats here.
        </p>
      </div>
    );
  }

  // Computed values
  const taskEntries = Object.entries(summary.byTaskType).sort((a, b) => b[1].tokens - a[1].tokens);
  const providerEntries = Object.entries(summary.byProvider).sort((a, b) => b[1].tokens - a[1].tokens);
  const modelEntries = Object.entries(summary.byModel ?? {}).sort((a, b) => b[1].tokens - a[1].tokens);
  const maxTaskTokens = taskEntries.length > 0 ? taskEntries[0][1].tokens : 0;
  const maxProviderTokens = providerEntries.length > 0 ? providerEntries[0][1].tokens : 0;
  const maxModelTokens = modelEntries.length > 0 ? modelEntries[0][1].tokens : 0;
  const maxDayTokens = Math.max(...daily.map(d => d.tokens), 0);
  const totalDailyTokens = daily.reduce((sum, d) => sum + d.tokens, 0);

  // Label indices for x-axis (show ~4-5 labels spaced across the 30 bars)
  const labelIndices = [0, 7, 14, 21, 29].filter(i => i < daily.length);

  return (
    <div className="space-y-5">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <h3 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">AI Usage Dashboard</h3>
        <button
          onClick={fetchUsage}
          className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors font-data"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Section 1 — Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Total Tokens"
          value={formatCompactNumber(summary.totalTokens)}
          icon={Hash}
          accentClass="bg-primary-900/30 text-primary-400"
        />
        <StatCard
          label="Estimated Cost"
          value={formatCost(summary.totalCost)}
          icon={DollarSign}
          accentClass="bg-emerald-900/30 text-emerald-400"
        />
        <StatCard
          label="API Calls"
          value={formatCompactNumber(totalCalls)}
          icon={Zap}
          accentClass="bg-amber-900/30 text-amber-400"
        />
      </div>

      {/* Section 2 — Daily Usage Bar Chart */}
      <div className="hud-panel clip-corner-cut-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)]">Last 30 Days</h4>
            <p className="text-xs text-surface-500 mt-0.5">{formatCompactNumber(totalDailyTokens)} tokens total</p>
          </div>
        </div>

        {/* Bar chart */}
        <div className="flex items-end gap-px h-32">
          {daily.map((day, i) => (
            <DailyBar
              key={day.date}
              day={day}
              maxTokens={maxDayTokens}
              isHovered={hoveredBar === i}
              onHover={() => setHoveredBar(i)}
              onLeave={() => setHoveredBar(null)}
            />
          ))}
        </div>

        {/* X-axis labels */}
        <div className="relative flex h-5 mt-1">
          {labelIndices.map(idx => {
            const leftPct = daily.length > 1 ? (idx / (daily.length - 1)) * 100 : 50;
            return (
              <span
                key={idx}
                className="absolute text-[10px] text-surface-500 -translate-x-1/2"
                style={{ left: `${leftPct}%` }}
              >
                {formatShortDate(daily[idx].date)}
              </span>
            );
          })}
        </div>
      </div>

      {/* Section 3 — Breakdowns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* By Task Type */}
        {taskEntries.length > 0 && (
          <div className="hud-panel clip-corner-cut-sm p-4">
            <h4 className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)] mb-3">By Task Type</h4>
            <div className="space-y-3">
              {taskEntries.map(([type, data]) => {
                const colors = getTaskColor(type);
                return (
                  <BreakdownRow
                    key={type}
                    label={formatTaskType(type)}
                    value={data.tokens}
                    maxValue={maxTaskTokens}
                    barColor={colors.bar}
                    bgColor={colors.bg}
                    suffix={`${formatCompactNumber(data.tokens)} tokens`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* By Provider */}
        {providerEntries.length > 0 && (
          <div className="hud-panel clip-corner-cut-sm p-4">
            <h4 className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)] mb-3">By Provider</h4>
            <div className="space-y-3">
              {providerEntries.map(([id, data], idx) => {
                const colors = MODEL_COLORS[idx % MODEL_COLORS.length];
                return (
                  <BreakdownRow
                    key={id}
                    label={id}
                    value={data.tokens}
                    maxValue={maxProviderTokens}
                    barColor={colors.bar}
                    bgColor={colors.bg}
                    suffix={`${formatCompactNumber(data.tokens)} · ${formatCost(data.cost)}`}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Section 4 — By Model */}
      {modelEntries.length > 0 && (
        <div className="hud-panel clip-corner-cut-sm p-4">
          <h4 className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)] mb-3">By Model</h4>
          <div className="space-y-3">
            {modelEntries.map(([model, data], idx) => {
              const colors = MODEL_COLORS[idx % MODEL_COLORS.length];
              return (
                <BreakdownRow
                  key={model}
                  label={model}
                  value={data.tokens}
                  maxValue={maxModelTokens}
                  barColor={colors.bar}
                  bgColor={colors.bg}
                  suffix={`${formatCompactNumber(data.tokens)} · ${formatCost(data.cost)}`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
