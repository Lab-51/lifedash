// === FILE PURPOSE ===
// Home dashboard page — Modern Design
// Enterprise-grade, widget-based layout with glassmorphism and rich visuals.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Mic,
    Plus,
    Brain,
    Lightbulb,
    ArrowRight,
    Clock,
    Activity,
    Layers,
    Zap,
    ClipboardList,
    Copy,
    Check,
    RefreshCw,
    X,
    Loader2,
    Timer,
    Star,
} from 'lucide-react';
import { useProjectStore } from '../stores/projectStore';
import { useMeetingStore } from '../stores/meetingStore';
import { useIdeaStore } from '../stores/ideaStore';
import { useBoardStore } from '../stores/boardStore';
import { toast } from '../hooks/useToast';
import { useFocusStore } from '../stores/focusStore';
import { useGamificationStore } from '../stores/gamificationStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ProductivityPulse from './ProductivityPulse';
import FocusStatsWidget from './FocusStatsWidget';

/** Return a time-based greeting string. */
function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
}

/** ECG waveform path — 4 heartbeats across 1000-unit width. */
const ECG_PATH = 'M 0,50 L 55,50 L 63,44 L 71,50 L 88,50 L 94,8 L 101,92 L 108,42 L 114,58 L 120,50 L 135,50 L 143,39 L 153,50 L 280,50 L 288,44 L 296,50 L 313,50 L 319,8 L 326,92 L 333,42 L 339,58 L 345,50 L 360,50 L 368,39 L 378,50 L 530,50 L 538,44 L 546,50 L 563,50 L 569,8 L 576,92 L 583,42 L 589,58 L 595,50 L 610,50 L 618,39 L 628,50 L 780,50 L 788,44 L 796,50 L 813,50 L 819,8 L 826,92 L 833,42 L 839,58 L 845,50 L 860,50 L 868,39 L 878,50 L 1000,50';


/** Format today's date as "Saturday, February 15". */
function formatToday(): string {
    return new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    });
}

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
    });
}

function getDurationMinutes(startedAt: string, endedAt: string): number {
    const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    return Math.round(ms / 60000);
}

const MAX_PROJECTS = 4;
const MAX_RECENT = 4;

