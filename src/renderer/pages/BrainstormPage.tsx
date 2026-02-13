// === FILE PURPOSE ===
// Brainstorm page — session sidebar + AI chat interface with streaming.
// Split-panel layout: session list on the left, chat area on the right.
//
// === DEPENDENCIES ===
// brainstormStore, projectStore, ChatMessage, lucide-react
//
// === LIMITATIONS ===
// - No message editing/deletion
// - Session rename via double-click (may not be immediately discoverable)

import { useState, useEffect, useRef } from 'react';
import {
  Brain, Plus, Send, Loader2, Trash2, Archive,
  MessageSquare, Bot,
} from 'lucide-react';
import { useBrainstormStore } from '../stores/brainstormStore';
import { useProjectStore } from '../stores/projectStore';
import ChatMessage from '../components/ChatMessage';

function formatRelativeTime(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function BrainstormPage() {
  const {
    sessions, activeSession, loadingSessions, loadingSession,
    streaming, streamingText, error,
    loadSessions, loadSession, createSession, updateSession,
    deleteSession, sendMessage, clearActiveSession, exportToIdea,
  } = useBrainstormStore();
  const { projects, loadProjects } = useProjectStore();
  const [input, setInput] = useState('');
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [showNewSession, setShowNewSession] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Derived state: filter sessions by archive status
  const filteredSessions = showArchived ? sessions : sessions.filter(s => s.status === 'active');

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
    loadProjects();
  }, []);

  // Auto-scroll to bottom when new messages or streaming text changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages, streamingText]);

  const handleCreateSession = async () => {
    if (!newSessionTitle.trim()) return;
    const session = await createSession({
      title: newSessionTitle.trim(),
      projectId: selectedProjectId || undefined,
    });
    setNewSessionTitle('');
    setSelectedProjectId('');
    setShowNewSession(false);
    loadSession(session.id);
  };

  const handleSendMessage = async () => {
    if (!input.trim() || streaming) return;
    const content = input.trim();
    setInput('');
    await sendMessage(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleExportToIdea = async (messageId: string) => {
    try {
      await exportToIdea(messageId);
    } catch (err) {
      console.error('Failed to export to idea:', err);
    }
  };

  const handleDeleteSession = async (id: string) => {
    await deleteSession(id);
    setConfirmDeleteId(null);
  };

  return (
    <div className="p-6 space-y-4">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Brainstorm</h1>
        <p className="text-sm text-surface-400 mt-1">AI-powered ideation sessions</p>
      </div>

      {/* Main container */}
      <div className="flex h-[calc(100vh-13rem)] gap-0 border border-surface-700 rounded-xl overflow-hidden">
        {/* Left sidebar -- Sessions */}
        <div className="w-64 flex-shrink-0 border-r border-surface-700 bg-surface-900 flex flex-col">
          {/* Sidebar header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-surface-700">
            <span className="text-sm font-medium text-surface-300">Sessions</span>
            <button
              onClick={() => setShowNewSession(!showNewSession)}
              className="p-1 rounded-md hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
            >
              <Plus size={16} />
            </button>
          </div>

          {/* Show archived toggle */}
          {sessions.some(s => s.status === 'archived') && (
            <div className="px-3 py-1.5 border-b border-surface-700">
              <label className="flex items-center gap-2 text-xs text-surface-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="rounded border-surface-600"
                />
                Show archived
              </label>
            </div>
          )}

          {/* New session form */}
          {showNewSession && (
            <div className="p-3 border-b border-surface-700 space-y-2">
              <input
                type="text"
                value={newSessionTitle}
                onChange={(e) => setNewSessionTitle(e.target.value)}
                placeholder="Session title..."
                className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-1.5 text-sm text-surface-200 placeholder-surface-500 focus:outline-none focus:border-primary-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateSession();
                  if (e.key === 'Escape') setShowNewSession(false);
                }}
              />
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateSession}
                  disabled={!newSessionTitle.trim()}
                  className="flex-1 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs py-1.5 rounded-lg transition-colors"
                >
                  Create
                </button>
                <button
                  onClick={() => setShowNewSession(false)}
                  className="flex-1 bg-surface-700 hover:bg-surface-600 text-surface-300 text-xs py-1.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Session list */}
          <div className="flex-1 overflow-y-auto">
            {loadingSessions ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-surface-500" />
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-8 px-3">
                <MessageSquare size={24} className="mx-auto text-surface-600 mb-2" />
                <p className="text-xs text-surface-500">No sessions</p>
                <p className="text-xs text-surface-600 mt-1">Create one to start brainstorming</p>
              </div>
            ) : (
              filteredSessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => loadSession(session.id)}
                  className={`group flex items-center justify-between px-3 py-2.5 cursor-pointer border-l-2 transition-colors ${
                    activeSession?.id === session.id
                      ? 'bg-surface-700/50 border-primary-500'
                      : 'border-transparent hover:bg-surface-800/50'
                  } ${session.status === 'archived' ? 'opacity-50' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    {renamingId === session.id ? (
                      <input
                        type="text"
                        value={renameTitle}
                        onChange={(e) => setRenameTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (renameTitle.trim()) updateSession(session.id, { title: renameTitle.trim() });
                            setRenamingId(null);
                          }
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        onBlur={() => {
                          if (renameTitle.trim()) updateSession(session.id, { title: renameTitle.trim() });
                          setRenamingId(null);
                        }}
                        className="w-full bg-surface-800 border border-primary-500 rounded px-1 py-0.5 text-sm text-surface-200 focus:outline-none"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <p
                        className="text-sm text-surface-200 truncate"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(session.id);
                          setRenameTitle(session.title);
                        }}
                      >
                        {session.title}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-surface-500">
                        {formatRelativeTime(session.updatedAt)}
                      </span>
                      {session.projectId && (
                        <span className="text-xs bg-surface-700 px-1.5 py-0.5 rounded text-surface-400 truncate max-w-[80px]">
                          {projects.find(p => p.id === session.projectId)?.name ?? 'Project'}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Action buttons */}
                  <div className="flex-shrink-0 ml-1 flex items-center gap-0.5">
                    {confirmDeleteId === session.id ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSession(session.id);
                        }}
                        className="text-xs text-red-400 hover:text-red-300 px-1"
                      >
                        Delete?
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateSession(session.id, { status: session.status === 'archived' ? 'active' : 'archived' });
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-600 text-surface-500 hover:text-amber-400 transition-all"
                          title={session.status === 'archived' ? 'Unarchive' : 'Archive'}
                        >
                          <Archive size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(session.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-600 text-surface-500 hover:text-red-400 transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right panel -- Chat */}
        <div className="flex-1 flex flex-col bg-surface-900/50">
          {!activeSession && !loadingSession ? (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center text-surface-500">
              <Brain size={48} className="mb-3 text-surface-600" />
              <p className="text-lg font-medium text-surface-400">Select or create a session</p>
              <p className="text-sm text-surface-500 mt-1">Start brainstorming with AI</p>
            </div>
          ) : loadingSession ? (
            /* Loading state */
            <div className="flex-1 flex items-center justify-center">
              <Loader2 size={28} className="animate-spin text-amber-400" />
            </div>
          ) : activeSession ? (
            <>
              {/* Header bar */}
              <div className="px-4 py-3 border-b border-surface-700">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-medium text-surface-100">
                    {activeSession.title}
                  </h2>
                  {activeSession.projectId && (
                    <span className="bg-surface-700 text-xs px-2 py-0.5 rounded-full text-surface-300">
                      {projects.find(p => p.id === activeSession.projectId)?.name ?? 'Project'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-surface-500 mt-0.5">
                  <span>Context:</span>
                  {activeSession.projectId ? (
                    <span className="bg-surface-700 px-2 py-0.5 rounded-full text-surface-300">
                      {projects.find(p => p.id === activeSession.projectId)?.name ?? 'Project'}
                    </span>
                  ) : (
                    <span className="text-surface-600">General (no project linked)</span>
                  )}
                </div>
              </div>

              {/* Messages area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {activeSession.messages.length === 0 && !streaming && (
                  <div className="text-center py-12 text-surface-500">
                    <MessageSquare size={32} className="mx-auto mb-2 text-surface-600" />
                    <p className="text-sm">Start the conversation</p>
                    <p className="text-xs text-surface-600 mt-1">
                      Type a message below to brainstorm with AI
                    </p>
                  </div>
                )}

                {activeSession.messages.map((msg) => (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    onExportToIdea={msg.role === 'assistant' ? handleExportToIdea : undefined}
                  />
                ))}

                {/* Streaming message */}
                {streaming && streamingText && (
                  <div className="mr-auto max-w-[80%]">
                    <div className="bg-surface-800 border border-surface-700 rounded-2xl rounded-bl-sm p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Bot size={14} className="text-primary-400" />
                        <span className="text-xs text-surface-500">AI</span>
                      </div>
                      <div className="whitespace-pre-wrap text-sm text-surface-200">
                        {streamingText}
                        <span className="animate-pulse text-primary-400">|</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Thinking indicator */}
                {streaming && !streamingText && (
                  <div className="mr-auto max-w-[80%]">
                    <div className="bg-surface-800 border border-surface-700 rounded-2xl rounded-bl-sm p-3">
                      <div className="flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin text-primary-400" />
                        <span className="text-xs text-surface-400">AI is thinking...</span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div className="border-t border-surface-700 p-3">
                {error && (
                  <div className="text-red-400 text-sm mb-2 px-1">{error}</div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your message... (Shift+Enter for new line)"
                    rows={1}
                    className="flex-1 bg-surface-800 border border-surface-700 rounded-xl px-4 py-2.5 text-sm text-surface-200 placeholder-surface-500 resize-none focus:outline-none focus:border-primary-500 max-h-32"
                    style={{ minHeight: '42px' }}
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!input.trim() || streaming}
                    className="bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white p-2.5 rounded-xl transition-colors flex-shrink-0"
                  >
                    {streaming ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <Send size={18} />
                    )}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
