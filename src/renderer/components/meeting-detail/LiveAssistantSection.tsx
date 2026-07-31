// === FILE PURPOSE ===
// Post-meeting assistant chat, shown in the session page after a meeting
// completes (BRAIN-UX.1 Task 5 — was read-only until then). It continues the
// SAME per-meeting thread the Live Assistant used during the recording, over the
// same `meeting-agent:send` channel and streaming events; main swaps in a
// read-only Q&A toolset for completed meetings, so here the assistant answers
// questions about the transcript but takes no actions.
//
// Uses its own local state (not meetingAgentStore) so it never shares state with
// a concurrently-open LiveModeOverlay chat for a different, still-recording
// meeting — the store is single-thread and would cross the two. The streaming
// wiring below therefore mirrors meetingAgentStore.send()'s listener lifecycle:
// listeners are registered per send and torn down in `finally`, plus on unmount.

import { useCallback, useEffect, useRef, useState } from 'react';
import { SendHorizonal, Square, Loader2, Bot, Info } from 'lucide-react';
import ChatMessageModern from '../ChatMessageModern';
import { describeToolCall, describeToolEvent } from '../../utils/toolCallLabels';
import type { MeetingAgentMessage, BrainstormMessage } from '../../../shared/types';

/** Actionable copy for the one error the user can actually fix themselves. */
const NO_MODEL_MESSAGE =
  'No AI model is assigned to the Live Assistant. Open Settings → AI to assign one, then ask again — the model runs locally, so this meeting never leaves your machine.';

/**
 * Turn an IPC failure into something worth showing: Electron wraps handler
 * errors as `Error invoking remote method 'x': Error: <message>`, and the
 * no-provider case gets copy that says what to do about it.
 */
