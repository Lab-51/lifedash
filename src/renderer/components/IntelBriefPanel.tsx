// === FILE PURPOSE ===
// Collapsible AI brief panel for the Intelligence Feed.
// Displays daily or weekly intelligence briefs with simple text formatting.

import { useState } from 'react';
import { Brain, ChevronDown, ChevronUp, RefreshCw, Loader2 } from 'lucide-react';
import type { IntelBrief, IntelBriefType } from '../../shared/types';

interface IntelBriefPanelProps {
  brief: IntelBrief | null;
  briefType: IntelBriefType;
  loading: boolean;
  onGenerate: () => void;
  onSetType: (type: IntelBriefType) => void;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Strip the JSON categories block that the AI appends for parsing. */
function stripJsonBlock(content: string): string {
  const jsonIdx = content.indexOf('```json');
  if (jsonIdx !== -1) {
    return content.slice(0, jsonIdx).trimEnd();
  }
  return content;
}

/** Render brief content as simple formatted elements. */
function renderBriefContent(content: string): React.ReactNode[] {
  const cleaned = stripJsonBlock(content);
  const lines = cleaned.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) continue;

    if (trimmed.startsWith('## ')) {
      elements.push(
        <div key={i} className="mt-3 first:mt-0">
          <h4 className="text-xs font-bold text-[var(--color-accent)] tracking-wide uppercase mb-1">
            {trimmed.slice(3)}
          </h4>
          <div className="h-px bg-[var(--color-border)] opacity-30 mb-2" />
        </div>,
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        <div key={i} className="flex gap-2 text-xs text-[var(--color-text-secondary)] leading-relaxed mb-1 pl-2">
          <span className="text-[var(--color-accent-dim)] shrink-0 mt-0.5">-</span>
          <span>{trimmed.slice(2)}</span>
        </div>,
      );
    } else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      elements.push(
        <p key={i} className="text-xs font-semibold text-[var(--color-text-primary)] mb-1">
          {trimmed.slice(2, -2)}
        </p>,
      );
    } else {
      elements.push(
        <p key={i} className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-1">
          {trimmed}
        </p>,
      );
    }
  }

  return elements;
}

export default function IntelBriefPanel({
  brief,
  briefType,
  loading,
  onGenerate,
  onSetType,
}: IntelBriefPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const typeLabel = briefType === 'daily' ? 'Daily' : 'Weekly';

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] border-l-2 border-l-[var(--color-accent)] mb-4 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-[var(--color-accent-subtle)] transition-colors"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-[var(--color-accent)]" />
          <span className="font-hud text-sm text-[var(--color-accent)] text-glow">
            {typeLabel} Intelligence Brief
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Daily / Weekly toggle */}
          <div
            className="flex rounded border border-[var(--color-border)] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => onSetType('daily')}
              className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                briefType === 'daily'
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              Daily
            </button>
            <button
              onClick={() => onSetType('weekly')}
              className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                briefType === 'weekly'
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              Weekly
            </button>
          </div>

          {/* Generate / Regenerate button */}
          {!loading && (
            <button
              onClick={e => {
                e.stopPropagation();
                onGenerate();
              }}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-border-accent)] transition-colors"
            >
              <RefreshCw size={10} />
              {brief ? 'Regenerate' : 'Generate'}
            </button>
          )}

          {/* Collapse toggle */}
          {collapsed ? (
            <ChevronDown size={16} className="text-[var(--color-text-muted)]" />
          ) : (
            <ChevronUp size={16} className="text-[var(--color-text-muted)]" />
          )}
        </div>
      </div>

      {/* Body (collapsible) */}
      {!collapsed && (
        <div className="px-4 pb-3 border-t border-[var(--color-border)]">
          {loading ? (
            <div className="flex items-center gap-2 py-6 justify-center">
              <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
              <span className="text-xs text-[var(--color-text-muted)]">
                Generating intelligence brief...
              </span>
            </div>
          ) : brief ? (
            <>
              <div className="mt-3">{renderBriefContent(brief.content)}</div>
              <div className="mt-3 pt-2 border-t border-[var(--color-border)] opacity-60">
                <span className="text-[10px] font-data text-[var(--color-text-muted)]">
                  Generated {relativeTime(brief.generatedAt)} &bull; {brief.articleCount} articles analyzed
                </span>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center py-6 gap-2">
              <p className="text-xs text-[var(--color-text-muted)]">No brief yet</p>
              <button
                onClick={onGenerate}
                className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)] transition-colors"
              >
                Generate Brief
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
