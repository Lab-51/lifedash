// === FILE PURPOSE ===
// AI token usage summary display for the Settings page.
// Shows total tokens, estimated cost, and breakdowns by provider and task type.
// Fetches data directly from IPC (not via store — usage is read-only display).

import { useState, useEffect } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import type { AIUsageSummary as UsageSummaryType } from '../../shared/types';

/** Format large numbers with commas: 12345 → "12,345" */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/** Format cost to 4 decimal places: 0.0012 → "$0.0012" */
function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  return `$${cost.toFixed(4)}`;
}

/** Format task type ID to human label: task_generation → Task Generation */
function formatTaskType(type: string): string {
  return type
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function UsageSummary() {
  const [summary, setSummary] = useState<UsageSummaryType | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsage = async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI.getAIUsageSummary();
      setSummary(data);
    } catch (err) {
      console.error('Failed to fetch usage summary:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsage();
  }, []);

  if (loading) {
    return (
      <div className="text-sm text-surface-500 py-4">Loading usage data...</div>
    );
  }

  if (!summary || summary.totalTokens === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-surface-500 py-6">
        <BarChart3 size={32} className="mb-2 text-surface-600" />
        <p className="text-sm">No AI usage recorded yet</p>
        <p className="text-xs text-surface-600 mt-1">
          Usage data will appear here after using AI features
        </p>
      </div>
    );
  }

  const providerEntries = Object.entries(summary.byProvider);
  const taskEntries = Object.entries(summary.byTaskType);

  return (
    <div className="space-y-4">
      {/* Totals row */}
      <div className="flex items-center gap-6">
        <div>
          <div className="text-xs text-surface-500">Total Tokens</div>
          <div className="text-lg font-semibold text-surface-100">
            {formatNumber(summary.totalTokens)}
          </div>
        </div>
        <div>
          <div className="text-xs text-surface-500">Estimated Cost</div>
          <div className="text-lg font-semibold text-surface-100">
            {formatCost(summary.totalCost)}
          </div>
        </div>
        <div className="ml-auto">
          <button onClick={fetchUsage}
            className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200 transition-colors">
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Breakdowns side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* By Provider */}
        {providerEntries.length > 0 && (
          <div className="p-3 bg-surface-800 border border-surface-700 rounded-lg">
            <div className="text-xs font-medium text-surface-400 mb-2">By Provider</div>
            <div className="space-y-1.5">
              {providerEntries.map(([id, data]) => (
                <div key={id} className="flex items-center justify-between text-xs">
                  <span className="text-surface-300">{id}</span>
                  <span className="text-surface-400">
                    {formatNumber(data.tokens)} tokens {'\u00B7'} {formatCost(data.cost)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* By Task Type */}
        {taskEntries.length > 0 && (
          <div className="p-3 bg-surface-800 border border-surface-700 rounded-lg">
            <div className="text-xs font-medium text-surface-400 mb-2">By Task Type</div>
            <div className="space-y-1.5">
              {taskEntries.map(([type, data]) => (
                <div key={type} className="flex items-center justify-between text-xs">
                  <span className="text-surface-300">{formatTaskType(type)}</span>
                  <span className="text-surface-400">
                    {formatNumber(data.tokens)} tokens {'\u00B7'} {formatCost(data.cost)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