export default function DashboardModern() {
    const navigate = useNavigate();
    const projects = useProjectStore(s => s.projects);
    const meetings = useMeetingStore(s => s.meetings);
    const ideas = useIdeaStore(s => s.ideas);
    const allCards = useBoardStore(s => s.allCards);
    const focusMode = useFocusStore(s => s.mode);

    const activeProjects = useMemo(
        () => projects
            .filter(p => !p.archived)
            .sort((a, b) => {
                // Pinned first
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
                // Then latest to oldest
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            })
            .slice(0, MAX_PROJECTS),
        [projects],
    );

    const recentMeetings = useMemo(
        () =>
            [...meetings]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, MAX_RECENT),
        [meetings],
    );

    const cardCountByProject = useMemo(() => {
        const map: Record<string, number> = {};
        for (const card of allCards) {
            map[card.projectId] = (map[card.projectId] || 0) + 1;
        }
        return map;
    }, [allCards]);

    const [standupText, setStandupText] = useState<string | null>(null);
    const [generatingStandup, setGeneratingStandup] = useState(false);
    const [standupCopied, setStandupCopied] = useState(false);
    const [standupPickerOpen, setStandupPickerOpen] = useState(false);
    const [standupProjectId, setStandupProjectId] = useState<string | undefined>(undefined);
    const standupRef = useRef<HTMLDivElement>(null);
    const standupBtnRef = useRef<HTMLButtonElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const handleGenerateStandup = async (projectId?: string) => {
        setStandupPickerOpen(false);
        setStandupProjectId(projectId);
        setGeneratingStandup(true);
        setStandupCopied(false);
        try {
            const result = await window.electronAPI.generateStandup(projectId);
            setStandupText(result.standup);
            toast('Standup ready', 'success');
            useGamificationStore.getState().awardXP('ai_standup');
            setTimeout(() => scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 100);
        } catch {
            toast('Failed to generate standup', 'error');
        } finally {
            setGeneratingStandup(false);
        }
    };
    const handleCopyStandup = async () => {
        if (!standupText) return;
        await navigator.clipboard.writeText(standupText);
        setStandupCopied(true);
        toast('Standup copied to clipboard', 'success');
        setTimeout(() => setStandupCopied(false), 2000);
    };

    const [activityData, setActivityData] = useState<Record<string, number>>({});
    useEffect(() => {
        window.electronAPI.getActivityData().then(r => setActivityData(r.dayCounts));
    }, [allCards.length, meetings.length, ideas.length]);

    return (
        <div ref={scrollContainerRef} className="h-full overflow-y-auto bg-surface-50/50 dark:bg-surface-950">
            {/* Hero Section */}
            <div className="relative p-8 pb-12 overflow-hidden">

                <div className="relative z-10 flex items-end justify-between gap-4">
                    <div className="shrink-0">
                        <h1 className="text-4xl font-light tracking-tight text-surface-900 dark:text-surface-50">
                            {getGreeting()}
                        </h1>
                        <p className="text-surface-500 mt-2 font-medium">
                            {formatToday()}
                        </p>
                    </div>

                    {/* Heartbeat monitor — two staggered sweeps for seamless loop */}
                    <div className="flex-1 min-w-0 relative h-10 mb-1" aria-hidden="true">
                        {[false, true].map(delayed => (
                            <div key={delayed ? 'b' : 'a'} className="absolute inset-0">
                                <svg
                                    className={`w-full h-full ecg-trail${delayed ? ' ecg-delayed' : ''}`}
                                    viewBox="0 0 1000 100"
                                    preserveAspectRatio="none"
                                    fill="none"
                                >
                                    <path
                                        d={ECG_PATH}
                                        className="stroke-emerald-500/80 dark:stroke-emerald-400/70"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        style={{ filter: 'drop-shadow(0 0 3px rgb(16 185 129 / 0.5))' }}
                                    />
                                </svg>
                                <svg
                                    className={`w-full h-full ecg-cursor${delayed ? ' ecg-delayed' : ''} absolute inset-0`}
                                    viewBox="0 0 1000 100"
                                    preserveAspectRatio="none"
                                    fill="none"
                                >
                                    <path
                                        d={ECG_PATH}
                                        className="stroke-emerald-400 dark:stroke-emerald-300"
                                        strokeWidth="3"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        style={{ filter: 'drop-shadow(0 0 5px rgb(16 185 129 / 0.7)) drop-shadow(0 0 10px rgb(16 185 129 / 0.3))' }}
                                    />
                                </svg>
                            </div>
                        ))}
                    </div>


                    <div className="flex gap-3 shrink-0">
                        {[
                            { icon: Mic, label: 'Record', path: '/meetings?action=record', colors: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 hover:bg-rose-500 hover:text-white dark:hover:bg-rose-600 hover:border-transparent' },
                            { icon: Plus, label: 'Project', path: '/projects?action=create', colors: 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-500/10 border-primary-200 dark:border-primary-500/20 hover:bg-primary-500 hover:text-white dark:hover:bg-primary-600 hover:border-transparent' },
                            { icon: Brain, label: 'Brainstorm', path: '/brainstorm?action=create', colors: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/20 hover:bg-indigo-500 hover:text-white dark:hover:bg-indigo-600 hover:border-transparent' },
                            { icon: Lightbulb, label: 'Idea', path: '/ideas?action=create', colors: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 hover:bg-amber-500 hover:text-white dark:hover:bg-amber-600 hover:border-transparent' },
                        ].map(({ icon: Icon, label, path, colors }) => (
                            <button
                                key={label}
                                onClick={() => navigate(path)}
                                className={`group flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all duration-300 border hover:scale-105 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-white/5 ${colors}`}
                                title={`New ${label}`}
                            >
                                <Icon size={24} className="mb-2 transition-transform duration-300 group-hover:scale-110" />
                                <span className="text-xs font-bold">{label}</span>
                            </button>
                        ))}
                        {/* Focus button */}
                        <button
                            onClick={() => {
                                const focusState = useFocusStore.getState();
                                if (focusState.mode === 'idle') {
                                    focusState.setShowStartModal(true);
                                }
                            }}
                            className={`group flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all duration-300 border hover:scale-105 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-white/5 hover:border-transparent ${focusMode === 'focus' || focusMode === 'break'
                                ? 'bg-emerald-500 text-white border-transparent shadow-md shadow-emerald-500/20'
                                : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-500 hover:text-white dark:hover:bg-emerald-600'
                                }`}
                            title={focusMode === 'idle' ? 'Start Focus Session' : 'In Focus'}
                        >
                            <Timer size={24} className={`mb-2 transition-transform duration-300 group-hover:scale-110 ${focusMode === 'focus' || focusMode === 'break' ? 'animate-[spin_4s_linear_infinite]' : ''}`} />
                            <span className="text-xs font-bold">
                                {focusMode === 'focus' || focusMode === 'break' ? 'In Focus' : 'Focus'}
                            </span>
                        </button>
                        {/* Standup button with project picker */}
                        <div>
                            <button
                                ref={standupBtnRef}
                                onClick={() => generatingStandup ? undefined : setStandupPickerOpen(o => !o)}
                                disabled={generatingStandup}
                                className={`group flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all duration-300 border hover:scale-105 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-white/5 disabled:opacity-50 disabled:hover:scale-100 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 hover:border-emerald-500 hover:bg-emerald-500 hover:text-white dark:hover:bg-emerald-600 disabled:hover:bg-emerald-50 dark:disabled:hover:bg-emerald-500/10 disabled:hover:border-emerald-200 dark:disabled:hover:border-emerald-500/20 disabled:hover:text-emerald-600 dark:disabled:hover:text-emerald-400`}
                                title="Generate Standup"
                            >
                                {generatingStandup ? (
                                    <Loader2 size={24} className="mb-2 animate-spin" />
                                ) : (
                                    <ClipboardList size={24} className="mb-2 transition-transform duration-300 group-hover:scale-110" />
                                )}
                                <span className="text-xs font-bold">
                                    {generatingStandup ? 'Loading...' : 'Standup'}
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Grid - Overlapping the Hero */}
            <div className="px-8 pb-8 -mt-6 relative z-20">

                {/* Standup Result — above the grid so it's impossible to miss */}
                {standupText !== null && standupText.length > 0 && (
                    <div ref={standupRef} className="mb-6 bg-white dark:bg-surface-900 rounded-2xl border border-emerald-300 dark:border-emerald-800/60 shadow-md p-5">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <ClipboardList size={16} className="text-emerald-500" />
                                <h3 className="font-semibold text-surface-900 dark:text-surface-100">Daily Standup</h3>
                                {standupProjectId ? (
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-medium">
                                        {projects.find(p => p.id === standupProjectId)?.name || 'Project'}
                                    </span>
                                ) : (
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-surface-100 dark:bg-surface-800 text-surface-500 font-medium">
                                        All Projects
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={handleCopyStandup} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors" title="Copy to clipboard">
                                    {standupCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} className="text-surface-400" />}
                                </button>
                                <button onClick={() => handleGenerateStandup(standupProjectId)} disabled={generatingStandup} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors" title="Regenerate">
                                    <RefreshCw size={14} className={`text-surface-400 ${generatingStandup ? 'animate-spin' : ''}`} />
                                </button>
                                <button onClick={() => setStandupText(null)} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors" title="Dismiss">
                                    <X size={14} className="text-surface-400" />
                                </button>
                            </div>
                        </div>
                        <div className="text-sm text-surface-700 dark:text-surface-200 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{standupText}</ReactMarkdown>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-12 gap-6 pb-8">

                    {/* Stats Row */}
                    <div className="col-span-12 sm:col-span-4 lg:col-span-4">
                        <div className="bg-gradient-to-br from-white to-surface-50 dark:from-surface-900 dark:to-surface-800/80 rounded-2xl p-6 border border-surface-200/60 dark:border-surface-700/50 shadow-sm flex items-center justify-between group cursor-default hover:shadow-md hover:border-primary-500/30 transition-all duration-300 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-8 w-32 h-32 bg-primary-500/5 dark:bg-primary-500/10 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-primary-500/10 transition-colors" />
                            <div className="flex flex-col gap-1 relative z-10">
                                <p className="text-surface-500 dark:text-surface-400 text-[11px] font-bold uppercase tracking-widest drop-shadow-sm">Active Projects</p>
                                <p className="text-4xl font-light tracking-tight text-surface-900 dark:text-surface-50 drop-shadow-sm">{projects.length}</p>
                            </div>
                            <div className="relative z-10 w-14 h-14 rounded-2xl bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 flex items-center justify-center border border-primary-100 dark:border-primary-800/50 group-hover:scale-110 group-hover:-rotate-3 transition-transform shadow-sm">
                                <Layers size={26} strokeWidth={1.5} />
                            </div>
                        </div>
                    </div>
                    <div className="col-span-12 sm:col-span-4 lg:col-span-4">
                        <div className="bg-gradient-to-br from-white to-surface-50 dark:from-surface-900 dark:to-surface-800/80 rounded-2xl p-6 border border-surface-200/60 dark:border-surface-700/50 shadow-sm flex items-center justify-between group cursor-default hover:shadow-md hover:border-emerald-500/30 transition-all duration-300 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-8 w-32 h-32 bg-emerald-500/5 dark:bg-emerald-500/10 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-emerald-500/10 transition-colors" />
                            <div className="flex flex-col gap-1 relative z-10">
                                <p className="text-surface-500 dark:text-surface-400 text-[11px] font-bold uppercase tracking-widest drop-shadow-sm">Meetings Logged</p>
                                <p className="text-4xl font-light tracking-tight text-surface-900 dark:text-surface-50 drop-shadow-sm">{meetings.length}</p>
                            </div>
                            <div className="relative z-10 w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-100 dark:border-emerald-800/50 group-hover:scale-110 group-hover:-rotate-3 transition-transform shadow-sm">
                                <Activity size={26} strokeWidth={1.5} />
                            </div>
                        </div>
                    </div>
                    <div className="col-span-12 sm:col-span-4 lg:col-span-4">
                        <div className="bg-gradient-to-br from-white to-surface-50 dark:from-surface-900 dark:to-surface-800/80 rounded-2xl p-6 border border-surface-200/60 dark:border-surface-700/50 shadow-sm flex items-center justify-between group cursor-default hover:shadow-md hover:border-amber-500/30 transition-all duration-300 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-8 w-32 h-32 bg-amber-500/5 dark:bg-amber-500/10 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-amber-500/10 transition-colors" />
                            <div className="flex flex-col gap-1 relative z-10">
                                <p className="text-surface-500 dark:text-surface-400 text-[11px] font-bold uppercase tracking-widest drop-shadow-sm">Total Ideas</p>
                                <p className="text-4xl font-light tracking-tight text-surface-900 dark:text-surface-50 drop-shadow-sm">{ideas.length}</p>
                            </div>
                            <div className="relative z-10 w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-100 dark:border-amber-800/50 group-hover:scale-110 group-hover:-rotate-3 transition-transform shadow-sm">
                                <Zap size={26} strokeWidth={1.5} />
                            </div>
                        </div>
                    </div>

                    {/* Left Col: Projects & Priority */}
                    <div className="col-span-12 lg:col-span-8 space-y-6">
                        <div className="bg-white dark:bg-surface-900 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm overflow-hidden h-full flex flex-col">
                            <div className="p-5 border-b border-surface-100 dark:border-surface-800 flex justify-between items-center shrink-0">
                                <h3 className="font-semibold text-lg text-surface-900 dark:text-surface-100">Current Projects</h3>
                                <button onClick={() => navigate('/projects')} className="text-sm text-primary-500 hover:text-primary-600 font-medium flex items-center gap-1 transition-colors">
                                    View All <ArrowRight size={14} />
                                </button>
                            </div>
                            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
                                {activeProjects.length === 0 ? (
                                    <div className="col-span-2 text-center py-10 text-surface-500 flex flex-col items-center justify-center">
                                        <Layers size={24} className="mb-2 opacity-30" />
                                        No active projects. Start something new!
                                    </div>
                                ) : (
                                    activeProjects.map(project => (
                                        <div
                                            key={project.id}
                                            onClick={() => navigate(`/projects/${project.id}`)}
                                            className="group relative bg-surface-50 dark:bg-surface-800/50 rounded-xl p-4 cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors border border-surface-100 dark:border-surface-700/50 shadow-sm hover:shadow-md"
                                        >
                                            <div className="flex justify-between items-start mb-3">
                                                <div className="relative">
                                                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-sm" style={{ backgroundColor: project.color || '#3b82f6' }}>
                                                        {project.name.charAt(0).toUpperCase()}
                                                    </div>
                                                    {project.pinned && (
                                                        <Star size={12} className="absolute -top-1 -right-1 text-amber-400 fill-amber-400 drop-shadow-sm" />
                                                    )}
                                                </div>
                                                <div className="bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300 text-[10px] px-2 py-1 rounded-full font-bold uppercase transition-colors group-hover:bg-primary-100 group-hover:text-primary-600 dark:group-hover:bg-primary-900/30 dark:group-hover:text-primary-400">
                                                    {cardCountByProject[project.id] || 0} Tasks
                                                </div>
                                            </div>
                                            <h4 className="font-bold text-surface-900 dark:text-surface-100 mb-1 group-hover:text-primary-500 transition-colors line-clamp-1">{project.name}</h4>
                                            <p className="text-xs text-surface-500 line-clamp-2">
                                                {project.description || 'No description provided.'}
                                            </p>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Col: Timeline/Feed */}
                    <div className="col-span-12 lg:col-span-4 space-y-6">
                        <div className="bg-white dark:bg-surface-900 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm h-full flex flex-col">
                            <div className="p-5 border-b border-surface-100 dark:border-surface-800 shrink-0">
                                <h3 className="font-semibold text-lg text-surface-900 dark:text-surface-100">Recent Meetings</h3>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 max-h-[400px]">
                                {recentMeetings.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-surface-400 text-sm py-10">
                                        <Mic size={24} className="mb-2 opacity-50" />
                                        No recent usage
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        {recentMeetings.map((meeting, i) => (
                                            <button
                                                key={meeting.id}
                                                onClick={() => navigate(`/meetings?openMeeting=${meeting.id}`)}
                                                className="w-full text-left p-3 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors flex gap-3 group"
                                            >
                                                <div className="flex flex-col items-center gap-1 mt-1">
                                                    <div className="w-2 h-2 rounded-full bg-primary-400 group-hover:scale-125 transition-transform" />
                                                    {i !== recentMeetings.length - 1 && <div className="w-px h-full bg-surface-200 dark:bg-surface-700" />}
                                                </div>
                                                <div className="flex-1 pb-2">
                                                    <h5 className="text-sm font-medium text-surface-900 dark:text-surface-100 group-hover:text-primary-500 transition-colors line-clamp-1">
                                                        {meeting.title}
                                                    </h5>
                                                    <div className="flex items-center gap-2 mt-1.5">
                                                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 group-hover:bg-surface-200 dark:group-hover:bg-surface-600 transition-colors">
                                                            {formatDate(meeting.createdAt)}
                                                        </span>
                                                        {meeting.endedAt && (
                                                            <span className="text-[10px] text-surface-400 flex items-center gap-1">
                                                                <Clock size={10} /> {getDurationMinutes(meeting.startedAt, meeting.endedAt)}m
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="p-3 border-t border-surface-100 dark:border-surface-800 shrink-0 mt-auto">
                                <button onClick={() => navigate('/meetings')} className="w-full py-2 flex items-center justify-center gap-1 text-xs font-medium text-surface-500 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-50 dark:hover:bg-surface-800 rounded-lg transition-colors uppercase tracking-wide">
                                    View All Activities <ArrowRight size={12} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Focus Stats */}
                    <div className="col-span-12 xl:col-span-6">
                        <FocusStatsWidget />
                    </div>

                    {/* Productivity Pulse */}
                    {(projects.length > 0 || meetings.length > 0) && (
                        <div className="col-span-12 xl:col-span-6 flex items-stretch">
                            <ProductivityPulse data={activityData} />
                        </div>
                    )}

                </div>
            </div>

            {/* Standup project picker — fixed position to escape hero overflow-hidden */}
            {standupPickerOpen && (
                <>
                    <div className="fixed inset-0 z-50" onClick={() => setStandupPickerOpen(false)} />
                    <div
                        className="fixed z-50 w-56 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl shadow-xl py-1 max-h-64 overflow-y-auto"
                        style={{
                            top: (standupBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 8,
                            right: window.innerWidth - (standupBtnRef.current?.getBoundingClientRect().right ?? 0),
                        }}
                    >
                        <button
                            onClick={() => handleGenerateStandup(undefined)}
                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-surface-900 dark:text-surface-100 font-medium"
                        >
                            All Projects
                        </button>
                        {projects.filter(p => !p.archived).length > 0 && (
                            <div className="border-t border-surface-100 dark:border-surface-800 my-1" />
                        )}
                        {projects.filter(p => !p.archived).map(p => (
                            <button
                                key={p.id}
                                onClick={() => handleGenerateStandup(p.id)}
                                className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors flex items-center gap-2"
                            >
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color || '#3b82f6' }} />
                                <span className="text-surface-700 dark:text-surface-200 truncate">{p.name}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
