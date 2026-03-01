// === FILE PURPOSE ===
// InsightsPanel — dashboard panel showing AI background agent insights.
// Includes filter tabs (All / New / Warning+Critical), empty state, loading skeleton,
// and a "Run Now" button. Wraps all content in a Pro gate.

import { useState } from 'react';
import { Bot, RefreshCw, Loader2, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useBackgroundAgentStore } from '../../stores/backgroundAgentStore';
import InsightCard from './InsightCard';
import ProGate from '../ProGate';
import type { AgentInsight } from '../../../shared/types/background-agent';
import { toast } from '../../hooks/useToast';

type FilterTab = 'all' | 'new' | 'urgent';

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="hud-panel clip-corner-cut-sm p-4 animate-pulse">
          <div className="flex items-start gap-3">
            <div className="w-4 h-4 rounded bg-[var(--color-border)] shrink-0 mt-0.5" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 bg-[var(--color-border)] rounded w-2/3" />
              <div className="h-3 bg-[var(--color-border)] rounded w-full" />
              <div className="h-3 bg-[var(--color-border)] rounded w-4/5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function sortInsights(insights: AgentInsight[]): AgentInsight[] {
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  return [...insights].sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
    const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
    return bTime - aTime;
  });
}

export default function InsightsPanel() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [running, setRunning] = useState(false);

  const insights = useBackgroundAgentStore(s => s.insights);
  const loading = useBackgroundAgentStore(s => s.loading);
  const preferences = useBackgroundAgentStore(s => s.preferences);
  const runNow = useBackgroundAgentStore(s => s.runNow);
  const loadInsights = useBackgroundAgentStore(s => s.loadInsights);

  const handleRunNow = async () => {
    setRunning(true);
    try {
      const result = await runNow();
      if (result.ran) {
        toast('Background agent ran successfully', 'success');
        // Refresh insights for current project if we have them
        const currentInsights = useBackgroundAgentStore.getState().insights;
        if (currentInsights.length > 0) {
          await loadInsights(currentInsights[0].projectId);
        }
      } else {
        toast(result.reason || 'Agent did not run', 'error');
      }
    } finally {
      setRunning(false);
    }
  };

  const filteredInsights = sortInsights(
    insights.filter(insight => {
      if (insight.status === 'dismissed') return false;
      if (activeFilter === 'new') return insight.status === 'new';
      if (activeFilter === 'urgent') return insight.severity === 'warning' || insight.severity === 'critical';
      return true;
    }),
  );

  const activeInsights = insights.filter(i => i.status !== 'dismissed');
  const newCount = activeInsights.filter(i => i.status === 'new').length;
  const urgentCount = activeInsights.filter(i =>
    i.severity === 'warning' || i.severity === 'critical',
  ).length;

  const FILTER_TABS: { id: FilterTab; label: string; count?: number }[] = [
    { id: 'all', label: 'All', count: activeInsights.length },
    { id: 'new', label: 'New', count: newCount },
    { id: 'urgent', label: 'Urgent', count: urgentCount },
  ];

  return (
    <div className="hud-panel clip-corner-cut-sm overflow-hidden">
      {/* Panel header */}
      <div className="p-5 flex items-center justify-between border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <Bot size={16} className="text-[var(--color-accent)]" />
          <span className="font-hud text-xs tracking-widest text-[var(--color-accent-dim)]">AI INSIGHTS</span>
          <div className="h-px w-16 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
        </div>
        <button
          onClick={handleRunNow}
          disabled={running}
          title="Run background agent now"
          className="flex items-center gap-1.5 text-xs border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] px-3 py-1.5 transition-all clip-corner-cut-sm disabled:opacity-50 disabled:cursor-wait"
        >
          {running ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {running ? 'Running...' : 'Run Now'}
        </button>
      </div>

      {/* Pro gate wraps the body */}
      <ProGate feature="backgroundAgent">
        <div className="p-5">
          {/* Loading state before preferences are fetched */}
          {preferences === null && loading && (
            <LoadingSkeleton />
          )}

          {/* Not yet loaded preferences — show nothing */}
          {preferences === null && !loading && (
            <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">
              <Bot size={28} className="mx-auto mb-2 opacity-30" />
              <p>Loading agent preferences...</p>
            </div>
          )}

          {/* Feature not enabled */}
          {preferences !== null && !preferences.enabled && (
            <div className="text-center py-8">
              <Bot size={28} className="mx-auto mb-3 text-[var(--color-text-muted)] opacity-50" />
              <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-1">Background agents are disabled</p>
              <p className="text-xs text-[var(--color-text-muted)] mb-4 max-w-xs mx-auto">
                Background agents periodically analyze your projects and surface insights like stale cards, risks, and suggestions.
              </p>
              <button
                onClick={() => navigate('/settings')}
                className="flex items-center gap-1.5 text-xs border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] px-3 py-1.5 mx-auto transition-all clip-corner-cut-sm"
              >
                <Settings size={12} />
                Enable in Settings
              </button>
            </div>
          )}

          {/* Enabled — show insights */}
          {preferences !== null && preferences.enabled && (
            <>
              {/* Filter tabs */}
              <div className="flex items-center gap-1 mb-4">
                {FILTER_TABS.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveFilter(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all rounded-lg ${
                      activeFilter === tab.id
                        ? 'hud-nav-active'
                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)]'
                    }`}
                  >
                    {tab.label}
                    {tab.count !== undefined && tab.count > 0 && (
                      <span className="font-data text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent-dim)] border border-[var(--color-border-accent)]">
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Insights list */}
              {loading ? (
                <LoadingSkeleton />
              ) : filteredInsights.length === 0 ? (
                <div className="text-center py-8 text-[var(--color-text-muted)]">
                  <Bot size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">
                    {activeFilter === 'all'
                      ? 'No insights yet. Background agents will analyze your projects periodically.'
                      : `No ${activeFilter === 'new' ? 'new' : 'urgent'} insights.`}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredInsights.map(insight => (
                    <InsightCard key={insight.id} insight={insight} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </ProGate>
    </div>
  );
}
