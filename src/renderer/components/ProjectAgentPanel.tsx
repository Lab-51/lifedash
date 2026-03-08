// === FILE PURPOSE ===
// Chat panel for per-project AI agent conversations.
// Renders a vertically structured chat UI with markdown-formatted assistant
// responses, streaming support, starter prompts, and input area.

import { useState, useEffect, useRef, useCallback } from 'react';
import { SendHorizonal, Square, Trash2, Loader2, AlertCircle, ArrowUpDown, CalendarCheck, BarChart3, Bot, Copy, CheckCircle2, XCircle, Settings } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import AgentThreadBar from './AgentThreadBar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router-dom';
import { useProjectAgentStore } from '../stores/projectAgentStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { ProjectAgentMessage } from '../../shared/types/project-agent';
import type { ToolCallRecord } from '../../shared/types/card-agent';

// Markdown component overrides for assistant messages
const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-lg font-bold mt-4 mb-2 first:mt-0 text-surface-900 dark:text-surface-100">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-base font-bold mt-3 mb-2 text-surface-900 dark:text-surface-100">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-bold mt-3 mb-1 text-surface-900 dark:text-surface-100">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-3 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-4 mb-3 space-y-1 marker:text-surface-400">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-4 mb-3 space-y-1 marker:text-surface-400">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="pl-1">{children}</li>
  ),
  code: ({ className, children, ...props }: { className?: string; children?: React.ReactNode }) => {
    const isInline = !className;
    return isInline
      ? <code className="bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 rounded text-xs font-mono text-primary-600 dark:text-primary-400 font-semibold border border-surface-200 dark:border-surface-700">{children}</code>
      : <code className={`${className} block bg-surface-50 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 p-3 rounded-lg text-xs font-mono overflow-x-auto my-3`} {...props}>{children}</code>;
  },
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="not-prose bg-transparent p-0 m-0">{children}</pre>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} className="text-primary-600 dark:text-primary-400 hover:underline font-medium" target="_blank" rel="noopener noreferrer">{children}</a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-4 border-primary-200 dark:border-surface-700 pl-4 italic text-surface-500 my-3">{children}</blockquote>
  ),
  hr: () => <hr className="border-surface-200 dark:border-surface-800 my-4" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-3"><table className="border-collapse border border-surface-200 dark:border-surface-700 w-full text-xs">{children}</table></div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-surface-200 dark:border-surface-700 px-3 py-2 bg-surface-50 dark:bg-surface-800 font-semibold text-left">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-surface-200 dark:border-surface-700 px-3 py-2">{children}</td>
  ),
};

const STARTER_PROMPTS = [
  { text: "What's blocking progress?", icon: AlertCircle },
  { text: 'Prioritize my backlog', icon: ArrowUpDown },
  { text: 'Plan next sprint', icon: CalendarCheck },
  { text: "Summarize this week's progress", icon: BarChart3 },
];

// Write tools that modify project data — require board refresh
const WRITE_TOOLS = new Set(['moveCard', 'createBoard']);

/** Generate a human-readable description for a live tool event (present tense) */
function describeToolEvent(toolName: string, args?: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case 'listBoards': return 'Fetching boards';
    case 'listColumnCards': return 'Browsing cards';
    case 'moveCard': return 'Moving card';
    case 'createBoard': return `Creating board: "${a.name ?? ''}"`;
    case 'getProjectStats': return 'Analyzing project';
    case 'getActionItems': return 'Checking action items';
    case 'getRecentActivity': return 'Reviewing activity';
    case 'searchProjectCards': return 'Searching cards';
    default: return `Running ${toolName}`;
  }
}

/** Generate a human-readable description for a persisted tool call (past tense) */
function describeToolCall(call: ToolCallRecord): string {
  const a = call.args;
  switch (call.name) {
    case 'listBoards': return 'Fetched boards';
    case 'listColumnCards': return 'Browsed cards';
    case 'moveCard': return 'Moved card';
    case 'createBoard': return `Created board: "${a.name ?? ''}"`;
    case 'getProjectStats': return 'Analyzed project';
    case 'getActionItems': return 'Checked action items';
    case 'getRecentActivity': return 'Reviewed activity';
    case 'searchProjectCards': return 'Searched cards';
    default: return `Ran ${call.name}`;
  }
}

interface ProjectAgentPanelProps {
  projectId: string;
  onWriteAction?: () => void;  // callback when write tools execute — parent refreshes board
}

