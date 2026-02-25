// === FILE PURPOSE ===
// Meetings page — Modern Design
// Displays the meeting list with recording controls, using the new enterprise design system.

import { useEffect, useState, useRef, useMemo, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mic, Info, Search, X } from 'lucide-react';
import { useMeetingStore } from '../stores/meetingStore';
import { useRecordingStore } from '../stores/recordingStore';
import { useProjectStore } from '../stores/projectStore';
import RecordingControls from '../components/RecordingControls';
import MeetingCardModern from '../components/MeetingCardModern';
const MeetingDetailModal = lazy(() => import('../components/MeetingDetailModal'));
import LoadingSpinner from '../components/LoadingSpinner';

type SortOption = 'newest' | 'oldest' | 'title';

export default function MeetingsModern() {
    const meetings = useMeetingStore(s => s.meetings);
    const loading = useMeetingStore(s => s.loading);
    const error = useMeetingStore(s => s.error);
    const loadMeetings = useMeetingStore(s => s.loadMeetings);
    const loadMeeting = useMeetingStore(s => s.loadMeeting);
    const deleteMeeting = useMeetingStore(s => s.deleteMeeting);
    const addTranscriptSegment = useMeetingStore(s => s.addTranscriptSegment);
    const actionItemCounts = useMeetingStore(s => s.actionItemCounts);
    const loadActionItemCounts = useMeetingStore(s => s.loadActionItemCounts);
    const isRecording = useRecordingStore(s => s.isRecording);
    const completedMeetingId = useRecordingStore(s => s.completedMeetingId);
    const clearCompletedMeetingId = useRecordingStore(s => s.clearCompletedMeetingId);
    const projects = useProjectStore(s => s.projects);
    const loadProjects = useProjectStore(s => s.loadProjects);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<SortOption>('newest');
    const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
    const [autoOpenedMeetingId, setAutoOpenedMeetingId] = useState<string | null>(null);
    const [initialTranscriptSearch, setInitialTranscriptSearch] = useState<string | undefined>(undefined);
    const prevIsRecording = useRef(isRecording);
    const [hasModel, setHasModel] = useState<boolean | null>(null);
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [showControls, setShowControls] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();

    // Open meeting from URL search param (e.g. ?openMeeting=<id> from dashboard deep-link)
    useEffect(() => {
        const openMeetingId = searchParams.get('openMeeting');
        if (openMeetingId && !loading && meetings.length > 0) {
            const tsSearch = searchParams.get('transcriptSearch') ?? undefined;
            setInitialTranscriptSearch(tsSearch);
            setSelectedMeetingId(openMeetingId);
            searchParams.delete('openMeeting');
            searchParams.delete('transcriptSearch');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams, loading, meetings.length]);

    // Handle ?action=record — just clear the param (recording controls are always visible)
    // Handle ?action=record
    useEffect(() => {
        if (searchParams.get('action') === 'record') {
            setShowControls(true);
            searchParams.delete('action');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    // Load meetings and projects on mount
    useEffect(() => {
        loadMeetings();
        loadProjects();
    }, [loadMeetings, loadProjects]);

    // Load action item counts once meetings are available
    useEffect(() => {
        if (meetings.length > 0) {
            loadActionItemCounts();
        }
    }, [meetings.length, loadActionItemCounts]);

    // Check if whisper model is available
    useEffect(() => {
        window.electronAPI.hasWhisperModel().then(setHasModel);
    }, []);

    // Refresh meetings list when recording stops
    useEffect(() => {
        if (prevIsRecording.current && !isRecording) {
            loadMeetings();
        }
        prevIsRecording.current = isRecording;
    }, [isRecording, loadMeetings]);

    // Auto-open meeting detail when a recording finishes processing
    useEffect(() => {
        if (completedMeetingId) {
            loadMeetings();
            setSelectedMeetingId(completedMeetingId);
            setAutoOpenedMeetingId(completedMeetingId);
            clearCompletedMeetingId();
        }
    }, [completedMeetingId, loadMeetings, clearCompletedMeetingId]);

    // Load selected meeting detail
    useEffect(() => {
        if (selectedMeetingId) {
            loadMeeting(selectedMeetingId);
        }
    }, [selectedMeetingId, loadMeeting]);

    // Listen for real-time transcript segments
    useEffect(() => {
        const cleanup = window.electronAPI.onTranscriptSegment((segment) => {
            addTranscriptSegment(segment);
        });
        return cleanup;
    }, [addTranscriptSegment]);

    // Download whisper model
    const handleDownloadModel = async () => {
        setDownloading(true);
        const cleanup = window.electronAPI.onWhisperDownloadProgress((progress) => {
            setDownloadProgress(progress.percent);
        });
        try {
            await window.electronAPI.downloadWhisperModel('ggml-base.en.bin');
            setHasModel(true);
        } catch {
            // Download failed - user can retry
        } finally {
            setDownloading(false);
            cleanup();
        }
    };

    // Build project name and color lookup maps
    const projectNameMap = new Map(projects.map(p => [p.id, p.name]));
    const projectColorMap = useMemo(() => {
        const map = new Map<string, string>();
        projects.forEach(p => map.set(p.id, p.color ?? '#6366f1'));
        return map;
    }, [projects]);

    // Filter meetings by search query
    const filteredMeetings = meetings.filter(m => {
        if (searchQuery.trim()) {
            const query = searchQuery.trim().toLowerCase();
            if (!m.title.toLowerCase().includes(query)) return false;
        }
        return true;
    });

    // Sort filtered meetings
    const sortedMeetings = [...filteredMeetings].sort((a, b) => {
        if (sortBy === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (sortBy === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return a.title.localeCompare(b.title);
    });

    if (loading && meetings.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <LoadingSpinner />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-surface-50/50 dark:bg-surface-950">
            {/* HUD Header */}
            <div className="p-8 pb-4 shrink-0">
                <div className="flex items-center justify-between gap-4 mb-2">
                    <div>
                        <div className="flex items-center gap-4 mb-1">
                            <div className="h-px w-16 bg-gradient-to-r from-transparent to-[var(--color-accent)] opacity-40" />
                            <span className="font-data text-[11px] tracking-[0.3em] text-[var(--color-accent)] text-glow">SYS.MEETINGS</span>
                            <div className="h-px w-16 bg-gradient-to-l from-transparent to-[var(--color-accent)] opacity-40" />
                        </div>
                        <h1 className="font-hud text-2xl text-[var(--color-accent)] text-glow">Meetings</h1>
                        <p className="text-[var(--color-text-secondary)] text-sm mt-1">Capture and analyze conversations.</p>
                    </div>

                    <button
                        onClick={() => setShowControls(!showControls)}
                        disabled={isRecording}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${showControls || isRecording
                                ? 'bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] text-[var(--color-text-primary)] cursor-default'
                                : 'bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] shadow-md hover:shadow-lg'
                            }`}
                    >
                        {isRecording ? (
                            <>
                                <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                                <span>Recording...</span>
                            </>
                        ) : showControls ? (
                            <>
                                <X size={18} />
                                <span>Close Recorder</span>
                            </>
                        ) : (
                            <>
                                <Mic size={18} />
                                <span>New Recording</span>
                            </>
                        )}
                    </button>
                </div>
                <div className="ruled-line-accent mb-6" />

                {/* Collapsible Recording Area */}
                {(showControls || isRecording) && (
                    <div className="mb-8 animate-in fade-in slide-in-from-top-4 duration-300">
                        <div className="max-w-2xl mx-auto shadow-2xl rounded-xl overflow-hidden ring-1 ring-surface-950/5">
                            <RecordingControls hasModel={hasModel} />
                        </div>
                    </div>
                )}

                {/* Filters & Search Toolbar */}
                <div className="flex hud-panel p-1.5 rounded-xl items-center gap-2 mb-2">
                    <div className="relative flex-1">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400" />
                        <input
                            type="text"
                            placeholder="Search transcripts..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-8 pr-8 py-1.5 text-sm bg-transparent border-none focus:ring-0 text-surface-900 dark:text-surface-100 placeholder-surface-400"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>

                    <div className="h-6 w-px bg-surface-200 dark:bg-surface-700 mx-1" />

                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                        className="bg-transparent text-xs font-medium text-surface-600 dark:text-surface-400 border-none focus:ring-0 cursor-pointer pr-8"
                    >
                        <option value="newest">Newest</option>
                        <option value="oldest">Oldest</option>
                        <option value="title">A-Z</option>
                    </select>
                </div>
            </div>

            {hasModel === false && (
                <div className="px-8 mb-4">
                    <div className="p-4 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800 flex items-start gap-3">
                        <Info size={18} className="text-blue-500 mt-0.5" />
                        <div className="flex-1">
                            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Transcription Model Missing</p>
                            <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">
                                Download the Whisper model to generate transcripts and use AI features.
                            </p>
                            {downloading ? (
                                <div className="mt-3 w-full max-w-xs">
                                    <div className="h-1.5 bg-blue-200 dark:bg-blue-900 rounded-full overflow-hidden">
                                        <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${downloadProgress}%` }} />
                                    </div>
                                    <p className="text-[10px] text-blue-500 mt-1 font-medium">{downloadProgress}% Downloaded</p>
                                </div>
                            ) : (
                                <button
                                    onClick={handleDownloadModel}
                                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 mt-2 flex items-center gap-1"
                                >
                                    Download Model (74 MB)
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div className="px-8 mb-4">
                    <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
                        {error}
                    </div>
                </div>
            )}

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto px-8 pb-8">
                {sortedMeetings.length === 0 ? (
                    <div className="mt-20 flex flex-col items-center justify-center text-center">
                        <div className="w-24 h-24 bg-[var(--color-accent-subtle)] rounded-full flex items-center justify-center mb-6 border border-[var(--color-border-accent)]">
                            <Mic size={40} className="text-[var(--color-accent-dim)]" />
                        </div>
                        <h3 className="text-xl font-medium text-surface-900 dark:text-surface-100 mb-2">
                            {searchQuery ? 'No matching meetings' : 'No recorded meetings'}
                        </h3>
                        <p className="text-surface-500 max-w-md mx-auto">
                            {searchQuery ? 'Try adjusting your filters or search query.' : 'Click the record button above to start capturing your next meeting.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {sortedMeetings.map(meeting => (
                            <MeetingCardModern
                                key={meeting.id}
                                meeting={meeting}
                                projectName={meeting.projectId ? projectNameMap.get(meeting.projectId) : undefined}
                                projectColor={meeting.projectId ? projectColorMap.get(meeting.projectId) : undefined}
                                actionItemCount={actionItemCounts[meeting.id] || 0}
                                onClick={() => setSelectedMeetingId(meeting.id)}
                                onDelete={() => {
                                    if (window.confirm(`Delete "${meeting.title}"? This cannot be undone.`)) {
                                        deleteMeeting(meeting.id);
                                    }
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Meeting detail modal */}
            <Suspense fallback={null}>
                {selectedMeetingId && (
                    <MeetingDetailModal
                        autoGenerate={selectedMeetingId === autoOpenedMeetingId}
                        initialTranscriptSearch={initialTranscriptSearch}
                        onClose={() => {
                            setSelectedMeetingId(null);
                            setAutoOpenedMeetingId(null);
                            setInitialTranscriptSearch(undefined);
                            loadMeetings(); // Refresh list after viewing/editing
                        }}
                    />
                )}
            </Suspense>
        </div>
    );
}
