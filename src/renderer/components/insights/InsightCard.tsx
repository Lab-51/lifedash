// === FILE PURPOSE ===
// InsightCard — displays a single AgentInsight with severity icon, title,
// summary, timestamp, and actions (Dismiss, View Cards).
// Expands on click to show full details; auto-marks as read when expanded.
// Related cards are clickable and navigate to the project board with the card open.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, AlertCircle, Info, ChevronDown, X, ArrowRight, Clock, LayoutGrid, ArrowUpRight } from 'lucide-react';
import type { AgentInsight, InsightSeverity } from '../../../shared/types/background-agent';
import { useBackgroundAgentStore } from '../../stores/backgroundAgentStore';
import { formatRelativeTime } from '../../utils/date-utils';

interface InsightCardProps {
  insight: AgentInsight;
  projectName?: string;
}

interface StaleCardDetail {
  id: string;
  title: string;
  column: string;
  daysSinceUpdate: number;
  priority?: string;
  projectId?: string;
  projectName?: string;
}

const PRIORITY_STYLES: Record<string, { color: string; bg: string; border: string; bar: string }> = {
  low: { color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800', bar: 'bg-emerald-500' },
  medium: { color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800', bar: 'bg-blue-500' },
  high: { color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', bar: 'bg-amber-500' },
  urgent: { color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800', bar: 'bg-red-500' },
};

function SeverityIcon({ severity }: { severity: InsightSeverity }) {
  if (severity === 'critical') {
    return <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />;
  }
  if (severity === 'warning') {
    return <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />;
  }
  return <Info size={16} className="text-[var(--color-accent)] shrink-0 mt-0.5" />;
}

function severityAccent(severity: InsightSeverity) {
  if (severity === 'critical') return { border: 'border-red-500/30', bg: 'bg-red-500/5', glow: 'shadow-red-500/5', indicator: 'bg-red-400' };
  if (severity === 'warning') return { border: 'border-amber-500/30', bg: 'bg-amber-500/5', glow: 'shadow-amber-500/5', indicator: 'bg-amber-400' };
  return { border: 'border-[var(--color-border)]', bg: '', glow: '', indicator: 'bg-[var(--color-accent)]' };
}

export default function InsightCard({ insight, projectName }: InsightCardProps) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const markAsRead = useBackgroundAgentStore(s => s.markAsRead);
  const markActedOn = useBackgroundAgentStore(s => s.markActedOn);
  const dismissInsight = useBackgroundAgentStore(s => s.dismissInsight);

  const accent = severityAccent(insight.severity);

  // Extract card details from the insight's details field (stale_cards type stores these)
  const staleCards: StaleCardDetail[] =
    (insight.details as { staleCards?: StaleCardDetail[] } | null)?.staleCards ?? [];

  // Build a lookup of cardId → card info for richer display
  const cardInfoMap = new Map(staleCards.map(c => [c.id, c]));

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && insight.status === 'new') {
      markAsRead(insight.id);
    }
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    dismissInsight(insight.id);
  };

  const handleNavigateToCard = (cardId: string) => {
    markActedOn(insight.id);
    const card = cardInfoMap.get(cardId);
    const pid = card?.projectId ?? insight.projectId;
    navigate(`/projects/${pid}?openCard=${cardId}`);
  };

  // Extract unique project IDs from stale card details
  const uniqueProjects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const card of staleCards) {
      if (card.projectId && card.projectName) {
        seen.set(card.projectId, card.projectName);
      }
    }
    return seen;
  }, [staleCards]);

  const isMultiProject = uniqueProjects.size > 1;

  const handleViewCards = () => {
    markActedOn(insight.id);
    if (insight.relatedCardIds.length === 1) {
      const card = cardInfoMap.get(insight.relatedCardIds[0]);
      const pid = card?.projectId ?? insight.projectId;
      navigate(`/projects/${pid}?openCard=${insight.relatedCardIds[0]}`);
    } else if (isMultiProject) {
      navigate('/');
    } else {
      navigate(`/projects/${insight.projectId}`);
    }
  };

  const renderCardTile = (cardId: string, info: StaleCardDetail | undefined) => {
    const pStyle = PRIORITY_STYLES[info?.priority ?? 'medium'] ?? PRIORITY_STYLES.medium;
    return (
      <div
        key={cardId}
        role="button"
        tabIndex={0}
        onClick={() => handleNavigateToCard(cardId)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNavigateToCard(cardId); } }}
        className="group/card relative hud-panel clip-corner-cut-sm p-3.5 cursor-pointer
          hover:border-[var(--color-accent-dim)] hover:shadow-[0_0_8px_rgba(62,232,228,0.1)]
          transition-all"
      >
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--color-accent)] to-transparent opacity-0 group-hover/card:opacity-60 transition-opacity duration-700" />
        <div className={`absolute top-3 bottom-3 left-0 w-1 rounded-r-full ${pStyle.bar}`} />
        <div className="pl-2.5">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <h4 className="text-sm font-medium leading-snug text-surface-900 dark:text-surface-100 line-clamp-2 flex-1 min-w-0">
              {info?.title ?? `Card ${cardId.slice(0, 8)}...`}
            </h4>
            <ArrowUpRight size={13} className="text-[var(--color-accent-dim)] shrink-0 mt-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {info?.priority && (
              <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md ${pStyle.bg} ${pStyle.color} border ${pStyle.border}`}>
                {info.priority}
              </span>
            )}
            {info?.column && (
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                {info.column}
              </span>
            )}
            {info?.daysSinceUpdate !== undefined && (
              <span className={`flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md border ${
                info.daysSinceUpdate >= 30
                  ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                  : info.daysSinceUpdate >= 14
                    ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                    : 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
              }`}>
                <Clock size={10} />
                {info.daysSinceUpdate}d inactive
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const createdAt = insight.createdAt instanceof Date
    ? insight.createdAt.toISOString()
    : String(insight.createdAt);

  const isNew = insight.status === 'new';

  return (
    <div
      className={`group relative overflow-hidden rounded-lg border ${accent.border} ${accent.bg} transition-all duration-200 hover:shadow-lg ${accent.glow}`}
    >
      {/* New indicator bar */}
      {isNew && (
        <div className={`absolute top-0 left-0 w-0.5 h-full ${accent.indicator}`} />
      )}

      {/* Header — always visible */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleExpand}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleExpand(); } }}
        className="w-full text-left p-4 flex items-start gap-3 hover:bg-white/[0.03] dark:hover:bg-white/[0.03] transition-colors cursor-pointer"
      >
        <SeverityIcon severity={insight.severity} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-[var(--color-text-primary)] leading-snug">{insight.title}</span>
            {isNew && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-border-accent)] uppercase tracking-wider">
                New
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2 mt-1 leading-relaxed">{insight.summary}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
              <Clock size={10} className="opacity-60" />
              {formatRelativeTime(createdAt)}
            </span>
            {projectName && (
              <span className="text-[11px] text-[var(--color-accent-dim)] truncate max-w-[150px]" title={projectName}>
                {projectName}
              </span>
            )}
            {insight.relatedCardIds.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-accent-dim)]">
                <LayoutGrid size={10} className="opacity-60" />
                {insight.relatedCardIds.length} card{insight.relatedCardIds.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={handleDismiss}
            title="Dismiss"
            className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400 transition-all"
          >
            <X size={13} />
          </button>
          <div
            className="p-1.5 text-[var(--color-text-muted)] transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            <ChevronDown size={14} />
          </div>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-[var(--color-border)]">
          {/* Related cards — grouped by project when multi-project */}
          {insight.relatedCardIds.length > 0 && (
            <div className="px-4 pt-3 pb-2">
              <p className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-text-muted)] mb-2.5">
                Related Cards
              </p>
              {isMultiProject ? (
                // Group cards by project
                [...uniqueProjects.entries()].map(([pid, pName]) => {
                  const projectCards = staleCards.filter(c => c.projectId === pid);
                  if (projectCards.length === 0) return null;
                  return (
                    <div key={pid} className="mb-3 last:mb-0">
                      <p className="text-[11px] font-medium text-[var(--color-text-secondary)] mb-1.5 pl-0.5">
                        {pName}
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {projectCards.map(card => renderCardTile(card.id, cardInfoMap.get(card.id)))}
                      </div>
                    </div>
                  );
                })
              ) : (
                // Single project — flat grid, no subheader
                <div className="grid grid-cols-3 gap-2">
                  {insight.relatedCardIds.map(cardId => renderCardTile(cardId, cardInfoMap.get(cardId)))}
                </div>
              )}
            </div>
          )}

          {/* Actions row */}
          <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--color-border)]">
            <button
              onClick={handleDismiss}
              className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-red-400
                border border-[var(--color-border)] hover:border-red-500/40
                px-3 py-1.5 clip-corner-cut-sm transition-all"
            >
              <X size={12} />
              Dismiss
            </button>
            {insight.relatedCardIds.length > 0 && (
              <button
                onClick={handleViewCards}
                className="flex items-center gap-1.5 text-xs text-[var(--color-accent)]
                  border border-[var(--color-border-accent)] hover:border-[var(--color-accent)]
                  hover:shadow-[0_0_12px_var(--color-chrome-glow)]
                  px-3 py-1.5 clip-corner-cut-sm transition-all"
              >
                <ArrowRight size={12} />
                {insight.relatedCardIds.length === 1 ? 'Open Card' : isMultiProject ? 'View Dashboard' : 'View Project'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
