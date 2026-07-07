// === FILE PURPOSE ===
// The in-meeting "Live Assistant" chat — fills the right column of the Live Mode overlay.
// Mirrors CardAgentPanel's structure (loading skeleton, no-provider empty state,
// starter prompts, streaming bubble, tool-call badges, input + stop) but scoped to
// meetingAgentStore's single-thread-per-meeting model. Reuses ChatMessageModern for
// all markdown/streaming text rendering — this file only adds tool-call badges.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SendHorizonal, Square, Loader2, Bot, Settings, CheckCircle2, XCircle, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ChatMessageModern from './ChatMessageModern';
import { useMeetingAgentStore } from '../stores/meetingAgentStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useBoardStore } from '../stores/boardStore';
import { describeToolEvent, describeToolCall } from '../utils/toolCallLabels';
import type { MeetingAgentMessage, BrainstormMessage } from '../../shared/types';

const STARTER_PROMPTS = [
  'Summarize the meeting so far',
  'What questions are still open?',
  'Create a card for that last point',
];

function toBrainstormMessage(message: MeetingAgentMessage, content: string): BrainstormMessage {
  return {
    id: message.id,
    sessionId: message.threadId,
    role: message.role === 'user' ? 'user' : 'assistant',
    content,
    createdAt: message.createdAt,
  };
}

