// === FILE PURPOSE ===
// InsightCard — displays a single AgentInsight with severity icon, title,
// summary, timestamp, and actions (Dismiss, View Cards).
// Expands on click to show full details; auto-marks as read when expanded.

import { useState } from 'react';
import { AlertTriangle, AlertCircle, Info, ChevronDown, X, ExternalLink } from 'lucide-react';
import type { AgentInsight, InsightSeverity } from '../../../shared/types/background-agent';
import { useBackgroundAgentStore } from '../../stores/backgroundAgentStore';
import { formatRelativeTime } from '../../utils/date-utils';

interface InsightCardProps {
  insight: AgentInsight;
}

function SeverityIcon({ severity }: { severity: InsightSeverity }) {
  if (severity === 'critical') {
    return <AlertCircle size={16} className="text-red-400 shrink-0" />;
  }
  if (severity === 'warning') {
    return <AlertTriangle size={16} className="text-amber-400 shrink-0" />;
  }
  return <Info size={16} className="text-[var(--color-accent)] shrink-0" />;
}

function severityBorderClass(severity: InsightSeverity): string {
  if (severity === 'critical') return 'border-red-500/40';
  if (severity === 'warning') return 'border-amber-500/40';
  return 'border-[var(--color-border)]';
}

function severityBgClass(severity: InsightSeverity): string {
  if (severity === 'critical') return 'bg-red-500/5';
  if (severity === 'warning') return 'bg-amber-500/5';
  return '';
}

function statusBadgeClass(status: AgentInsight['status']): string {
  if (status === 'new') return 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-border-accent)]';
  if (status === 'acted_on') return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
  return 'bg-[var(--color-accent-subtle)] text-[var(--color-text-muted)] border border-[var(--color-border)]';
}

export default function InsightCard({ insight }: InsightCardProps) {
  const [expanded, setExpanded] = useState(false);
  const markAsRead = useBackgroundAgentStore(s => s.markAsRead);
  const dismissInsight = useBackgroundAgentStore(s => s.dismissInsight);

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    // Auto-mark as read when expanded for the first time
    if (next && insight.status === 'new') {
      markAsRead(insight.id);
    }
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    dismissInsight(insight.id);
  };

  const createdAt = insight.createdAt instanceof Date
    ? insight.createdAt.toISOString()
    : String(insight.createdAt);

  return (
    <div
      className={`hud-panel clip-corner-cut-sm overflow-hidden border ${severityBorderClass(insight.severity)} ${severityBgClass(insight.severity)} transition-all duration-200`}
    >
      {/* Header — always visible */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleExpand}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleExpand(); } }}
        className="w-full text-left p-4 flex items-start gap-3 hover:bg-white/5 transition-colors cursor-pointer"
      >
        <SeverityIcon severity={insight.severity} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-hud text-sm text-[var(--color-text-primary)]">{insight.title}</span>
            {insight.status === 'new' && (
              <span className={`font-data text-[10px] px-1.5 py-0.5 rounded ${statusBadgeClass('new')}`}>
                NEW
              </span>
            )}
            {insight.status === 'acted_on' && (
              <span className={`font-data text-[10px] px-1.5 py-0.5 rounded ${statusBadgeClass('acted_on')}`}>
                ACTED
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2">{insight.summary}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="font-data text-[10px] text-[var(--color-text-muted)]">
              {formatRelativeTime(createdAt)}
            </span>
            {insight.relatedCardIds.length > 0 && (
              <span className="font-data text-[10px] text-[var(--color-accent-dim)]">
                {insight.relatedCardIds.length} related card{insight.relatedCardIds.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleDismiss}
            title="Dismiss"
            className="p-1.5 rounded hover:bg-red-500/20 text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
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
        <div className="px-4 pb-4 pt-0 border-t border-[var(--color-border)] space-y-3">
          {/* Full summary */}
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed pt-3">
            {insight.summary}
          </p>

          {/* Related card IDs */}
          {insight.relatedCardIds.length > 0 && (
            <div>
              <p className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)] mb-2">
                Related Cards
              </p>
              <div className="flex flex-wrap gap-1.5">
                {insight.relatedCardIds.map(cardId => (
                  <span
                    key={cardId}
                    className="font-data text-[10px] px-2 py-0.5 rounded bg-[var(--color-accent-subtle)] text-[var(--color-accent-dim)] border border-[var(--color-border-accent)]"
                  >
                    {cardId.slice(0, 8)}...
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Actions row */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleDismiss}
              className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-red-400 border border-[var(--color-border)] hover:border-red-500/40 px-3 py-1.5 transition-all"
            >
              <X size={12} />
              Dismiss
            </button>
            {insight.relatedCardIds.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Future: navigate to project board filtered to these cards
                }}
                className="flex items-center gap-1.5 text-xs text-[var(--color-accent)] border border-[var(--color-border-accent)] hover:border-[var(--color-accent)] px-3 py-1.5 transition-all"
              >
                <ExternalLink size={12} />
                View Cards
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
