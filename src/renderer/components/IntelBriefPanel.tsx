// === FILE PURPOSE ===
// Collapsible AI brief panel for the Intelligence Feed.
// Displays daily or weekly intelligence briefs with rich formatted content.

import { useState } from 'react';
import { Brain, ChevronDown, ChevronUp, RefreshCw, Loader2, Newspaper } from 'lucide-react';
import type { IntelBrief, IntelBriefType, IntelChatMessage } from '../../shared/types';
import IntelBriefChat from './IntelBriefChat';

interface IntelBriefPanelProps {
  brief: IntelBrief | null;
  briefType: IntelBriefType;
  loading: boolean;
  onGenerate: () => void;
  onSetType: (type: IntelBriefType) => void;
  chatMessages: IntelChatMessage[];
  chatSending: boolean;
  onSendChat: (content: string) => void;
  onClearChat: () => void;
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

/** Strip JSON blocks that the AI appends for parsing (categories, relevance). */
function stripJsonBlocks(content: string): string {
  return content.replace(/```json[\s\S]*?```/g, '').trimEnd();
}

/** Parse inline bold markers **text** into spans. */
function parseInlineBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-[var(--color-text-primary)] font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/** Render brief content as richly formatted elements. */
function renderBriefContent(content: string): React.ReactNode[] {
  const cleaned = stripJsonBlocks(content);
  const lines = cleaned.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listKey = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${listKey++}`} className="space-y-1.5 mb-4 pl-1">
          {listItems}
        </ul>,
      );
      listItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    // Section header (## Heading)
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <div key={i} className="mt-5 first:mt-0 mb-3">
          <div className="flex items-center gap-3">
            <h3 className="font-hud text-sm tracking-wide text-[var(--color-accent)] text-glow whitespace-nowrap">
              {trimmed.slice(3)}
            </h3>
            <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-20" />
          </div>
        </div>,
      );
    }
    // Sub-header (### Heading)
    else if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h4 key={i} className="text-sm font-semibold text-[var(--color-text-primary)] mt-3 mb-2">
          {trimmed.slice(4)}
        </h4>,
      );
    }
    // Bullet points
    else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const bulletText = trimmed.slice(2);
      listItems.push(
        <li key={i} className="flex gap-2.5 text-sm text-[var(--color-text-secondary)] leading-relaxed">
          <span className="text-[var(--color-accent)] shrink-0 mt-1 text-xs">&#9670;</span>
          <span>{parseInlineBold(bulletText)}</span>
        </li>,
      );
    }
    // Numbered list
    else if (/^\d+\.\s/.test(trimmed)) {
      const bulletText = trimmed.replace(/^\d+\.\s/, '');
      listItems.push(
        <li key={i} className="flex gap-2.5 text-sm text-[var(--color-text-secondary)] leading-relaxed">
          <span className="text-[var(--color-accent)] shrink-0 mt-0.5 text-xs font-data">{trimmed.match(/^\d+/)?.[0]}.</span>
          <span>{parseInlineBold(bulletText)}</span>
        </li>,
      );
    }
    // Regular paragraph
    else {
      flushList();
      elements.push(
        <p key={i} className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-3">
          {parseInlineBold(trimmed)}
        </p>,
      );
    }
  }

  flushList();
  return elements;
}

export default function IntelBriefPanel({
  brief,
  briefType,
  loading,
  onGenerate,
  onSetType,
  chatMessages,
  chatSending,
  onSendChat,
  onClearChat,
}: IntelBriefPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const typeLabel = briefType === 'daily' ? 'Daily' : 'Weekly';

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] mb-6 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer select-none hover:bg-[var(--color-accent-subtle)] transition-colors"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-accent-muted)] flex items-center justify-center">
            <Brain size={18} className="text-[var(--color-accent)]" />
          </div>
          <div>
            <span className="font-hud text-base text-[var(--color-accent)] text-glow">
              {typeLabel} Intelligence Brief
            </span>
            {brief && (
              <span className="block text-[11px] font-data text-[var(--color-text-muted)]">
                {brief.articleCount} articles analyzed &bull; Generated {relativeTime(brief.generatedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Daily / Weekly toggle */}
          <div
            className="flex rounded-lg border border-[var(--color-border)] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => onSetType('daily')}
              className={`cursor-pointer px-3 py-1 text-xs font-medium transition-colors ${
                briefType === 'daily'
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              Daily
            </button>
            <button
              onClick={() => onSetType('weekly')}
              className={`cursor-pointer px-3 py-1 text-xs font-medium transition-colors ${
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
              className="cursor-pointer flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-border-accent)] transition-colors"
            >
              <RefreshCw size={12} />
              {brief ? 'Regenerate' : 'Generate'}
            </button>
          )}

          {/* Collapse toggle */}
          {collapsed ? (
            <ChevronDown size={18} className="text-[var(--color-text-muted)]" />
          ) : (
            <ChevronUp size={18} className="text-[var(--color-text-muted)]" />
          )}
        </div>
      </div>

      {/* Body (collapsible) */}
      {!collapsed && (
        <div className="border-t border-[var(--color-border)]">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <div className="w-10 h-10 rounded-full bg-[var(--color-accent-muted)] flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-[var(--color-accent)]" />
              </div>
              <span className="text-sm text-[var(--color-text-muted)]">
                Generating your intelligence brief...
              </span>
              <span className="text-xs text-[var(--color-text-muted)] opacity-60">
                Analyzing articles and ranking by relevance
              </span>
            </div>
          ) : brief ? (
            <div className="flex">
              {/* Brief content — left side */}
              <div className="flex-1 px-6 py-5 min-w-0 overflow-y-auto max-h-[600px]">
                {renderBriefContent(brief.content)}
              </div>

              {/* Divider */}
              <div className="w-px bg-[var(--color-border)]" />

              {/* Chat — right side */}
              <div className="w-[400px] shrink-0 max-h-[600px]">
                <IntelBriefChat
                  messages={chatMessages}
                  sending={chatSending}
                  hasBrief={true}
                  onSend={onSendChat}
                  onClear={onClearChat}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center py-10 gap-3">
              <div className="w-12 h-12 rounded-full bg-[var(--color-accent-subtle)] flex items-center justify-center">
                <Newspaper size={22} className="text-[var(--color-accent-dim)]" />
              </div>
              <p className="text-sm text-[var(--color-text-muted)]">No brief generated yet</p>
              <p className="text-xs text-[var(--color-text-muted)] opacity-60 max-w-xs text-center">
                Generate an AI-powered summary of today's most important articles
              </p>
              <button
                onClick={onGenerate}
                className="cursor-pointer mt-1 px-4 py-2 text-sm rounded-lg border border-[var(--color-border-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)] transition-colors font-medium"
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
