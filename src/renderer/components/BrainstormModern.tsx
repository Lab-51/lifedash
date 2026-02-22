// === FILE PURPOSE ===
// Brainstorm page — Modern Design
// Session sidebar + AI chat interface with streaming in a split-panel layout.
// Features a cleaner, card-based UI with improved typography and spacing.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Brain, Plus, Send, Loader2, Trash2, Archive,
    MessageSquare, Bot, Sparkles, Lightbulb, Search, Layers, ListChecks, Square, X, Edit2, MoreVertical
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useBrainstormStore } from '../stores/brainstormStore';
import { useProjectStore } from '../stores/projectStore';
import ChatMessageModern from '../components/ChatMessageModern';
import { BRAINSTORM_TEMPLATES } from '../../shared/types/brainstorm';

function formatRelativeTime(isoDate: string): string {
    const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

export default function BrainstormModern() {
    const sessions = useBrainstormStore(s => s.sessions);
    const activeSession = useBrainstormStore(s => s.activeSession);
    const loadingSessions = useBrainstormStore(s => s.loadingSessions);
    const loadingSession = useBrainstormStore(s => s.loadingSession);
    const streaming = useBrainstormStore(s => s.streaming);
    const streamingText = useBrainstormStore(s => s.streamingText);
    const error = useBrainstormStore(s => s.error);
    const loadSessions = useBrainstormStore(s => s.loadSessions);
    const loadSession = useBrainstormStore(s => s.loadSession);
    const createSession = useBrainstormStore(s => s.createSession);
    const updateSession = useBrainstormStore(s => s.updateSession);
    const deleteSession = useBrainstormStore(s => s.deleteSession);
    const sendMessage = useBrainstormStore(s => s.sendMessage);
    const abortStream = useBrainstormStore(s => s.abortStream);
    const exportToIdea = useBrainstormStore(s => s.exportToIdea);
    const exportToCard = useBrainstormStore(s => s.exportToCard);
    const projects = useProjectStore(s => s.projects);
    const loadProjects = useProjectStore(s => s.loadProjects);
    const [input, setInput] = useState('');
    const [newSessionTitle, setNewSessionTitle] = useState('');
    const [showNewSession, setShowNewSession] = useState(false);
    const [selectedProjectId, setSelectedProjectId] = useState<string>('');
    const [selectedTemplateId, setSelectedTemplateId] = useState('freeform');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameTitle, setRenameTitle] = useState('');
    const [sidebarTab, setSidebarTab] = useState<'active' | 'archived'>('active');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const userScrolledUpRef = useRef(false);
    const [searchParams, setSearchParams] = useSearchParams();

    // Handle ?action=create — auto-open the new session form
    useEffect(() => {
        if (searchParams.get('action') === 'create') {
            setShowNewSession(true);
            searchParams.delete('action');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    // Derived state: filter sessions by tab
    const filteredSessions = sessions.filter(s => s.status === sidebarTab);

    // Load sessions on mount
    useEffect(() => {
        loadSessions();
        loadProjects();
    }, []);

    // Track whether user has scrolled up from the bottom
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;
        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            // Consider "at bottom" if within 120px of the bottom (larger buffer for modern UI)
            userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 120;
        };
        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [activeSession?.id]);

    // Auto-scroll to bottom only when user hasn't scrolled up
    useEffect(() => {
        if (!userScrolledUpRef.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [activeSession?.messages, streamingText]);

    // Always scroll to bottom when a new user message is sent (reset scroll lock)
    const prevMessageCountRef = useRef(0);
    useEffect(() => {
        const count = activeSession?.messages.length ?? 0;
        if (count > prevMessageCountRef.current) {
            userScrolledUpRef.current = false;
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
        prevMessageCountRef.current = count;
    }, [activeSession?.messages.length]);

    // Auto-select most recent active session on mount
    useEffect(() => {
        if (sessions.length > 0 && !activeSession && !loadingSession) {
            const lastId = localStorage.getItem('lastBrainstormSessionId');
            const lastSession = lastId ? sessions.find(s => s.id === lastId) : null;
            if (lastSession && lastSession.status === 'active') {
                loadSession(lastSession.id);
            } else {
                // Fall back to most recent active session
                const mostRecent = sessions.find(s => s.status === 'active');
                if (mostRecent) loadSession(mostRecent.id);
            }
        }
    }, [sessions, activeSession, loadingSession, loadSession]);

    // Textarea auto-resize helper
    const autoResize = useCallback(() => {
        const el = textareaRef.current;
        if (el) {
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 200) + 'px'; // max height increased
        }
    }, []);

    // Ctrl+N shortcut to open new session form
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                setShowNewSession(true);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleCreateSession = async () => {
        if (!newSessionTitle.trim()) return;
        const session = await createSession({
            title: newSessionTitle.trim(),
            projectId: selectedProjectId || undefined,
        });
        const template = BRAINSTORM_TEMPLATES.find(t => t.id === selectedTemplateId);
        if (template?.starterPrompt) {
            setInput(template.starterPrompt);
        }
        setNewSessionTitle('');
        setSelectedProjectId('');
        setSelectedTemplateId('freeform');
        setShowNewSession(false);
        loadSession(session.id);
        localStorage.setItem('lastBrainstormSessionId', session.id);
    };

    const handleSendMessage = async (overrideContent?: string) => {
        const content = overrideContent ?? input.trim();
        if (!content || streaming) return;
        if (!overrideContent) {
            setInput('');
            // Reset textarea height after sending
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
            }
        }
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

    const handleExportToCard = async (messageId: string) => {
        try {
            await exportToCard(messageId);
        } catch (err) {
            console.error('Failed to export to card:', err);
        }
    };

    const handleDeleteSession = async (id: string) => {
        await deleteSession(id);
        setConfirmDeleteId(null);
    };

    const templateIcons: Record<string, React.ReactNode> = {
        Sparkles: <Sparkles size={16} className="text-amber-500" />,
        Lightbulb: <Lightbulb size={16} className="text-yellow-500" />,
        Search: <Search size={16} className="text-blue-500" />,
        Layers: <Layers size={16} className="text-purple-500" />,
        ListChecks: <ListChecks size={16} className="text-emerald-500" />,
    };

    return (
        <div className="h-full flex flex-col bg-surface-50 dark:bg-surface-950">
            {/* Modern Header */}
            <div className="px-6 py-5 shrink-0 border-b border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 sticky top-0 z-20">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                            <Brain size={24} className="text-primary-600 dark:text-primary-400" />
                            Brainstorm
                        </h1>
                        <p className="text-sm text-surface-500 mt-0.5">Collaborate with AI to refine your ideas.</p>
                    </div>

                    <button
                        onClick={() => setShowNewSession(true)}
                        className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-sm transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
                    >
                        <Plus size={16} />
                        New Session
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Left Sidebar - Modern */}
                <div className="w-80 flex-shrink-0 border-r border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 flex flex-col z-10">
                    <div className="px-2 pt-3 pb-1 border-b border-surface-100 dark:border-surface-800">
                        <div className="flex rounded-lg bg-surface-100 dark:bg-surface-800 p-0.5">
                            <button
                                onClick={() => setSidebarTab('active')}
                                className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition-all ${sidebarTab === 'active'
                                    ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                                    : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
                                    }`}
                            >
                                Active
                            </button>
                            <button
                                onClick={() => setSidebarTab('archived')}
                                className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition-all ${sidebarTab === 'archived'
                                    ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                                    : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
                                    }`}
                            >
                                Archived
                            </button>
                        </div>
                    </div>

                    {/* Session List */}
                    <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
                        {loadingSessions ? (
                            <div className="flex justify-center p-8">
                                <Loader2 size={24} className="animate-spin text-surface-300" />
                            </div>
                        ) : filteredSessions.length === 0 ? (
                            <div className="text-center py-10 px-4">
                                <div className="w-12 h-12 bg-surface-100 dark:bg-surface-800 rounded-full flex items-center justify-center mx-auto mb-3">
                                    {sidebarTab === 'archived'
                                        ? <Archive size={20} className="text-surface-400" />
                                        : <MessageSquare size={20} className="text-surface-400" />
                                    }
                                </div>
                                <p className="text-sm font-medium text-surface-900 dark:text-surface-100">
                                    {sidebarTab === 'archived' ? 'No archived sessions' : 'No sessions yet'}
                                </p>
                                <p className="text-xs text-surface-500 mt-1">
                                    {sidebarTab === 'archived' ? 'Archived sessions will appear here.' : 'Start a new chat to begin.'}
                                </p>
                            </div>
                        ) : (
                            filteredSessions.map((session) => (
                                <div
                                    key={session.id}
                                    onClick={() => {
                                        loadSession(session.id);
                                        localStorage.setItem('lastBrainstormSessionId', session.id);
                                    }}
                                    className={`group relative rounded-xl p-3 cursor-pointer transition-all border ${activeSession?.id === session.id
                                        ? 'bg-primary-50 dark:bg-primary-900/10 border-primary-200 dark:border-primary-800 shadow-sm'
                                        : 'bg-transparent border-transparent hover:bg-surface-50 dark:hover:bg-surface-800'
                                        }`}
                                >
                                    <div className="flex justify-between items-start gap-2">
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
                                                    className="w-full bg-white dark:bg-surface-900 border border-primary-500 rounded px-1.5 py-0.5 text-sm focus:outline-none"
                                                    autoFocus
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            ) : (
                                                <h4 className={`text-sm font-medium truncate mb-1 ${activeSession?.id === session.id
                                                    ? 'text-primary-900 dark:text-primary-100'
                                                    : 'text-surface-700 dark:text-surface-300'
                                                    }`}>
                                                    {session.title}
                                                </h4>
                                            )}

                                            <div className="flex items-center gap-2 text-[10px] text-surface-400">
                                                <span>{formatRelativeTime(session.updatedAt)}</span>
                                                {session.projectId && (
                                                    <span className="bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 rounded text-surface-500 dark:text-surface-400 capitalize truncate max-w-[80px]">
                                                        {projects.find(p => p.id === session.projectId)?.name ?? 'Linked'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Hover Actions */}
                                        <div className="hidden group-hover:flex items-center gap-1 absolute right-2 top-2 bg-white/80 dark:bg-surface-900/80 backdrop-blur-sm rounded-lg p-0.5 shadow-sm border border-surface-100 dark:border-surface-700">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setRenamingId(session.id);
                                                    setRenameTitle(session.title);
                                                }}
                                                className="p-1 text-surface-400 hover:text-primary-500 rounded hover:bg-surface-100 dark:hover:bg-surface-800"
                                                title="Rename"
                                            >
                                                <Edit2 size={12} />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    updateSession(session.id, { status: session.status === 'archived' ? 'active' : 'archived' });
                                                }}
                                                className="p-1 text-surface-400 hover:text-amber-500 rounded hover:bg-surface-100 dark:hover:bg-surface-800"
                                                title={session.status === 'archived' ? 'Restore' : 'Archive'}
                                            >
                                                <Archive size={12} />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (window.confirm('Delete this session?')) handleDeleteSession(session.id);
                                                }}
                                                className="p-1 text-surface-400 hover:text-red-500 rounded hover:bg-surface-100 dark:hover:bg-surface-800"
                                                title="Delete"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* New Session Modal - Moved OUT of sidebar */}
                {showNewSession && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-white dark:bg-surface-900 rounded-2xl shadow-2xl border border-surface-200 dark:border-surface-700 w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="font-bold text-xl text-surface-900 dark:text-surface-100">New Session</h3>
                                <button
                                    onClick={() => setShowNewSession(false)}
                                    className="p-1 rounded-full hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 hover:text-surface-900 transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="space-y-5">
                                <div>
                                    <label className="block text-xs font-bold text-surface-500 mb-2 uppercase tracking-wide">Title</label>
                                    <input
                                        type="text"
                                        value={newSessionTitle}
                                        onChange={(e) => setNewSessionTitle(e.target.value)}
                                        placeholder="e.g., Marketing Strategy Q1"
                                        className="w-full bg-surface-50 dark:bg-surface-950 border border-surface-200 dark:border-surface-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition-all"
                                        autoFocus
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleCreateSession();
                                            if (e.key === 'Escape') setShowNewSession(false);
                                        }}
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-surface-500 mb-2 uppercase tracking-wide">Project (Optional)</label>
                                    <select
                                        value={selectedProjectId}
                                        onChange={(e) => setSelectedProjectId(e.target.value)}
                                        className="w-full bg-surface-50 dark:bg-surface-950 border border-surface-200 dark:border-surface-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 appearance-none transition-all"
                                    >
                                        <option value="">No linked project</option>
                                        {projects.map((p) => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-surface-500 mb-2 uppercase tracking-wide">Template</label>
                                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-surface-300 dark:scrollbar-thumb-surface-700">
                                        {BRAINSTORM_TEMPLATES.map((template) => (
                                            <button
                                                key={template.id}
                                                type="button"
                                                onClick={() => setSelectedTemplateId(template.id)}
                                                className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${selectedTemplateId === template.id
                                                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 ring-1 ring-primary-500'
                                                    : 'border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800'
                                                    }`}
                                            >
                                                <div className="mt-0.5">{templateIcons[template.icon]}</div>
                                                <div>
                                                    <p className={`text-sm font-semibold ${selectedTemplateId === template.id ? 'text-primary-700 dark:text-primary-300' : 'text-surface-900 dark:text-surface-100'}`}>
                                                        {template.name}
                                                    </p>
                                                    <p className="text-xs text-surface-500 leading-snug mt-0.5">{template.description}</p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="pt-2">
                                    <button
                                        onClick={handleCreateSession}
                                        disabled={!newSessionTitle.trim()}
                                        className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary-500/20 hover:shadow-primary-500/40 transition-all hover:-translate-y-0.5"
                                    >
                                        Start Session
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                {/* This div was extraneous and caused the syntax error. It's removed. */}

                {/* Right Chat Area */}
                <div className="flex-1 flex flex-col relative bg-surface-50/50 dark:bg-surface-950">
                    {!activeSession && !loadingSession ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                            <div className="w-32 h-32 bg-white dark:bg-surface-900 rounded-full shadow-sm border border-surface-100 dark:border-surface-800 flex items-center justify-center mb-6">
                                <Sparkles size={48} className="text-primary-300" />
                            </div>
                            <h2 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-2">Welcome to Brainstorm</h2>
                            <p className="text-surface-500 max-w-md mx-auto mb-8">
                                Select a session from the sidebar or start a new one to collaborate with AI on your projects.
                            </p>
                            <button
                                onClick={() => setShowNewSession(true)}
                                className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-3 rounded-xl font-medium shadow-md transition-all hover:-translate-y-0.5"
                            >
                                Start New Session
                            </button>
                        </div>
                    ) : loadingSession ? (
                        <div className="flex-1 flex items-center justify-center">
                            <Loader2 size={40} className="animate-spin text-primary-200" />
                        </div>
                    ) : activeSession ? (
                        <>
                            {/* Chat Header */}
                            <div className="px-6 py-4 border-b border-surface-200 dark:border-surface-800 bg-white/50 dark:bg-surface-900/50 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
                                <div>
                                    <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 leading-none">
                                        {activeSession.title}
                                    </h2>
                                    {activeSession.projectId && (
                                        <div className="flex items-center gap-1.5 mt-1.5">
                                            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                                                <Layers size={10} />
                                                Context:
                                            </span>
                                            <span className="text-xs bg-surface-100 dark:bg-surface-800 px-2 py-0.5 rounded-md text-surface-700 dark:text-surface-300 font-medium">
                                                {projects.find(p => p.id === activeSession.projectId)?.name ?? 'Unknown Project'}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="px-2 py-1 rounded-md bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-xs font-medium border border-green-100 dark:border-green-900/50 flex items-center gap-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                        AI Ready
                                    </span>
                                </div>
                            </div>

                            {/* Messages */}
                            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-6 py-6 scroll-smooth">
                                {activeSession.messages.length === 0 && !streaming && (
                                    <div className="max-w-2xl mx-auto mt-10">
                                        <div className="text-center mb-8">
                                            <h3 className="text-xl font-bold text-surface-900 dark:text-surface-100 mb-2">How can I help you today?</h3>
                                            <p className="text-surface-500">Choose a starter prompt or type your own below.</p>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {[
                                                'Brainstorm features for my app',
                                                'Analyze these requirements',
                                                'Create a launch checklist',
                                                'Suggest technical architecture',
                                            ].map((prompt, i) => (
                                                <button
                                                    key={i}
                                                    onClick={() => handleSendMessage(prompt)}
                                                    className="text-left p-4 rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 hover:border-primary-400 dark:hover:border-primary-600 hover:shadow-md transition-all group"
                                                >
                                                    <p className="text-sm font-medium text-surface-700 dark:text-surface-200 group-hover:text-primary-600 dark:group-hover:text-primary-400">{prompt}</p>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="max-w-3xl mx-auto space-y-6">
                                    {activeSession.messages.map((msg) => (
                                        <ChatMessageModern
                                            key={msg.id}
                                            message={msg}
                                            onExportToIdea={msg.role === 'assistant' ? handleExportToIdea : undefined}
                                            onExportToCard={msg.role === 'assistant' && activeSession?.projectId ? handleExportToCard : undefined}
                                        />
                                    ))}

                                    {/* Streaming Content */}
                                    {streaming && streamingText && (
                                        <div className="flex justify-start mb-6 group animate-in fade-in duration-300">
                                            <div className="max-w-[90%] w-full">
                                                <div className="flex items-center gap-2 mb-1 px-1">
                                                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
                                                        <Bot size={12} className="text-white" />
                                                    </div>
                                                    <span className="text-[10px] font-medium text-surface-500 uppercase tracking-wider">AI Assistant</span>
                                                    <span className="text-[10px] text-surface-400">Typing...</span>
                                                </div>
                                                <div className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl rounded-tl-sm p-5 shadow-sm">
                                                    <div className="prose prose-sm dark:prose-invert max-w-none text-surface-800 dark:text-surface-200">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                            {streamingText}
                                                        </ReactMarkdown>
                                                        <span className="inline-block w-2 h-4 bg-primary-500 ml-1 animate-pulse" />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Thinking State */}
                                    {streaming && !streamingText && (
                                        <div className="flex justify-start mb-6">
                                            <div className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl rounded-tl-sm p-4 shadow-sm flex items-center gap-3">
                                                <Loader2 size={16} className="animate-spin text-primary-500" />
                                                <span className="text-sm text-surface-500">Thinking...</span>
                                            </div>
                                        </div>
                                    )}

                                    <div ref={messagesEndRef} className="h-4" />
                                </div>
                            </div>

                            {/* Input Area */}
                            <div className="p-4 bg-white dark:bg-surface-900 border-t border-surface-200 dark:border-surface-800">
                                <div className="max-w-3xl mx-auto relative">
                                    {streaming ? (
                                        <div className="absolute -top-12 left-1/2 -translate-x-1/2">
                                            <button
                                                onClick={() => abortStream()}
                                                className="bg-surface-900 dark:bg-surface-100 text-white dark:text-surface-900 text-xs font-medium px-4 py-2 rounded-full shadow-lg flex items-center gap-2 hover:scale-105 transition-transform"
                                            >
                                                <Square size={10} fill="currentColor" />
                                                Stop Generating
                                            </button>
                                        </div>
                                    ) : null}

                                    {error && (
                                        <div className="mb-2 p-2 bg-red-50 text-red-600 text-xs rounded-lg border border-red-100 flex items-center gap-2">
                                            <X size={12} /> {error}
                                        </div>
                                    )}

                                    <div className="relative bg-surface-50 dark:bg-surface-800 border-2 border-surface-200 dark:border-surface-700 rounded-2xl focus-within:border-primary-500 focus-within:bg-white dark:focus-within:bg-surface-900 transition-all shadow-sm">
                                        <textarea
                                            ref={textareaRef}
                                            value={input}
                                            onChange={(e) => {
                                                setInput(e.target.value);
                                                autoResize();
                                            }}
                                            onKeyDown={handleKeyDown}
                                            placeholder="Message AI..."
                                            rows={1}
                                            className="w-full bg-transparent px-4 py-3 pr-12 text-sm text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-0 border-transparent focus:border-transparent resize-none max-h-48"
                                            style={{ minHeight: '48px' }}
                                        />
                                        <button
                                            onClick={() => handleSendMessage()}
                                            disabled={!input.trim() || streaming}
                                            className={`absolute right-2 bottom-2 p-2 rounded-xl transition-all ${!input.trim() || streaming
                                                ? 'bg-surface-200 dark:bg-surface-700 text-surface-400 cursor-not-allowed'
                                                : 'bg-primary-600 text-white hover:bg-primary-700 shadow-md'
                                                }`}
                                        >
                                            {streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-surface-400 text-center mt-2">
                                        AI can make mistakes. Review generated content.
                                    </p>
                                </div>
                            </div>
                        </>
                    ) : null}
                </div>
            </div>
        </div >
    );
}
