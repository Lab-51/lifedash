// === FILE PURPOSE ===
// Home dashboard page — Modern Design
// Enterprise-grade, widget-based layout with glassmorphism and rich visuals.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Mic,
    Plus,
    Brain,
    Lightbulb,
    ArrowRight,
    Clock,
    Calendar,
    Activity,
    Layers,
    Zap,
    ClipboardList,
    Copy,
    Check,
    RefreshCw,
    X,
    Loader2,
    Flame,
} from 'lucide-react';
import { useProjectStore } from '../stores/projectStore';
import { useMeetingStore } from '../stores/meetingStore';
import { useIdeaStore } from '../stores/ideaStore';
import { useBoardStore } from '../stores/boardStore';
import { toast } from '../hooks/useToast';
import ActivityHeatmap, { getColor, calculateStreak } from './ActivityHeatmap';

/** Return a time-based greeting string. */
function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
}

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

    const activeProjects = useMemo(
        () => projects.filter(p => !p.archived).slice(0, MAX_PROJECTS),
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

    const handleGenerateStandup = async () => {
        setGeneratingStandup(true);
        setStandupCopied(false);
        try {
            const result = await window.electronAPI.generateStandup();
            setStandupText(result.standup);
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
    }, []);
    const streak = useMemo(() => calculateStreak(activityData), [activityData]);

    return (
        <div className="h-full flex flex-col overflow-hidden bg-surface-50/50 dark:bg-surface-950">
            {/* Hero Section */}
            <div className="relative shrink-0 p-8 pb-12 overflow-hidden">
                {/* Background Decorative Elem */}
                <div className="absolute top-0 right-0 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />

                <div className="relative z-10 flex items-end justify-between">
                    <div>
                        <h1 className="text-4xl font-light tracking-tight text-surface-900 dark:text-surface-50">
                            {getGreeting()}
                        </h1>
                        <p className="text-surface-500 mt-2 font-medium">
                            {formatToday()}
                        </p>
                    </div>

                    <div className="flex gap-3">
                        {[
                            { icon: Mic, label: 'Record', path: '/meetings?action=record', color: 'bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white' },
                            { icon: Plus, label: 'Project', path: '/projects?action=create', color: 'bg-primary-500/10 text-primary-500 hover:bg-primary-500 hover:text-white' },
                            { icon: Brain, label: 'Brainstorm', path: '/brainstorm?action=create', color: 'bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500 hover:text-white' },
                            { icon: Lightbulb, label: 'Idea', path: '/ideas?action=create', color: 'bg-amber-500/10 text-amber-500 hover:bg-amber-500 hover:text-white' },
                            { icon: ClipboardList, label: 'Standup', path: '', color: 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white' },
                        ].map(({ icon: Icon, label, path, color }) => (
                            <button
                                key={label}
                                onClick={() => path ? navigate(path) : handleGenerateStandup()}
                                disabled={!path && generatingStandup}
                                className={`flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all duration-200 border border-transparent hover:scale-105 hover:shadow-lg disabled:opacity-50 ${color}`}
                                title={`New ${label}`}
                            >
                                {!path && generatingStandup ? (
                                    <Loader2 size={24} className="mb-2 animate-spin" />
                                ) : (
                                    <Icon size={24} className="mb-2" />
                                )}
                                <span className="text-xs font-semibold">
                                    {!path && generatingStandup ? 'Loading...' : label}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Main Content Grid - Overlapping the Hero */}
            <div className="flex-1 overflow-y-auto px-8 pb-8 -mt-6 z-20">
                <div className="grid grid-cols-12 gap-6 pb-8">

                    {/* Stats Row */}
                    <div className="col-span-12 sm:col-span-4 lg:col-span-4">
                        <div className="bg-white dark:bg-surface-900 rounded-2xl p-5 border border-surface-200 dark:border-surface-800 shadow-sm flex items-center justify-between group cursor-default hover:border-primary-500/30 transition-colors">
                            <div>
                                <p className="text-surface-400 text-xs font-semibold uppercase tracking-wider mb-1">Active Projects</p>
                                <p className="text-3xl font-bold text-surface-900 dark:text-surface-50">{projects.length}</p>
                            </div>
                            <div className="w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 flex items-center justify-center">
                                <Layers size={24} />
                            </div>
                        </div>
                    </div>
                    <div className="col-span-12 sm:col-span-4 lg:col-span-4">
                        <div className="bg-white dark:bg-surface-900 rounded-2xl p-5 border border-surface-200 dark:border-surface-800 shadow-sm flex items-center justify-between group cursor-default hover:border-emerald-500/30 transition-colors">
                            <div>
                                <p className="text-surface-400 text-xs font-semibold uppercase tracking-wider mb-1">Meetings Info</p>
                                <p className="text-3xl font-bold text-surface-900 dark:text-surface-50">{meetings.length}</p>
                            </div>
                            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                                <Activity size={24} />
                            </div>
                        </div>
                    </div>
                    <div className="col-span-12 sm:col-span-4 lg:col-span-4">
                        <div className="bg-white dark:bg-surface-900 rounded-2xl p-5 border border-surface-200 dark:border-surface-800 shadow-sm flex items-center justify-between group cursor-default hover:border-amber-500/30 transition-colors">
                            <div>
                                <p className="text-surface-400 text-xs font-semibold uppercase tracking-wider mb-1">Total Ideas</p>
                                <p className="text-3xl font-bold text-surface-900 dark:text-surface-50">{ideas.length}</p>
                            </div>
                            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                                <Zap size={24} />
                            </div>
                        </div>
                    </div>

                    {/* Standup Result */}
                    {standupText && (
                        <div className="col-span-12 bg-white dark:bg-surface-900 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm p-5">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="font-semibold text-surface-900 dark:text-surface-100">Daily Standup</h3>
                                <div className="flex items-center gap-2">
                                    <button onClick={handleCopyStandup} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800" title="Copy">
                                        {standupCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} className="text-surface-400" />}
                                    </button>
                                    <button onClick={handleGenerateStandup} disabled={generatingStandup} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800" title="Regenerate">
                                        <RefreshCw size={14} className={`text-surface-400 ${generatingStandup ? 'animate-spin' : ''}`} />
                                    </button>
                                    <button onClick={() => setStandupText(null)} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800" title="Dismiss">
                                        <X size={14} className="text-surface-400" />
                                    </button>
                                </div>
                            </div>
                            <div className="text-sm text-surface-700 dark:text-surface-200 whitespace-pre-wrap">{standupText}</div>
                        </div>
                    )}

                    {/* Productivity Pulse */}
                    {(projects.length > 0 || meetings.length > 0) && (
                        <div className="col-span-12 bg-white dark:bg-surface-900 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm p-5">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="font-semibold text-surface-900 dark:text-surface-100">Productivity Pulse</h3>
                                {streak > 0 && (
                                    <span className="text-xs text-amber-500 font-semibold flex items-center gap-1">
                                        <Flame size={14} /> {streak} day streak
                                    </span>
                                )}
                            </div>
                            <ActivityHeatmap dayCounts={activityData} />
                            <div className="mt-2 flex items-center gap-3 text-xs text-surface-400">
                                <span>Less</span>
                                {[0, 1, 3, 5, 7].map(n => (
                                    <div key={n} className={`w-[10px] h-[10px] rounded-sm ${getColor(n)}`} />
                                ))}
                                <span>More</span>
                            </div>
                        </div>
                    )}

                    {/* Left Col: Projects & Priority */}
                    <div className="col-span-12 lg:col-span-8 space-y-6">
                        <div className="bg-white dark:bg-surface-900 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm overflow-hidden">
                            <div className="p-5 border-b border-surface-100 dark:border-surface-800 flex justify-between items-center">
                                <h3 className="font-semibold text-lg text-surface-900 dark:text-surface-100">Current Projects</h3>
                                <button onClick={() => navigate('/projects')} className="text-sm text-primary-500 hover:text-primary-600 font-medium flex items-center gap-1">
                                    View All <ArrowRight size={14} />
                                </button>
                            </div>
                            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {activeProjects.length === 0 ? (
                                    <div className="col-span-2 text-center py-10 text-surface-500">
                                        No active projects. Start something new!
                                    </div>
                                ) : (
                                    activeProjects.map(project => (
                                        <div
                                            key={project.id}
                                            onClick={() => navigate(`/projects/${project.id}`)}
                                            className="group relative bg-surface-50 dark:bg-surface-800/50 rounded-xl p-4 cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors border border-surface-100 dark:border-surface-700/50"
                                        >
                                            <div className="flex justify-between items-start mb-3">
                                                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-sm" style={{ backgroundColor: project.color || '#3b82f6' }}>
                                                    {project.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300 text-[10px] px-2 py-1 rounded-full font-bold uppercase">
                                                    {cardCountByProject[project.id] || 0} Tasks
                                                </div>
                                            </div>
                                            <h4 className="font-bold text-surface-900 dark:text-surface-100 mb-1 group-hover:text-primary-500 transition-colors">{project.name}</h4>
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
                        <div className="bg-white dark:bg-surface-900 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm h-full max-h-[500px] flex flex-col">
                            <div className="p-5 border-b border-surface-100 dark:border-surface-800">
                                <h3 className="font-semibold text-lg text-surface-900 dark:text-surface-100">Recent Meetings</h3>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2">
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
                                                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500">
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
                            <div className="p-3 border-t border-surface-100 dark:border-surface-800">
                                <button onClick={() => navigate('/meetings')} className="w-full py-2 text-xs font-medium text-surface-500 hover:text-surface-900 dark:hover:text-surface-100 transition-colors uppercase tracking-wide">
                                    View All Activities
                                </button>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
