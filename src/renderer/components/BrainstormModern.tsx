// === FILE PURPOSE ===
// Brainstorm page — Modern Design
// Session sidebar + AI chat interface with streaming in a split-panel layout.
// Features a cleaner, card-based UI with improved typography and spacing.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Brain, Plus, Send, Loader2, Trash2, Archive, Mic, MicOff,
    MessageSquare, Bot, Sparkles, Lightbulb, Search, Layers, ListChecks, Square, X, Edit2, MoreVertical,
} from 'lucide-react';
import EmptyFeatureState from './EmptyFeatureState';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useBrainstormStore } from '../stores/brainstormStore';
import { useProjectStore } from '../stores/projectStore';
import { useSettingsStore } from '../stores/settingsStore';
import ChatMessageModern, { markdownComponents } from '../components/ChatMessageModern';
import BrainstormQuickChips, { parseChoices } from '../components/BrainstormQuickChips';
import HudSelect from '../components/HudSelect';
import EmptyAIState from '../components/EmptyAIState';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { BRAINSTORM_TEMPLATES } from '../../shared/types/brainstorm';
import { ConfirmDialog } from '../components/ConfirmDialog';

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
    const hasAnyEnabledProvider = useSettingsStore(s => s.hasAnyEnabledProvider);
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
    const [chipsHidden, setChipsHidden] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();

    // Voice-to-text for chat input
    const voice = useVoiceInput({
        onTranscript: (text) => {
            setInput(prev => {
                const base = prev.endsWith(' ') || prev === '' ? prev : prev + ' ';
                return base + text;
            });
        },
    });

    // Handle ?action=create — auto-open the new session form
    useEffect(() => {
        if (searchParams.get('action') === 'create') {
            setShowNewSession(true);
            searchParams.delete('action');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    // Handle ?openSession=<id> — load a specific session and consume any draft input
    useEffect(() => {
        const openSessionId = searchParams.get('openSession');
        if (openSessionId) {
            searchParams.delete('openSession');
            setSearchParams(searchParams, { replace: true });
            loadSession(openSessionId);
            localStorage.setItem('lastBrainstormSessionId', openSessionId);
            // Consume draft input after a tick so the session is loading
            setTimeout(() => {
                const draft = useBrainstormStore.getState().consumeDraftInput();
                if (draft) {
                    setInput(draft);
                    // Resize the textarea after setting input
                    requestAnimationFrame(() => {
                        const el = textareaRef.current;
                        if (el) {
                            el.style.height = 'auto';
                            el.style.height = Math.min(el.scrollHeight, 200) + 'px';
                            el.focus();
                        }
                    });
                }
            }, 0);
        }
    }, [searchParams, setSearchParams, loadSession]);

    // Derived state: filter sessions by tab
    const filteredSessions = sessions.filter(s => s.status === sidebarTab);

    // Load sessions on mount
    useEffect(() => {
        loadSessions();
        loadProjects();
    }, [loadSessions, loadProjects]);

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

    // Reset chipsHidden when a new message arrives (new choices may appear)
    useEffect(() => {
        setChipsHidden(false);
    }, [activeSession?.messages.length]);

    // Parse quick-reply chips from the last assistant message
    const parsedChips = (() => {
        if (streaming || chipsHidden || !activeSession?.messages.length) return null;
        const msgs = activeSession.messages;
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg?.role !== 'assistant') return null;
        return parseChoices(lastMsg.content);
    })();

    const handleSendMessage = async (overrideContent?: string) => {
        const content = overrideContent ?? input.trim();
        if (!content || streaming) return;
        // Stop voice input if active
        voice.stop();
        setChipsHidden(true);
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
        <>
        <div className="h-full flex flex-col bg-surface-50 dark:bg-surface-950">
            {/* HUD Header */}
            <div className="px-6 py-5 shrink-0 border-b border-[var(--color-border)] hud-chrome-bg sticky top-0 z-20">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-4 mb-1">
                            <span className="font-data text-[11px] tracking-[0.3em] text-[var(--color-accent)] text-glow">SYS.BRAINSTORM</span>
                            <div className="h-px w-16 bg-gradient-to-l from-transparent to-[var(--color-accent)] opacity-40" />
                        </div>
                        <h1 className="font-hud text-xl text-[var(--color-accent)] text-glow flex items-center gap-2">
                            <Brain size={24} />
                            Brainstorm
                        </h1>
                        <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">Collaborate with AI to refine your ideas.</p>
                    </div>

                    <button
                        onClick={() => setShowNewSession(true)}
                        className="btn-primary clip-corner-cut-sm px-4 py-2 text-sm font-medium flex items-center gap-2"
                    >
                        <Plus size={16} />
                        New Session
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Left Sidebar - Modern */}
                <div className="w-80 flex-shrink-0 border-r border-[var(--color-border)] hud-chrome-bg flex flex-col z-10">
                    <div className="px-2 pt-3 pb-1 border-b border-[var(--color-border)]">
                        <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
                            <button
                                onClick={() => setSidebarTab('active')}
                                className={`flex-1 text-xs font-semibold py-1.5 transition-all ${sidebarTab === 'active'
                                    ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                                    : 'bg-[var(--color-chrome)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]'
                                    }`}
                            >
                                Active
                            </button>
                            <button
                                onClick={() => setSidebarTab('archived')}
                                className={`flex-1 text-xs font-semibold py-1.5 transition-all ${sidebarTab === 'archived'
                                    ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                                    : 'bg-[var(--color-chrome)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]'
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
                                        ? 'bg-[var(--color-accent-subtle)] border-[var(--color-border-accent)] shadow-sm'
                                        : 'bg-transparent border-transparent hover:bg-[var(--color-accent-subtle)]'
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
                                                    className="w-full bg-surface-50 dark:bg-surface-950 border border-[var(--color-accent-dim)] rounded px-1.5 py-0.5 text-sm focus:outline-none"
                                                    autoFocus
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            ) : (
                                                <h4 className={`text-sm font-medium truncate mb-1 ${activeSession?.id === session.id
                                                    ? 'text-[var(--color-accent)]'
                                                    : 'text-[var(--color-text-primary)]'
                                                    }`}>
                                                    {session.title}
                                                </h4>
                                            )}

                                            <div className="flex items-center gap-2 text-[10px] text-surface-400">
                                                <span>{formatRelativeTime(session.updatedAt)}</span>
                                                {session.projectId && (
                                                    <span className="bg-[var(--color-accent-subtle)] px-1.5 py-0.5 rounded text-[var(--color-text-secondary)] capitalize truncate max-w-[80px]">
                                                        {projects.find(p => p.id === session.projectId)?.name ?? 'Linked'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Hover Actions */}
                                        <div className="hidden group-hover:flex items-center gap-1 absolute right-2 top-2 bg-[var(--color-chrome)]/80 backdrop-blur-sm rounded-lg p-0.5 shadow-sm border border-[var(--color-border)]">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setRenamingId(session.id);
                                                    setRenameTitle(session.title);
                                                }}
                                                className="p-1 text-surface-400 hover:text-[var(--color-accent)] rounded hover:bg-[var(--color-accent-subtle)]"
                                                title="Rename"
                                            >
                                                <Edit2 size={12} />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    updateSession(session.id, { status: session.status === 'archived' ? 'active' : 'archived' });
                                                }}
                                                className="p-1 text-surface-400 hover:text-amber-500 rounded hover:bg-[var(--color-accent-subtle)]"
                                                title={session.status === 'archived' ? 'Restore' : 'Archive'}
                                            >
                                                <Archive size={12} />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setConfirmDeleteId(session.id);
                                                }}
                                                className="p-1 text-surface-400 hover:text-red-500 rounded hover:bg-[var(--color-accent-subtle)]"
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
                        <div className="hud-panel-accent clip-corner-cut shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="font-hud text-sm text-[var(--color-accent)]">New Session</h3>
                                <button
                                    onClick={() => setShowNewSession(false)}
                                    className="p-1 rounded-full hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="space-y-5">
                                <div>
                                    <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-2 uppercase tracking-wider">Title</label>
                                    <input
                                        type="text"
                                        value={newSessionTitle}
                                        onChange={(e) => setNewSessionTitle(e.target.value)}
                                        placeholder="e.g., Marketing Strategy Q1"
                                        className="w-full bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-4 py-3 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
                                        autoFocus
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleCreateSession();
                                            if (e.key === 'Escape') setShowNewSession(false);
                                        }}
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-2 uppercase tracking-wider">Project (Optional)</label>
                                    <HudSelect
                                        value={selectedProjectId}
                                        onChange={(v) => setSelectedProjectId(v)}
                                        placeholder="No linked project"
                                        options={[
                                            { value: '', label: 'No linked project' },
                                            ...projects.map((p) => ({ value: p.id, label: p.name })),
                                        ]}
                                        icon={Layers}
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-2 uppercase tracking-wider">Template</label>
                                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-surface-300 dark:scrollbar-thumb-surface-700">
                                        {BRAINSTORM_TEMPLATES.map((template) => (
                                            <button
                                                key={template.id}
                                                type="button"
                                                onClick={() => setSelectedTemplateId(template.id)}
                                                className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${selectedTemplateId === template.id
                                                    ? 'border-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)] ring-1 ring-[var(--color-accent-dim)]'
                                                    : 'border-[var(--color-border)] hover:bg-[var(--color-accent-subtle)]'
                                                    }`}
                                            >
                                                <div className="mt-0.5">{templateIcons[template.icon]}</div>
                                                <div>
                                                    <p className={`text-sm font-semibold ${selectedTemplateId === template.id ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}>
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
                                        className="w-full btn-primary clip-corner-cut-sm py-3 text-sm font-medium disabled:opacity-50"
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
                <div className="flex-1 flex flex-col relative bg-surface-50/50 dark:bg-surface-950 dark:grid-bg">
                    {!activeSession && !loadingSession ? (
                        <div className="flex-1 flex items-center justify-center">
                            <EmptyFeatureState
                                icon={Brain}
                                title="Think out loud with AI"
                                description="Have a conversation with AI to explore ideas, solve problems, or plan your next move."
                                benefits={['Brainstorm freely in natural language', 'AI knows about your projects', 'Save insights as cards or ideas']}
                                ctaLabel="Start a Session"
                                ctaAction={() => setShowNewSession(true)}
                            />
                        </div>
                    ) : loadingSession ? (
                        <div className="flex-1 flex items-center justify-center">
                            <Loader2 size={40} className="animate-spin text-[var(--color-accent-dim)]" />
                        </div>
                    ) : activeSession ? (
                        <>
                            {/* Chat Header */}
                            <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-chrome)]/50 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
                                <div>
                                    <h2 className="text-lg font-bold text-[var(--color-text-primary)] leading-none">
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
                                    <span className="px-2 py-1 rounded-md bg-[var(--color-accent-subtle)] text-[var(--color-accent)] text-xs font-data border border-[var(--color-border-accent)] flex items-center gap-1">
                                        <span className="node-point-sm" />
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
                                                    className="text-left p-4 rounded-xl hud-panel hover:!border-[var(--color-border-accent)] transition-all group"
                                                >
                                                    <p className="text-sm font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-accent)]">{prompt}</p>
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
                                                <div className="bg-[var(--color-chrome)] border border-[var(--color-border)] rounded-2xl rounded-tl-sm p-5 shadow-sm">
                                                    <div className="text-[15px] text-surface-800 dark:text-surface-200 leading-relaxed prose prose-base dark:prose-invert max-w-none">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents as any}>
                                                            {streamingText}
                                                        </ReactMarkdown>
                                                        <span className="text-[var(--color-accent)] animate-pulse">▊</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Thinking State */}
                                    {streaming && !streamingText && (
                                        <div className="flex justify-start mb-6">
                                            <div className="bg-[var(--color-chrome)] border border-[var(--color-border)] rounded-2xl rounded-tl-sm p-4 shadow-sm flex items-center gap-3">
                                                <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
                                                <span className="text-sm text-surface-500">Thinking...</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Quick-reply Chips — inline after last message */}
                                    {parsedChips && (
                                        <div className="flex justify-start pl-7">
                                            <BrainstormQuickChips
                                                choices={parsedChips.choices}
                                                mode={parsedChips.mode}
                                                onSend={(selected) => {
                                                    const text = selected.join(', ');
                                                    handleSendMessage(text);
                                                }}
                                            />
                                        </div>
                                    )}

                                    <div ref={messagesEndRef} className="h-4" />
                                </div>
                            </div>

                            {/* No provider state — shown above input area */}
                            {!hasAnyEnabledProvider() && (
                                <div className="border-t border-[var(--color-border)]">
                                    <EmptyAIState featureName="brainstorming" />
                                </div>
                            )}

                            {/* Input Area */}
                            <div className="p-4 bg-surface-50 dark:bg-[var(--color-chrome)] border-t border-[var(--color-border)]">
                                <div className="max-w-3xl mx-auto relative">
                                    {streaming ? (
                                        <div className="absolute -top-12 left-1/2 -translate-x-1/2">
                                            <button
                                                onClick={() => abortStream()}
                                                className="bg-white dark:bg-surface-950 border border-[var(--color-accent-dim)] text-[var(--color-accent)] text-xs font-medium px-4 py-2 rounded-full shadow-lg flex items-center gap-2 hover:border-[var(--color-accent)] hover:scale-105 transition-transform"
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

                                    <div className={`relative bg-surface-50 dark:bg-[var(--color-chrome)] border-2 rounded-2xl focus-within:bg-white dark:focus-within:bg-surface-900 transition-all shadow-sm ${voice.isListening ? 'border-red-400 dark:border-red-500' : 'border-[var(--color-border)] focus-within:border-[var(--color-accent)]'}`}>
                                        <textarea
                                            ref={textareaRef}
                                            value={input}
                                            onChange={(e) => {
                                                setInput(e.target.value);
                                                if (e.target.value.length > 0) setChipsHidden(true);
                                                autoResize();
                                            }}
                                            onKeyDown={handleKeyDown}
                                            placeholder={voice.isListening ? 'Listening...' : voice.isProcessing ? 'Transcribing...' : 'Message AI...'}
                                            rows={1}
                                            className="w-full bg-transparent px-4 py-3 pr-24 text-sm text-surface-900 dark:text-surface-100 placeholder-surface-400 focus:outline-none focus:ring-0 border-transparent focus:border-transparent focus:ring-offset-0 resize-none max-h-48"
                                            style={{ minHeight: '48px' }}
                                        />
                                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                            {voice.isListening && (
                                                <button
                                                    onClick={voice.cancel}
                                                    className="p-2 rounded-xl text-surface-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                                                    title="Cancel voice input"
                                                >
                                                    <X size={16} />
                                                </button>
                                            )}
                                            <button
                                                onClick={voice.toggle}
                                                disabled={voice.isProcessing}
                                                className={`p-2 rounded-xl transition-all ${voice.isListening
                                                    ? 'bg-red-500/15 text-red-500 hover:bg-red-500/25 animate-pulse'
                                                    : voice.isProcessing
                                                        ? 'text-[var(--color-accent)] animate-pulse cursor-wait'
                                                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)]'
                                                    }`}
                                                title={voice.isListening ? 'Stop & transcribe' : voice.isProcessing ? 'Transcribing...' : 'Voice input'}
                                            >
                                                {voice.isListening ? <MicOff size={16} /> : <Mic size={16} />}
                                            </button>
                                            <button
                                                onClick={() => handleSendMessage()}
                                                disabled={!input.trim() || streaming}
                                                className={`p-2 rounded-xl transition-all ${!input.trim() || streaming
                                                    ? 'bg-[var(--color-border)] text-[var(--color-text-muted)] cursor-not-allowed'
                                                    : 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] shadow-md'
                                                    }`}
                                            >
                                                {streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                            </button>
                                        </div>
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
        <ConfirmDialog
            open={!!confirmDeleteId}
            title="Delete Session"
            message="Delete this brainstorm session? This cannot be undone."
            confirmLabel="Delete"
            variant="danger"
            onConfirm={() => { if (confirmDeleteId) handleDeleteSession(confirmDeleteId); }}
            onCancel={() => setConfirmDeleteId(null)}
        />
        </>
    );
}