/** One persisted message: markdown content (if any) + tool-call badges (if any). */
function MeetingMessage({ message }: { message: MeetingAgentMessage }) {
  return (
    <div>
      {message.content && <ChatMessageModern message={toBrainstormMessage(message, message.content)} />}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="flex flex-col gap-1 mb-4 -mt-1 px-1">
          {message.toolCalls.map((call, i) => {
            const result = message.toolResults?.find((r) => r.toolCallId === call.id);
            const failed = result && (result.result as Record<string, unknown> | undefined)?.success === false;
            return (
              <div key={call.id || i} className="flex items-center gap-1.5">
                {failed ? (
                  <XCircle size={11} className="text-red-500 shrink-0" />
                ) : (
                  <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
                )}
                <span className="text-[0.6875rem] font-data text-[var(--color-text-secondary)]">
                  {describeToolCall(call)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function LiveAssistantChat({ meetingId }: { meetingId: string }) {
  const messages = useMeetingAgentStore((s) => s.messages);
  const streaming = useMeetingAgentStore((s) => s.streaming);
  const streamingText = useMeetingAgentStore((s) => s.streamingText);
  const toolEvents = useMeetingAgentStore((s) => s.toolEvents);
  const loading = useMeetingAgentStore((s) => s.loading);
  const error = useMeetingAgentStore((s) => s.error);
  const load = useMeetingAgentStore((s) => s.load);
  const send = useMeetingAgentStore((s) => s.send);
  const stop = useMeetingAgentStore((s) => s.stop);
  const providers = useSettingsStore((s) => s.providers);
  const hasAnyEnabledProvider = useSettingsStore((s) => s.hasAnyEnabledProvider);
  const navigate = useNavigate();

  // Collapse the flat call/result event stream into ONE row per tool invocation that
  // transitions loading -> done, instead of rendering a separate (perpetually
  // "…-ing") row for the call AND the result. A 'result' resolves the most recent
  // still-pending call of the same tool (handles the same tool being used twice).
  const toolSteps = useMemo(() => {
    const steps: { toolName: string; args?: unknown; done: boolean }[] = [];
    for (const te of toolEvents) {
      if (te.type === 'call') {
        steps.push({ toolName: te.toolName, args: te.args, done: false });
      } else {
        for (let i = steps.length - 1; i >= 0; i--) {
          if (steps[i].toolName === te.toolName && !steps[i].done) {
            steps[i] = { ...steps[i], done: true };
            break;
          }
        }
      }
    }
    return steps;
  }, [toolEvents]);

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userScrolledUpRef = useRef(false);

  // Load this meeting's thread + ensure providers are loaded for the empty-state check.
  useEffect(() => {
    void load(meetingId);
    if (providers.length === 0) {
      void useSettingsStore.getState().loadProviders();
    }
  }, [meetingId, load, providers.length]);

  // Track whether the user has scrolled up, so streaming text doesn't yank them back down.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 80;
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [meetingId]);

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingText]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 96) + 'px';
    }
  }, []);

  const handleSend = useCallback(
    async (overrideContent?: string) => {
      const content = overrideContent ?? input.trim();
      if (!content || streaming) return;
      if (!overrideContent) {
        setInput('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      }
      userScrolledUpRef.current = false;
      await send(meetingId, content);

      // If the assistant created a card, refresh the currently loaded board so it
      // appears immediately (mirrors CardAgentPanel's write-tool board refresh).
      const latest = useMeetingAgentStore.getState().messages;
      const lastMessage = latest[latest.length - 1];
      if (lastMessage?.role === 'assistant' && lastMessage.toolCalls?.some((c) => c.name === 'createCardInInbox')) {
        const projectId = useBoardStore.getState().project?.id;
        if (projectId) void useBoardStore.getState().loadBoard(projectId);
      }
    },
    [input, streaming, send, meetingId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  // Loading skeleton
  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-3 animate-pulse">
        <div className="h-8 bg-[var(--color-accent-subtle)] rounded-xl w-3/4" />
        <div className="h-8 bg-[var(--color-accent-subtle)] rounded-xl w-1/2 self-end" />
      </div>
    );
  }

  // No AI provider configured for the Live Assistant
  if (!hasAnyEnabledProvider() && messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-5 py-6 text-center">
        <div className="w-10 h-10 bg-amber-500/10 rounded-full flex items-center justify-center mb-3">
          <Settings size={20} className="text-amber-500" />
        </div>
        <p className="text-sm font-medium text-[var(--color-text-primary)] mb-1">No AI provider configured</p>
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          Configure an AI provider in Settings to use the Live Assistant.
        </p>
        <button
          onClick={() => navigate('/settings')}
          className="text-xs text-[var(--color-accent)] hover:underline font-medium"
        >
          Open Settings
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Message list */}
      <div ref={messagesContainerRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3 scroll-smooth">
        {/* Starter prompts */}
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center py-3 px-1">
            <div className="w-10 h-10 bg-[var(--color-accent-muted)] rounded-full flex items-center justify-center mb-3">
              <Bot size={18} className="text-[var(--color-accent)]" />
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] mb-3 text-center">
              Ask the Live Assistant about this meeting.
            </p>
            <div className="flex flex-col gap-1.5 w-full">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSend(prompt)}
                  className="hud-panel clip-corner-cut-sm px-3 py-2 hover:border-[var(--color-accent-dim)] cursor-pointer transition-colors text-left text-xs text-[var(--color-text-secondary)]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Persisted messages */}
        {messages.map((message) => (
          <MeetingMessage key={message.id} message={message} />
        ))}

        {/* Streaming assistant response */}
        {streaming && (
          <div>
            {streamingText ? (
              <ChatMessageModern
                message={{
                  id: '__streaming__',
                  sessionId: '',
                  role: 'assistant',
                  content: streamingText,
                  createdAt: new Date().toISOString(),
                }}
              />
            ) : (
              <div className="flex items-center gap-2 px-1">
                <Loader2 size={14} className="animate-spin text-[var(--color-accent)]" />
                <span className="text-xs text-[var(--color-text-muted)] font-data">Thinking...</span>
              </div>
            )}

            {toolSteps.length > 0 && (
              <div className="border-l-2 border-[var(--color-border)] pl-3 ml-2 mt-1 space-y-1">
                {toolSteps.map((te, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    {te.done ? (
                      <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
                    ) : (
                      <Loader2 size={11} className="animate-spin text-amber-500 shrink-0" />
                    )}
                    <span className={`text-[0.6875rem] font-data ${te.done ? 'text-emerald-500' : 'text-amber-500'}`}>
                      {te.done
                        ? describeToolCall({
                            id: '',
                            name: te.toolName,
                            args: (te.args as Record<string, unknown>) ?? {},
                          })
                        : describeToolEvent(te.toolName, te.args)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error state */}
        {error && !streaming && (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <Info size={12} className="text-red-400 mt-0.5 shrink-0" />
            <span className="text-xs text-red-300">{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} className="h-1" />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-[var(--color-border)] px-3 py-2.5">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoResize();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask the Live Assistant..."
            aria-label="Ask the Live Assistant"
            rows={1}
            className="flex-1 text-xs bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-xl px-2.5 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] resize-none transition-all"
            style={{ minHeight: '32px', maxHeight: '96px' }}
          />

          {streaming ? (
            <button
              onClick={() => stop(meetingId)}
              aria-label="Stop generating"
              title="Stop generating"
              className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              aria-label="Send message"
              title="Send message"
              className={`p-2 rounded-xl transition-colors ${
                input.trim()
                  ? 'btn-primary'
                  : 'bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] text-[var(--color-text-muted)] cursor-not-allowed'
              }`}
            >
              <SendHorizonal size={14} />
            </button>
          )}
        </div>
        <p className="text-[0.625rem] text-[var(--color-text-muted)] font-data mt-1">
          Enter to send &middot; Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
