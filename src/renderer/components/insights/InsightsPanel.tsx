// === FILE PURPOSE ===
// InsightsPanel — dashboard panel showing AI background agent insights.
// Collapses when not Pro or disabled; expands to show UpgradePrompt or insights.
// Includes filter tabs (All / New / Warning+Critical), empty state, loading skeleton,
// and a "Run Now" button.

import { useMemo, useState } from 'react';
import { Bot, RefreshCw, Loader2, Settings, Lock, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useBackgroundAgentStore } from '../../stores/backgroundAgentStore';
import { useProjectStore } from '../../stores/projectStore';
import { useProFeature } from '../../hooks/useProFeature';
import InsightCard from './InsightCard';
import UpgradePrompt from '../UpgradePrompt';
import type { AgentInsight } from '../../../shared/types/background-agent';
import { toast } from '../../hooks/useToast';

type FilterTab = 'all' | 'new' | 'urgent';

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2].map(i => (
        <div key={i} className="rounded-lg border border-[var(--color-border)] p-4 animate-pulse">
          <div className="flex items-start gap-3">
            <div className="w-4 h-4 rounded-full bg-[var(--color-border)] shrink-0 mt-0.5" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 bg-[var(--color-border)] rounded w-2/3" />
              <div className="h-3 bg-[var(--color-border)] rounded w-full" />
              <div className="h-2.5 bg-[var(--color-border)] rounded w-1/3 mt-1" />
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
  const [expanded, setExpanded] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  const { enabled: isPro, info } = useProFeature('backgroundAgent');
  const insights = useBackgroundAgentStore(s => s.insights);
  const loading = useBackgroundAgentStore(s => s.loading);
  const preferences = useBackgroundAgentStore(s => s.preferences);
  const runNow = useBackgroundAgentStore(s => s.runNow);
  const loadAllInsights = useBackgroundAgentStore(s => s.loadAllInsights);
  const projects = useProjectStore(s => s.projects);

  // Build projectId → name lookup
  const projectNameMap = useMemo(
    () => new Map(projects.map(p => [p.id, p.name])),
    [projects],
  );

  const isDisabled = isPro && preferences !== null && !preferences.enabled;
  const isCollapsed = !isPro || isDisabled;

  const handleRunNow = async () => {
    setRunning(true);
    try {
      const result = await runNow();
      if (result.ran) {
        toast('Background agent ran successfully', 'success');
        const prefs = useBackgroundAgentStore.getState().preferences;
        const projectIds = prefs?.analyzedProjectIds?.length
          ? prefs.analyzedProjectIds
          : undefined;
        await loadAllInsights(projectIds);
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
      <div
        className={`p-5 flex items-center justify-between cursor-pointer${
          (isCollapsed && expanded) || (!isCollapsed && panelOpen) ? ' border-b border-[var(--color-border)]' : ''
        }`}
        onClick={() => {
          if (!isPro) setExpanded(!expanded);
          else if (isDisabled) navigate('/settings');
          else setPanelOpen(!panelOpen);
        }}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center gap-3">
          <Bot size={16} className="text-[var(--color-accent)]" />
          <span className="font-hud text-xs tracking-widest text-[var(--color-accent-dim)]">AI INSIGHTS</span>
          {newCount > 0 && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--color-accent)] text-white">
              {newCount}
            </span>
          )}
          <div className="h-px w-16 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
        </div>

        {isCollapsed ? (
          <div className="flex items-center gap-2.5">
            {!isPro ? (
              <>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-muted)]">Pro Feature</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                  className="flex items-center gap-1.5 text-xs border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] px-3 py-1.5 transition-all clip-corner-cut-sm"
                >
                  <Lock size={12} />
                  Unlock
                </button>
                {expanded
                  ? <ChevronDown size={14} className="text-[var(--color-text-muted)]" />
                  : <ChevronRight size={14} className="text-[var(--color-text-muted)]" />
                }
              </>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); navigate('/settings'); }}
                className="flex items-center gap-1.5 text-xs border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] px-3 py-1.5 transition-all clip-corner-cut-sm"
              >
                <Settings size={12} />
                Enable in Settings
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); handleRunNow(); }}
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
            <div
              className="p-1 text-[var(--color-text-muted)] transition-transform duration-200"
              style={{ transform: panelOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
            >
              <ChevronDown size={14} />
            </div>
          </div>
        )}
      </div>

      {/* Not Pro — expandable upgrade prompt */}
      {!isPro && expanded && (
        <UpgradePrompt feature="backgroundAgent" info={info} />
      )}

      {/* Pro + enabled — full insights body */}
      {isPro && preferences !== null && preferences.enabled && panelOpen && (
        <div className="p-5">
          {/* Loading state */}
          {loading && insights.length === 0 && (
            <LoadingSkeleton />
          )}

          {/* Filter tabs */}
          {!loading && (
            <>
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
                      <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full border ${
                        activeFilter === tab.id
                          ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border-[var(--color-accent)]/30'
                          : 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-dim)] border-[var(--color-border-accent)]'
                      }`}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Insights list */}
              {filteredInsights.length === 0 ? (
                <div className="text-center py-10">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--color-accent-subtle)] mb-3">
                    <Sparkles size={20} className="text-[var(--color-accent-dim)]" />
                  </div>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {activeFilter === 'all'
                      ? 'No insights yet'
                      : `No ${activeFilter === 'new' ? 'new' : 'urgent'} insights`}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    {activeFilter === 'all'
                      ? 'Background agents will analyze your projects periodically.'
                      : 'Check back later or try a different filter.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredInsights.map(insight => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      projectName={projectNameMap.get(insight.projectId)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