export function toDisplayError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/no ai provider/i.test(raw)) return NO_MODEL_MESSAGE;
  return raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '');
}

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
function AssistantMessage({ message }: { message: MeetingAgentMessage }) {
  return (
    <div>
      {message.content && <ChatMessageModern message={toBrainstormMessage(message, message.content)} />}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="flex flex-col gap-1 mb-4 -mt-2 px-1">
          {message.toolCalls.map((call, i) => (
            <span key={call.id || i} className="text-[0.6875rem] font-data text-[var(--color-text-muted)]">
              {describeToolCall(call)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface LiveAssistantSectionProps {
  meetingId: string;
  /** 'rail' (default): compact card with a capped message area — right rail /
   *  SessionInspector. 'canvas': fills the height its flex parent grants it —
   *  the completed-session center canvas, where the chat is the primary surface. */
  variant?: 'rail' | 'canvas';
}

/** Per-variant presentation, resolved once — keeps the component's own branching
 *  flat (complexity ceiling) and the two layouts diffable side by side. */
const VARIANT_UI = {
  rail: {
    root: 'mb-5',
    card: 'rounded-xl bg-surface-100/50 dark:bg-surface-950/50 border border-[var(--color-border)]',
    scroll: 'max-h-80 overflow-y-auto p-4',
    inputRow: 'flex items-end gap-2 border-t border-[var(--color-border)] shrink-0 px-3 py-2.5',
    input: 'flex-1 text-xs px-2.5 py-2',
    inputStyle: { minHeight: '32px', maxHeight: '96px' },
  },
  canvas: {
    root: 'flex-1 min-h-0 flex flex-col pt-1',
    card: 'rounded-xl bg-surface-100/50 dark:bg-surface-950/50 border border-[var(--color-border)] flex-1 min-h-0 flex flex-col',
    scroll: 'flex-1 min-h-0 overflow-y-auto p-5',
    inputRow: 'flex items-end gap-2 border-t border-[var(--color-border)] shrink-0 px-4 py-3',
    input: 'flex-1 text-sm px-3 py-2.5',
    inputStyle: { minHeight: '40px', maxHeight: '140px' },
  },
} as const;

/** Empty-thread invitation — vertically centered when the chat owns the canvas. */
function EmptyThreadState({ variant }: { variant: 'rail' | 'canvas' }) {
  const canvas = variant === 'canvas';
  return (
    <div className={`flex flex-col items-center text-center ${canvas ? 'justify-center h-full py-10' : 'py-3'}`}>
      <div
        className={`bg-[var(--color-accent-muted)] rounded-full flex items-center justify-center mb-2 ${
          canvas ? 'w-12 h-12' : 'w-9 h-9'
        }`}
      >
        <Bot size={canvas ? 22 : 16} className="text-[var(--color-accent)]" />
      </div>
      <p className={`${canvas ? 'text-sm' : 'text-xs'} text-[var(--color-text-secondary)]`}>
        Ask anything about this meeting
      </p>
      <p className={`${canvas ? 'text-xs' : 'text-[0.6875rem]'} text-[var(--color-text-muted)] mt-1`}>
        Answers are grounded in the transcript, with [mm:ss] references.
      </p>
    </div>
  );
}

export default function LiveAssistantSection({ meetingId, variant = 'rail' }: LiveAssistantSectionProps) {
  const ui = VARIANT_UI[variant];
  const [messages, setMessages] = useState<MeetingAgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [activeTool, setActiveTool] = useState<{ toolName: string; args: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(false);
  const cleanupsRef = useRef<Array<() => void>>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .meetingAgentLoad(meetingId)
      .then((loaded) => {
        if (!cancelled) setMessages(loaded);
      })
      .catch(() => {
        // Best-effort — the conversation is a nice-to-have, not core meeting data.
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  // Unmount: drop any listeners a still-in-flight send registered, and stop
  // touching state (the main-process stream itself is unaffected and finishes).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupsRef.current.forEach((fn) => fn());
      cleanupsRef.current = [];
    };
  }, []);

  useEffect(() => {
    // Optional call: scrollIntoView exists in Chromium but not in jsdom, and a
    // missing scroll must never break a host page that embeds this section.
    endRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || streaming) return;

    setInput('');
    setError(null);
    setStreamingText('');
    setActiveTool(null);
    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        threadId: '',
        role: 'user',
        content,
        toolCalls: null,
        toolResults: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    const cleanups = [
      window.electronAPI.onMeetingAgentTextDelta((data) => {
        if (data.meetingId === meetingId) setStreamingText((text) => text + data.chunk);
      }),
      window.electronAPI.onMeetingAgentToolCall((data) => {
        if (data.meetingId === meetingId) setActiveTool({ toolName: data.toolName, args: data.args });
      }),
      window.electronAPI.onMeetingAgentError((data) => {
        if (data.meetingId === meetingId) setError(data.error);
      }),
    ];
    cleanupsRef.current = cleanups;

    try {
      const result = await window.electronAPI.meetingAgentSend(meetingId, content);
      if (result && mountedRef.current) setMessages((prev) => [...prev, result.assistantMessage]);
    } catch (err) {
      if (mountedRef.current) setError(toDisplayError(err));
    } finally {
      cleanups.forEach((fn) => fn());
      cleanupsRef.current = [];
      if (mountedRef.current) {
        setStreaming(false);
        setStreamingText('');
        setActiveTool(null);
      }
    }
  }, [input, streaming, meetingId]);

  return (
    <div className={ui.root}>
      <h3 className="font-hud text-xs text-[var(--color-text-secondary)] mb-3 shrink-0">
        Meeting Assistant
        {messages.length > 0 && (
          <span className="ml-2 text-surface-500">
            ({messages.length} message{messages.length !== 1 ? 's' : ''})
          </span>
        )}
      </h3>

      <div className={ui.card}>
        <div className={ui.scroll}>
          {messages.length === 0 && !streaming && <EmptyThreadState variant={variant} />}

          {messages.map((message) => (
            <AssistantMessage key={message.id} message={message} />
          ))}

          {streaming &&
            (streamingText ? (
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
                <span className="text-xs text-[var(--color-text-muted)] font-data">
                  {activeTool ? describeToolEvent(activeTool.toolName, activeTool.args) : 'Thinking...'}
                </span>
              </div>
            ))}

          {error && (
            <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <Info size={12} className="text-red-400 mt-0.5 shrink-0" />
              <span className="text-xs text-red-300">{error}</span>
            </div>
          )}

          <div ref={endRef} className="h-px" />
        </div>

        <div className={ui.inputRow}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            disabled={streaming}
            placeholder={streaming ? 'Answering…' : 'Ask about this meeting...'}
            aria-label="Ask about this meeting"
            rows={1}
            className={`${ui.input} bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-xl text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] resize-none transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
            style={ui.inputStyle}
          />

          {streaming ? (
            <button
              onClick={() => void window.electronAPI.meetingAgentStop(meetingId)}
              aria-label="Stop generating"
              title="Stop generating"
              className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => void handleSend()}
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
      </div>
    </div>
  );
}