export default function ProjectAgentPanel({ projectId, onWriteAction }: ProjectAgentPanelProps) {
  const messages = useProjectAgentStore(s => s.messages);
  const streaming = useProjectAgentStore(s => s.streaming);
  const streamingText = useProjectAgentStore(s => s.streamingText);
  const toolEvents = useProjectAgentStore(s => s.toolEvents);
  const actions = useProjectAgentStore(s => s.actions);
  const loading = useProjectAgentStore(s => s.loading);
  const loadMessages = useProjectAgentStore(s => s.loadMessages);
  const sendMessage = useProjectAgentStore(s => s.sendMessage);
  const abort = useProjectAgentStore(s => s.abort);
  const threads = useProjectAgentStore(s => s.threads);
  const activeThreadId = useProjectAgentStore(s => s.activeThreadId);
  const threadsLoading = useProjectAgentStore(s => s.threadsLoading);
  const loadThreads = useProjectAgentStore(s => s.loadThreads);
  const switchThread = useProjectAgentStore(s => s.switchThread);
  const newThread = useProjectAgentStore(s => s.newThread);
  const deleteThread = useProjectAgentStore(s => s.deleteThread);
  const providers = useSettingsStore(s => s.providers);
  const navigate = useNavigate();

  const [input, setInput] = useState('');
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [modelInfo, setModelInfo] = useState<{ providerName: string; model: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userScrolledUpRef = useRef(false);

  // Load messages + threads on mount, ensure providers are loaded for the empty-state check
  useEffect(() => {
    loadMessages(projectId);
    loadThreads(projectId);
    if (providers.length === 0) {
      useSettingsStore.getState().loadProviders();
    }
    window.electronAPI.projectAgentGetModelInfo().then(setModelInfo).catch(() => {});
  }, [projectId, loadMessages, loadThreads, providers.length]);

  // Track whether user has scrolled up
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 80;
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [projectId]);

  // Auto-scroll on new messages/streaming chunks
  useEffect(() => {
    if (!userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingText]);

  // Textarea auto-resize
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 96) + 'px';
    }
  }, []);

  const handleSend = useCallback(async (overrideContent?: string) => {
    const content = overrideContent ?? input.trim();
    if (!content || streaming) return;
    if (!overrideContent) {
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }
    // Force scroll to bottom on user send
    userScrolledUpRef.current = false;
    await sendMessage(projectId, content);
    // Refresh board if the agent used write tools
    const latestActions = useProjectAgentStore.getState().actions;
    if (latestActions.some(a => WRITE_TOOLS.has(a.toolName))) {
      onWriteAction?.();
    }
    // Update message count for the agent button badge
    useProjectAgentStore.getState().loadMessageCount(projectId);
  }, [input, streaming, sendMessage, projectId, onWriteAction]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleClear = useCallback(() => {
    setClearConfirmOpen(true);
  }, []);

  const confirmClear = useCallback(async () => {
    setClearConfirmOpen(false);
    if (activeThreadId) {
      await deleteThread(projectId, activeThreadId);
    } else {
      newThread();
    }
  }, [activeThreadId, deleteThread, newThread, projectId]);

  // Suppress unused variable warning — actions is read via getState() after send
  void actions;

  // Loading skeleton
  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-4 animate-pulse">
        <div className="h-10 bg-[var(--color-accent-subtle)] rounded-xl w-3/4" />
        <div className="h-10 bg-[var(--color-accent-subtle)] rounded-xl w-1/2 self-end" />
        <div className="h-10 bg-[var(--color-accent-subtle)] rounded-xl w-2/3" />
      </div>
    );
  }

  // No AI provider configured
  if (providers.length === 0 && messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
        <div className="w-12 h-12 bg-amber-500/10 rounded-full flex items-center justify-center mb-4">
          <Settings size={24} className="text-amber-500" />
        </div>
        <p className="text-sm font-medium text-[var(--color-text-primary)] mb-2">No AI provider configured</p>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">Configure an AI provider in Settings to use the project agent.</p>
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
    <>
    <div className="flex flex-col h-full">
      {/* Thread bar — only when there are threads or an active conversation */}
      {(threads.length > 0 || messages.length > 0) && (
        <AgentThreadBar
          threads={threads}
          activeThreadId={activeThreadId}
          onSelect={(id) => switchThread(projectId, id)}
          onNew={() => newThread()}
          onDelete={(id) => deleteThread(projectId, id)}
          loading={threadsLoading}
        />
      )}

      {/* Message list */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scroll-smooth"
      >
        {/* Starter prompts */}
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center py-8 px-2">
            <div className="w-12 h-12 bg-[var(--color-accent-muted)] rounded-full flex items-center justify-center mb-4">
              <Bot size={24} className="text-[var(--color-accent)]" />
            </div>
            <p className="font-hud text-sm tracking-widest uppercase text-[var(--color-accent)] mb-1">Project Agent</p>
            <p className="text-xs text-[var(--color-text-secondary)] mb-1 text-center font-data">Ask me anything about this project.</p>
            {modelInfo && (
              <p className="text-[0.625rem] text-[var(--color-text-muted)] mb-5 text-center font-data">
                Using <span className="font-medium text-[var(--color-text-secondary)]">{modelInfo.model}</span>
                <span className="text-[var(--color-text-muted)]"> via </span>
                <span className="font-medium text-[var(--color-text-secondary)] capitalize">{modelInfo.providerName}</span>
              </p>
            )}
            {!modelInfo && <div className="mb-5" />}
            <div className="grid grid-cols-2 gap-2 w-full">
              {STARTER_PROMPTS.map((prompt) => {
                const Icon = prompt.icon;
                return (
                  <button
                    key={prompt.text}
                    onClick={() => handleSend(prompt.text)}
                    className="hud-panel clip-corner-cut-sm p-3 hover:border-[var(--color-accent-dim)] cursor-pointer transition-colors text-left group"
                  >
                    <Icon size={14} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] mb-1.5 transition-colors" />
                    <p className="text-xs text-[var(--color-text-secondary)] leading-snug font-data">{prompt.text}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming assistant bubble */}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[90%] bg-[var(--color-chrome)] border border-[var(--color-border)] rounded-2xl rounded-tl-sm p-5">
              {streamingText ? (
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-[var(--color-text-primary)]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents as never}>
                    {streamingText}
                  </ReactMarkdown>
                  <span className="inline-block w-1.5 h-4 bg-[var(--color-accent)] animate-pulse ml-0.5 align-text-bottom" />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-[var(--color-accent)]" />
                  <span className="text-sm text-[var(--color-text-muted)] font-data">Thinking...</span>
                </div>
              )}

              {/* Streaming tool events */}
              {toolEvents.length > 0 && (
                <div className="border-l-2 border-[var(--color-border)] pl-3 ml-4 mt-3 space-y-1">
                  {toolEvents.map((te, i) => (
                    <div key={i} className="flex items-center gap-1.5 transition-opacity duration-150" style={{ opacity: 1 }}>
                      {te.type === 'call' ? (
                        <Loader2 size={12} className="animate-spin text-amber-500 shrink-0" />
                      ) : (
                        <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                      )}
                      <span className={`text-xs font-data ${te.type === 'call' ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {describeToolEvent(te.toolName, te.args)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} className="h-2" />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-chrome)] px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); autoResize(); }}
            onKeyDown={handleKeyDown}
            placeholder="Ask the agent..."
            rows={1}
            className="flex-1 text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-xl px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] resize-none transition-all"
            style={{ minHeight: '36px', maxHeight: '96px' }}
          />

          {/* Clear button */}
          {messages.length > 0 && !streaming && (
            <button
              onClick={handleClear}
              className="p-2 text-[var(--color-text-muted)] hover:text-red-500 rounded-lg hover:bg-[var(--color-accent-subtle)] transition-colors"
              title="Clear conversation"
            >
              <Trash2 size={16} />
            </button>
          )}

          {/* Send / Stop button */}
          {streaming ? (
            <button
              onClick={() => abort(projectId)}
              className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors"
              title="Stop generating"
            >
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className={`p-2 rounded-xl transition-colors ${
                input.trim()
                  ? 'btn-primary'
                  : 'bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] text-[var(--color-text-muted)] cursor-not-allowed'
              }`}
              title="Send message"
            >
              <SendHorizonal size={16} />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mt-1">
          <p className="text-[0.625rem] text-[var(--color-text-muted)] font-data">Enter to send &middot; Shift+Enter for new line</p>
          {modelInfo && (
            <p className="text-[0.625rem] text-[var(--color-text-muted)] font-data">
              <span className="font-medium">{modelInfo.model}</span>
              <span className="text-[var(--color-text-muted)]"> · </span>
              <span className="capitalize">{modelInfo.providerName}</span>
            </p>
          )}
        </div>
      </div>
    </div>
    <ConfirmDialog
      open={clearConfirmOpen}
      title="Delete Conversation"
      message="Delete this conversation? This cannot be undone."
      confirmLabel="Delete"
      variant="danger"
      onConfirm={confirmClear}
      onCancel={() => setClearConfirmOpen(false)}
    />
    </>
  );
}

// --- Message Bubble sub-component ---

function MessageBubble({ message }: { message: ProjectAgentMessage }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (message.content) {
      navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [message.content]);

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-[var(--color-accent-muted)] border border-[var(--color-accent-dim)]/30 text-[var(--color-text-primary)] rounded-2xl rounded-tr-sm px-4 py-3">
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex justify-start group/msg">
      <div className="max-w-[90%] bg-[var(--color-chrome)] border border-[var(--color-border)] rounded-2xl rounded-tl-sm p-5 relative">
        {/* Copy button — visible on hover */}
        {message.content && (
          <button
            onClick={handleCopy}
            className="absolute top-3 right-3 p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-accent)] opacity-0 group-hover/msg:opacity-100 transition-opacity hover:bg-[var(--color-accent-subtle)]"
            title="Copy to clipboard"
          >
            {copied ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
          </button>
        )}

        {message.content && (
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-[var(--color-text-primary)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents as never}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Persisted action badges from toolCalls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--color-border)] space-y-1.5">
            {message.toolCalls.map((call, i) => {
              const hasResult = message.toolResults?.find(r => r.toolCallId === call.id);
              const failed = hasResult && (hasResult.result as Record<string, unknown>)?.success === false;
              return (
                <div key={call.id || i} className="flex items-center gap-1.5">
                  {failed ? (
                    <XCircle size={12} className="text-red-500 shrink-0" />
                  ) : (
                    <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                  )}
                  <span className="text-xs font-data text-[var(--color-text-secondary)]">
                    {describeToolCall(call)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
