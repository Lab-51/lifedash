// === FILE PURPOSE ===
// Meetings page — displays the meeting list with recording controls, status
// filter tabs, and meeting cards. Entry point for all meeting intelligence features.
//
// === DEPENDENCIES ===
// react (useEffect, useState, useRef), lucide-react (Mic),
// meetingStore, recordingStore, projectStore, RecordingControls, MeetingCard, LoadingSpinner

import { useEffect, useState, useRef } from 'react';
import { Mic, Info, Search, X } from 'lucide-react';
import { useMeetingStore } from '../stores/meetingStore';
import { useRecordingStore } from '../stores/recordingStore';
import { useProjectStore } from '../stores/projectStore';
import RecordingControls from '../components/RecordingControls';
import MeetingCard from '../components/MeetingCard';
import MeetingDetailModal from '../components/MeetingDetailModal';
import LoadingSpinner from '../components/LoadingSpinner';

type FilterTab = 'all' | 'recording' | 'completed';

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'recording', label: 'Recording' },
  { value: 'completed', label: 'Completed' },
];

function MeetingsPage() {
  const { meetings, loading, error, loadMeetings, loadMeeting, addTranscriptSegment } = useMeetingStore();
  const { isRecording, completedMeetingId, clearCompletedMeetingId } = useRecordingStore();
  const { projects, loadProjects } = useProjectStore();
  const [filter, setFilter] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [autoOpenedMeetingId, setAutoOpenedMeetingId] = useState<string | null>(null);
  const prevIsRecording = useRef(isRecording);
  const [hasModel, setHasModel] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // Load meetings and projects on mount
  useEffect(() => {
    loadMeetings();
    loadProjects();
  }, [loadMeetings, loadProjects]);

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

  // Build project name lookup map
  const projectNameMap = new Map(projects.map(p => [p.id, p.name]));

  // Filter meetings by status and search query
  const filteredMeetings = meetings.filter(m => {
    // Status filter
    if (filter === 'recording' && m.status !== 'recording') return false;
    if (filter === 'completed' && m.status !== 'completed') return false;

    // Search filter (case-insensitive title match)
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      if (!m.title.toLowerCase().includes(query)) return false;
    }

    return true;
  });

  // Full-page loading state when no meetings have been loaded yet
  if (loading && meetings.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-surface-100">Meetings</h1>
        <p className="mt-1 text-surface-400">
          Record, transcribe, and review your meetings.
        </p>
      </div>

      {/* Recording Controls */}
      <div className="mb-6">
        <RecordingControls />
      </div>

      {/* Whisper model notice */}
      {hasModel === false && (
        <div className="mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <div className="flex items-start gap-3">
            <Info size={16} className="text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-blue-300">
                No Whisper model installed. Recordings will be saved but transcription
                won't be available.
              </p>
              {downloading ? (
                <div className="mt-2">
                  <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${downloadProgress}%` }} />
                  </div>
                  <p className="text-xs text-surface-400 mt-1">Downloading... {downloadProgress}%</p>
                </div>
              ) : (
                <button
                  onClick={handleDownloadModel}
                  className="mt-2 text-sm text-blue-400 hover:text-blue-300 underline"
                >
                  Download base.en model (74 MB)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Filter tabs + Search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === tab.value
                  ? 'bg-surface-700 text-surface-100'
                  : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
          <input
            type="text"
            placeholder="Search meetings..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-surface-800 border border-surface-700 rounded-lg pl-8 pr-8 py-1.5
                       text-sm text-surface-200 placeholder:text-surface-500
                       focus:outline-none focus:border-primary-500 w-48"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Result count when searching */}
      {searchQuery.trim() && filteredMeetings.length > 0 && (
        <p className="text-xs text-surface-500 mb-2">
          {filteredMeetings.length} result{filteredMeetings.length !== 1 ? 's' : ''}
        </p>
      )}

      {/* Meeting cards grid or empty state */}
      {filteredMeetings.length === 0 ? (
        <div className="mt-12 flex flex-col items-center justify-center text-surface-500">
          {searchQuery.trim() ? (
            <>
              <Search size={48} className="mb-4 text-surface-600" />
              <p className="text-lg">No matching meetings</p>
              <p className="text-sm text-surface-500 mt-1">
                Try a different search term
              </p>
            </>
          ) : (
            <>
              <Mic size={48} className="mb-4 text-surface-600" />
              <p className="text-lg">
                {filter === 'all' ? 'No meetings yet' : `No ${filter} meetings`}
              </p>
              <p className="text-sm text-surface-500 mt-1">
                {filter === 'all'
                  ? 'Start a recording to create your first meeting'
                  : 'Try a different filter'}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMeetings.map(meeting => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              projectName={meeting.projectId ? projectNameMap.get(meeting.projectId) : undefined}
              onClick={() => setSelectedMeetingId(meeting.id)}
            />
          ))}
        </div>
      )}

      {/* Meeting detail modal */}
      {selectedMeetingId && (
        <MeetingDetailModal
          autoGenerate={selectedMeetingId === autoOpenedMeetingId}
          onClose={() => {
            setSelectedMeetingId(null);
            setAutoOpenedMeetingId(null);
            loadMeetings(); // Refresh list after viewing/editing
          }}
        />
      )}
    </div>
  );
}

export default MeetingsPage;
