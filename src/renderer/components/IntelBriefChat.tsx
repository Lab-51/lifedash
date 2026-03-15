// === FILE PURPOSE ===
// Chat panel for discussing intelligence briefs with AI.
// Renders alongside the brief content in a two-column layout.

import { useState, useRef, useEffect } from 'react';
import { Send, Trash2, MessageSquare, Loader2 } from 'lucide-react';
import type { IntelChatMessage } from '../../shared/types';

interface IntelBriefChatProps {
  messages: IntelChatMessage[];
  sending: boolean;
  hasBrief: boolean;
  onSend: (content: string) => void;
  onClear: () => void;
}

const STARTER_SUGGESTIONS = ["What are today's biggest themes?", 'Any security concerns?', 'What should I act on?'];

/** Parse **bold** markers into spans. */
function parseInlineBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="text-[var(--color-text-primary)] font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

/** Render assistant message content with basic formatting. */
function renderMessageContent(content: string): React.ReactNode {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listKey = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${listKey++}`} className="space-y-0.5 my-1 pl-3">
          {listItems}
        </ul>,
      );
      listItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      listItems.push(
        <li key={i} className="flex gap-1.5 text-sm leading-relaxed">
          <span className="text-[var(--color-accent)] shrink-0 mt-0.5">-</span>
          <span>{parseInlineBold(trimmed.slice(2))}</span>
        </li>,
      );
    } else if (/^\d+\.\s/.test(trimmed)) {
      const bulletText = trimmed.replace(/^\d+\.\s/, '');
      const num = trimmed.match(/^\d+/)?.[0];
      listItems.push(
        <li key={i} className="flex gap-1.5 text-sm leading-relaxed">
          <span className="text-[var(--color-accent)] shrink-0">{num}.</span>
          <span>{parseInlineBold(bulletText)}</span>
        </li>,
      );
    } else {
      flushList();
      elements.push(
        <span key={i} className="block text-sm leading-relaxed">
          {parseInlineBold(trimmed)}
        </span>,
      );
    }
  }

  flushList();
  return elements;
}

export default function IntelBriefChat({ messages, sending, hasBrief, onSend, onClear }: IntelBriefChatProps) {
  const [input, setInput] = useState('');
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll only the chat container, not the parent page
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, sending]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    onSend(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-[var(--color-accent)]" />
          <span className="text-sm font-hud text-[var(--color-accent)] text-glow">Brief Discussion</span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={onClear}
            className="cursor-pointer p-1 rounded hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            title="Clear chat"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && !sending ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-6">
            <p className="text-sm text-[var(--color-text-muted)] text-center leading-relaxed max-w-[280px]">
              {hasBrief
                ? 'Ask about the brief — implications, trends, or what to watch for.'
                : 'Generate a brief first, then discuss it here.'}
            </p>
            {hasBrief && (
              <div className="flex flex-col gap-1.5 w-full mt-1">
                {STARTER_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => onSend(suggestion)}
                    className="cursor-pointer text-left px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-border-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-lg ${
                    msg.role === 'user'
                      ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                      : 'bg-[var(--color-chrome)] text-[var(--color-text-secondary)] border border-[var(--color-border)]'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <span className="text-sm leading-relaxed">{parseInlineBold(msg.content)}</span>
                  ) : (
                    <div className="space-y-1">{renderMessageContent(msg.content)}</div>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {sending && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-lg bg-[var(--color-chrome)] border border-[var(--color-border)]">
                  <div className="flex items-center gap-1">
                    <Loader2 size={12} className="animate-spin text-[var(--color-accent)]" />
                    <span className="text-sm text-[var(--color-text-muted)]">Thinking...</span>
                  </div>
                </div>
              </div>
            )}

            <div />
          </>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasBrief ? 'Ask about the brief...' : 'Generate a brief first'}
            disabled={!hasBrief || sending}
            className="flex-1 px-3 py-2 text-sm rounded-lg bg-[var(--color-chrome)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-accent)] disabled:opacity-50 transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending || !hasBrief}
            className="cursor-pointer p-2 rounded-lg bg-[var(--color-accent-muted)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white disabled:opacity-30 disabled:hover:bg-[var(--color-accent-muted)] disabled:hover:text-[var(--color-accent)] transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
