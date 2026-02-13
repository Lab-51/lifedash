# Phase 4 — Plan 4 of 4: Meetings UI & Transcript Display

## Coverage
- **R4: Audio Capture** (UI completion — meetings list, recording from meetings page)
- **R5: Transcription** (UI completion — transcript display, real-time updates)

## Plan Overview
Phase 4 delivers Meeting Intelligence: Audio Capture (R4) and Transcription (R5). It requires 4 plans:

- **Plan 4.1** (DONE): Foundation — deps, shared types, meeting service, IPC handlers.
- **Plan 4.2** (DONE): Audio capture pipeline — capture bridge, audio processing in main, recording UI.
- **Plan 4.3** (DONE): Whisper transcription — worker thread, chunked transcription, real-time pipeline.
- **Plan 4.4** (this plan): Meetings UI — meetings page, transcript display, meeting ↔ project linking.

## Architecture Decisions for Plan 4.4

1. **Meetings store (Zustand)** — Follows the same pattern as projectStore. Manages
   the meetings list and selected meeting detail (with transcript segments). All data
   flows through `window.electronAPI` IPC bridge.

2. **MeetingsPage with integrated RecordingControls** — The RecordingControls component
   already exists from Plan 4.2. We embed it at the top of the Meetings page so users
   can start recordings directly from the meetings view.

3. **Meeting detail as a modal** — Follows the CardDetailModal pattern: fixed overlay
   with Escape-to-close, overlay click to close, scrollable content. Shows meeting info
   at top, transcript timeline below.

4. **Transcript timeline** — Segments displayed as a vertically scrollable list with
   timestamps on the left and content on the right. During active recording, new segments
   append automatically via `onTranscriptSegment` IPC event and auto-scroll to bottom.

5. **Meeting ↔ project linking** — A dropdown in the meeting detail modal lets users
   link/unlink meetings to projects. Uses the existing `useProjectStore.loadProjects()`
   to populate the dropdown and `window.electronAPI.updateMeeting()` to persist.

6. **Status filter tabs** — Simple tabs (All / Recording / Completed) above the meeting
   list. Client-side filtering since the dataset is small for a personal tool.

---

<phase n="4.4" name="Meetings UI and Transcript Display">
  <context>
    Plans 4.1-4.3 are complete. The app has:
    - meetingService.ts: CRUD + addTranscriptSegment() + getTranscripts()
    - Meeting, MeetingWithTranscript, TranscriptSegment, RecordingState types in shared/types.ts
    - WhisperModel, WhisperDownloadProgress types in shared/types.ts
    - ElectronAPI: getMeetings, getMeeting (with segments), createMeeting, updateMeeting, deleteMeeting
    - ElectronAPI: startRecording, stopRecording, sendAudioChunk, onRecordingState, onTranscriptSegment
    - ElectronAPI: getWhisperModels, downloadWhisperModel, hasWhisperModel, onWhisperDownloadProgress
    - recordingStore.ts: Zustand store with startRecording/stopRecording/initListener
    - RecordingControls.tsx: title input + start/stop + elapsed timer
    - RecordingIndicator.tsx: sidebar pulsing dot
    - MeetingsPage.tsx: currently a placeholder stub
    - projectStore.ts: loadProjects() returns Project[] (needed for project linking)

    UI patterns to follow:
    - ProjectsPage.tsx: header + grid of cards + loading/empty/error states
    - CardDetailModal.tsx: fixed overlay, Escape/overlay-click close, scrollable content
    - projectStore.ts: Zustand pattern (state + actions, IPC via window.electronAPI)

    Key files to reference:
    @src/renderer/pages/MeetingsPage.tsx
    @src/renderer/pages/ProjectsPage.tsx
    @src/renderer/components/CardDetailModal.tsx
    @src/renderer/components/RecordingControls.tsx
    @src/renderer/stores/projectStore.ts
    @src/renderer/stores/recordingStore.ts
    @src/shared/types.ts
    @src/preload/preload.ts
  </context>

  <task type="auto" n="1">
    <n>Create meeting store and meetings list page with recording controls</n>
    <files>
      src/renderer/stores/meetingStore.ts (create — Zustand store for meetings CRUD + selected meeting)
      src/renderer/components/MeetingCard.tsx (create — card component for meetings list)
      src/renderer/pages/MeetingsPage.tsx (replace — full meetings page with list, recording controls, states)
    </files>
    <preconditions>
      - Plans 4.1-4.3 complete (meeting backend, IPC, types all in place)
      - RecordingControls.tsx exists (Plan 4.2)
      - projectStore.ts exists (Plan 2.1)
    </preconditions>
    <action>
      Create the meeting Zustand store and replace the MeetingsPage stub with a full meetings
      list view that includes recording controls.

      WHY: Users need to see their meetings, start new recordings, and access meeting details.
      The Meetings page is the primary entry point for all meeting intelligence features.

      ## Step 1: Create meetingStore.ts

      Create `src/renderer/stores/meetingStore.ts` following the projectStore pattern:

      ```typescript
      // === FILE PURPOSE ===
      // Zustand store for meeting state management.
      // Manages the meeting list, selected meeting detail, and CRUD operations.
      //
      // === DEPENDENCIES ===
      // zustand, shared types, window.electronAPI

      import { create } from 'zustand';
      import type {
        Meeting,
        MeetingWithTranscript,
        TranscriptSegment,
        UpdateMeetingInput,
      } from '../../shared/types';

      interface MeetingStore {
        // State
        meetings: Meeting[];
        selectedMeeting: MeetingWithTranscript | null;
        loading: boolean;
        error: string | null;

        // Actions
        loadMeetings: () => Promise&lt;void&gt;;
        loadMeeting: (id: string) => Promise&lt;void&gt;;
        updateMeeting: (id: string, data: UpdateMeetingInput) => Promise&lt;void&gt;;
        deleteMeeting: (id: string) => Promise&lt;void&gt;;
        clearSelectedMeeting: () => void;
        addTranscriptSegment: (segment: TranscriptSegment) => void;
      }

      export const useMeetingStore = create&lt;MeetingStore&gt;((set, get) => ({
        meetings: [],
        selectedMeeting: null,
        loading: false,
        error: null,

        loadMeetings: async () => {
          set({ loading: true, error: null });
          try {
            const meetings = await window.electronAPI.getMeetings();
            set({ meetings, loading: false });
          } catch (error) {
            set({
              error: error instanceof Error ? error.message : 'Failed to load meetings',
              loading: false,
            });
          }
        },

        loadMeeting: async (id: string) => {
          try {
            const meeting = await window.electronAPI.getMeeting(id);
            set({ selectedMeeting: meeting });
          } catch (error) {
            set({
              error: error instanceof Error ? error.message : 'Failed to load meeting',
            });
          }
        },

        updateMeeting: async (id, data) => {
          const updated = await window.electronAPI.updateMeeting(id, data);
          set({
            meetings: get().meetings.map(m => (m.id === id ? updated : m)),
            selectedMeeting: get().selectedMeeting?.id === id
              ? { ...get().selectedMeeting!, ...updated }
              : get().selectedMeeting,
          });
        },

        deleteMeeting: async (id) => {
          await window.electronAPI.deleteMeeting(id);
          set({
            meetings: get().meetings.filter(m => m.id !== id),
            selectedMeeting: get().selectedMeeting?.id === id ? null : get().selectedMeeting,
          });
        },

        clearSelectedMeeting: () => set({ selectedMeeting: null }),

        // Append a transcript segment to the selected meeting (for real-time updates)
        addTranscriptSegment: (segment: TranscriptSegment) => {
          const selected = get().selectedMeeting;
          if (selected && selected.id === segment.meetingId) {
            set({
              selectedMeeting: {
                ...selected,
                segments: [...selected.segments, segment],
              },
            });
          }
        },
      }));
      ```

      Key design decisions:
      - `selectedMeeting` holds the full `MeetingWithTranscript` (with segments) for the detail modal
      - `addTranscriptSegment()` enables real-time updates: when a new segment arrives via IPC,
        we append it to the selected meeting's segments (if that meeting is currently open)
      - `updateMeeting` updates both the list entry and the selected meeting (if open)
      - `deleteMeeting` clears selectedMeeting if the deleted meeting was open

      ## Step 2: Create MeetingCard.tsx

      Create `src/renderer/components/MeetingCard.tsx`:

      ```typescript
      // === FILE PURPOSE ===
      // Meeting card component — displays a single meeting in the meetings list.
      // Shows title, date, duration, status badge, and optional project name.

      import { Mic, Clock, CheckCircle2, Loader2 } from 'lucide-react';
      import type { Meeting } from '../../shared/types';

      interface MeetingCardProps {
        meeting: Meeting;
        projectName?: string;
        onClick: () => void;
      }

      const STATUS_STYLES: Record&lt;string, { label: string; className: string; icon: typeof Mic }&gt; = {
        recording: {
          label: 'Recording',
          className: 'bg-red-500/15 text-red-400',
          icon: Mic,
        },
        processing: {
          label: 'Processing',
          className: 'bg-amber-500/15 text-amber-400',
          icon: Loader2,
        },
        completed: {
          label: 'Completed',
          className: 'bg-emerald-500/15 text-emerald-400',
          icon: CheckCircle2,
        },
      };

      function formatDate(dateStr: string): string {
        return new Date(dateStr).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        });
      }

      function formatTime(dateStr: string): string {
        return new Date(dateStr).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit',
        });
      }

      function formatDuration(startedAt: string, endedAt: string | null): string {
        if (!endedAt) return 'In progress';
        const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        if (min === 0) return `${sec}s`;
        return `${min}m ${sec}s`;
      }

      export default function MeetingCard({ meeting, projectName, onClick }: MeetingCardProps) {
        const status = STATUS_STYLES[meeting.status] || STATUS_STYLES.completed;
        const StatusIcon = status.icon;

        return (
          &lt;button
            onClick={onClick}
            className="w-full text-left p-4 bg-surface-800 border border-surface-700 rounded-lg
                       hover:border-surface-600 transition-colors group"
          &gt;
            &lt;div className="flex items-start justify-between gap-2"&gt;
              &lt;h3 className="font-semibold text-surface-100 truncate"&gt;
                {meeting.title}
              &lt;/h3&gt;
              &lt;span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full shrink-0 ${status.className}`}&gt;
                &lt;StatusIcon size={12} className={meeting.status === 'recording' ? 'animate-pulse' : ''} /&gt;
                {status.label}
              &lt;/span&gt;
            &lt;/div&gt;

            &lt;div className="mt-2 flex items-center gap-3 text-xs text-surface-400"&gt;
              &lt;span&gt;{formatDate(meeting.startedAt)}&lt;/span&gt;
              &lt;span&gt;{formatTime(meeting.startedAt)}&lt;/span&gt;
              &lt;span className="flex items-center gap-1"&gt;
                &lt;Clock size={12} /&gt;
                {formatDuration(meeting.startedAt, meeting.endedAt)}
              &lt;/span&gt;
            &lt;/div&gt;

            {projectName && (
              &lt;div className="mt-2"&gt;
                &lt;span className="text-xs bg-primary-600/10 text-primary-400 px-2 py-0.5 rounded-full"&gt;
                  {projectName}
                &lt;/span&gt;
              &lt;/div&gt;
            )}
          &lt;/button&gt;
        );
      }
      ```

      ## Step 3: Replace MeetingsPage.tsx

      Replace the stub in `src/renderer/pages/MeetingsPage.tsx` with the full page:

      - **Header section**: "Meetings" title + subtitle (same pattern as ProjectsPage)
      - **RecordingControls**: embedded at the top of the page (import from components)
      - **Status filter tabs**: All | Recording | Completed — simple client-side filter
      - **Meeting cards list**: responsive grid using MeetingCard component
      - **States**: loading spinner, empty state (Mic icon + message), error banner
      - **On mount**: call `loadMeetings()` + `loadProjects()` (for project name resolution)
      - **Auto-refresh**: when recording state changes (isRecording goes false), reload meetings

      The page layout:
      ```
      ┌─────────────────────────────────────────┐
      │ Meetings                                 │
      │ Record, transcribe, and review.          │
      ├─────────────────────────────────────────┤
      │ [RecordingControls component]            │
      ├─────────────────────────────────────────┤
      │ [All] [Recording] [Completed]  filter    │
      ├─────────────────────────────────────────┤
      │ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
      │ │ Meeting  │ │ Meeting  │ │ Meeting  │ │
      │ │ Card 1   │ │ Card 2   │ │ Card 3   │ │
      │ └──────────┘ └──────────┘ └──────────┘ │
      └─────────────────────────────────────────┘
      ```

      Key behaviors:
      - Import `useRecordingStore` to detect when recording stops → call `loadMeetings()`
      - Import `useProjectStore` to resolve project names on meeting cards
      - Client-side filter on `meeting.status`
      - Click a MeetingCard → set the meeting ID for the detail modal (Task 2)
      - For now, just track `selectedMeetingId` in local state. The modal is built in Task 2.

      For the meeting click handler, just set state — the modal won't render until Task 2:
      ```typescript
      const [selectedMeetingId, setSelectedMeetingId] = useState&lt;string | null&gt;(null);
      // Modal will be added in Task 2
      ```
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify meetingStore.ts exports: useMeetingStore with loadMeetings, loadMeeting, updateMeeting, deleteMeeting, clearSelectedMeeting, addTranscriptSegment
      3. Verify MeetingCard.tsx renders: title, date, time, duration, status badge, optional project name
      4. Verify MeetingsPage.tsx:
         - Renders RecordingControls at top
         - Has status filter tabs (All/Recording/Completed)
         - Renders grid of MeetingCards
         - Has loading, empty, and error states
         - Calls loadMeetings on mount
         - Resolves project names from projectStore
    </verify>
    <done>
      Meeting store manages meetings list and selected meeting with CRUD operations.
      MeetingsPage shows a list of meeting cards with RecordingControls, status filters,
      and project name badges. Cards are clickable (handler ready for Task 2 modal).
      TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - RecordingControls component works correctly as an embedded component (not just standalone)
      - projectStore.loadProjects() can be called from MeetingsPage without side effects
      - Client-side filtering is sufficient for a personal tool (no server-side pagination needed)
      - MeetingWithTranscript type from getMeeting(id) includes segments array
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Create meeting detail modal with transcript timeline</n>
    <files>
      src/renderer/components/MeetingDetailModal.tsx (create — modal with meeting info + transcript display)
      src/renderer/pages/MeetingsPage.tsx (modify — wire up modal open/close + transcript segment listener)
    </files>
    <preconditions>
      - Task 1 completed (meetingStore, MeetingCard, MeetingsPage exist)
      - CardDetailModal.tsx exists as reference pattern (Plan 2.3)
      - onTranscriptSegment IPC event wired in preload (Plan 4.2)
    </preconditions>
    <action>
      Create the meeting detail modal that displays meeting metadata and a scrollable
      transcript timeline. Wire it into the MeetingsPage with real-time transcript updates.

      WHY: Users need to view meeting transcripts after (or during) a recording. The modal
      provides a focused view of a single meeting with its full transcript. Real-time updates
      during active recordings make the transcription feel responsive.

      ## Step 1: Create MeetingDetailModal.tsx

      Create `src/renderer/components/MeetingDetailModal.tsx` following the CardDetailModal pattern:

      ```typescript
      // === FILE PURPOSE ===
      // Meeting detail modal — overlay for viewing meeting info and transcript.
      // Shows meeting metadata at top, scrollable transcript timeline below.
      // During active recordings, new segments append and auto-scroll.
      //
      // === DEPENDENCIES ===
      // react, lucide-react, meetingStore, shared types

      interface MeetingDetailModalProps {
        onClose: () => void;
      }
      ```

      Structure of the modal:

      ```
      ┌─ Meeting Detail Modal ──────────────────┐
      │ [Title (editable)]            [X close]  │
      │                                          │
      │ Status: ● Completed    Duration: 5m 23s  │
      │ Date: Feb 13, 2026 at 3:45 PM           │
      │ Project: [dropdown or badge]             │
      │                                          │
      │ ── Transcript ─────────────────────────  │
      │                                          │
      │ 00:00  Welcome everyone to today's...    │
      │ 00:12  Let's start with the agenda...    │
      │ 00:25  First item is the Q4 review...    │
      │ 00:38  Sales numbers were up 15%...      │
      │ ...                                      │
      │ (auto-scrolls during live recording)     │
      │                                          │
      │ [Delete Meeting]                         │
      └──────────────────────────────────────────┘
      ```

      Key implementation details:

      **Header**: Title displayed as h2. Click to edit (same pattern as CardDetailModal):
      - isEditingTitle state, input field, save on blur/Enter, cancel on Escape
      - Calls `meetingStore.updateMeeting(id, { title })` to persist

      **Metadata row**: Status badge (same styles as MeetingCard), duration, date/time.

      **Transcript section**:
      - Heading: "Transcript" with segment count
      - If no segments: empty state message ("No transcript available" or "Transcription in progress...")
      - Scrollable list of segments: timestamp on the left (formatted as MM:SS), content on the right
      - Container with `ref` for auto-scrolling
      - During active recording (meeting.status === 'recording'), auto-scroll to bottom when new segments arrive

      Segment timestamp formatting:
      ```typescript
      function formatTimestamp(ms: number): string {
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60).toString().padStart(2, '0');
        const sec = (totalSec % 60).toString().padStart(2, '0');
        return `${min}:${sec}`;
      }
      ```

      **Delete button**: At the bottom. Shows confirmation state ("Are you sure?" with Confirm/Cancel)
      before actually deleting. After delete, calls `onClose()`.

      **Close handlers**: Escape key + overlay click (same as CardDetailModal).

      **Data loading**: On mount, call `meetingStore.loadMeeting(meetingId)` to fetch meeting with
      transcript segments. The modal reads from `meetingStore.selectedMeeting`. On unmount, call
      `meetingStore.clearSelectedMeeting()`.

      Use `useMeetingStore` for all data access. The selected meeting's segments are in
      `selectedMeeting.segments`.

      ## Step 2: Wire modal into MeetingsPage

      In `src/renderer/pages/MeetingsPage.tsx`:

      1. Import MeetingDetailModal
      2. When `selectedMeetingId` is set, render the modal:
         ```typescript
         {selectedMeetingId && (
           &lt;MeetingDetailModal
             onClose={() => {
               setSelectedMeetingId(null);
               loadMeetings(); // Refresh list after viewing/editing
             }}
           /&gt;
         )}
         ```

      3. Before rendering the modal, call `loadMeeting(selectedMeetingId)` when selectedMeetingId changes:
         ```typescript
         useEffect(() => {
           if (selectedMeetingId) {
             loadMeeting(selectedMeetingId);
           }
         }, [selectedMeetingId, loadMeeting]);
         ```

      4. Add real-time transcript segment listener:
         ```typescript
         useEffect(() => {
           const cleanup = window.electronAPI.onTranscriptSegment((segment) => {
             addTranscriptSegment(segment);
           });
           return cleanup;
         }, [addTranscriptSegment]);
         ```
         This ensures that when the whisper worker produces new segments during a live recording,
         they appear in the modal's transcript view in real-time.

      5. Auto-refresh meetings list when recording stops:
         The page already listens to `isRecording` from `useRecordingStore` (from Task 1).
         When `isRecording` transitions from true → false, call `loadMeetings()` to refresh
         the list (the completed meeting's status and duration will have changed).
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify MeetingDetailModal.tsx:
         - Renders meeting title (editable), status badge, duration, date
         - Shows transcript segments with timestamps (MM:SS format)
         - Has delete button with confirmation
         - Closes on Escape key and overlay click
      3. Verify MeetingsPage.tsx:
         - Renders MeetingDetailModal when selectedMeetingId is set
         - Calls loadMeeting when selectedMeetingId changes
         - Listens for onTranscriptSegment and forwards to meetingStore.addTranscriptSegment
         - Refreshes meetings list when recording stops
      4. Verify transcript auto-scroll: transcript container has a ref and scrolls to bottom on new segments
    </verify>
    <done>
      Meeting detail modal shows full meeting info and scrollable transcript timeline.
      Title is editable. Delete with confirmation. Real-time transcript updates during
      active recording with auto-scroll. Modal wired into MeetingsPage. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - meetingStore.loadMeeting(id) returns MeetingWithTranscript with segments array
      - onTranscriptSegment fires for each new segment during recording (verified in Plan 4.3)
      - Auto-scroll using scrollIntoView or scrollTop works in the modal container
      - Delete meeting also cleans up associated transcript segments (cascading via DB)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Add meeting-project linking and whisper model status</n>
    <files>
      src/renderer/components/MeetingDetailModal.tsx (modify — add project selector dropdown)
      src/renderer/pages/MeetingsPage.tsx (modify — add whisper model status notice)
    </files>
    <preconditions>
      - Task 2 completed (MeetingDetailModal + MeetingsPage fully wired)
      - projectStore.ts exists with loadProjects/projects
      - ElectronAPI: hasWhisperModel, getWhisperModels, downloadWhisperModel, onWhisperDownloadProgress
    </preconditions>
    <action>
      Add project linking in the meeting detail modal and a whisper model status notice
      on the meetings page.

      WHY: Meeting ↔ project linking is a key feature — it lets users associate meetings with
      projects so they can later extract action items into project cards (Phase 5). The whisper
      model notice is important because transcription won't work without a downloaded model,
      and users need to know this + be able to download one.

      ## Step 1: Add project selector to MeetingDetailModal

      In `src/renderer/components/MeetingDetailModal.tsx`:

      1. Import `useProjectStore` from `../stores/projectStore`
      2. Load projects on mount: `useEffect(() => { loadProjects(); }, [loadProjects]);`
      3. Add a project selector row below the metadata section:

      ```
      Project: [dropdown: None / Project 1 / Project 2 / ...]
      ```

      Implementation:
      - A `&lt;select&gt;` element styled consistently with the app
      - Options: "None" (value="") + all projects from useProjectStore
      - On change: call `updateMeeting(meeting.id, { projectId: value || null })`
      - Selected value: `meeting.projectId || ''`

      Style the select to match the app:
      ```typescript
      &lt;select
        value={selectedMeeting.projectId || ''}
        onChange={(e) => updateMeeting(selectedMeeting.id, {
          projectId: e.target.value || null,
        })}
        className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-1.5
                   text-sm text-surface-200 focus:outline-none focus:border-primary-500"
      &gt;
        &lt;option value=""&gt;No project&lt;/option&gt;
        {projects.map(p =&gt; (
          &lt;option key={p.id} value={p.id}&gt;{p.name}&lt;/option&gt;
        ))}
      &lt;/select&gt;
      ```

      ## Step 2: Add whisper model status notice to MeetingsPage

      Users need to know if a whisper model is available before they can get transcription.
      Add a notice at the top of the page (below RecordingControls, above the filter tabs).

      On mount, check `window.electronAPI.hasWhisperModel()`:
      - If true: show nothing (model is available, transcription will work)
      - If false: show an info notice:

      ```
      ┌─────────────────────────────────────────────────────┐
      │ ℹ️ No Whisper model installed. Recordings will be   │
      │ saved but won't have transcription.                 │
      │ [Download Model (74 MB)]                            │
      └─────────────────────────────────────────────────────┘
      ```

      When the user clicks "Download Model":
      - Call `window.electronAPI.downloadWhisperModel('ggml-base.en.bin')`
      - Show download progress inline (percent bar or text)
      - Listen to `onWhisperDownloadProgress` for real-time progress
      - On completion: hide the notice, show brief success message

      State for this:
      ```typescript
      const [hasModel, setHasModel] = useState&lt;boolean | null&gt;(null); // null = checking
      const [downloading, setDownloading] = useState(false);
      const [downloadProgress, setDownloadProgress] = useState(0);
      ```

      On mount:
      ```typescript
      useEffect(() => {
        window.electronAPI.hasWhisperModel().then(setHasModel);
      }, []);
      ```

      Download handler:
      ```typescript
      const handleDownloadModel = async () => {
        setDownloading(true);
        const cleanup = window.electronAPI.onWhisperDownloadProgress((progress) => {
          setDownloadProgress(progress.percent);
        });
        try {
          await window.electronAPI.downloadWhisperModel('ggml-base.en.bin');
          setHasModel(true);
        } catch (err) {
          // Show error
        } finally {
          setDownloading(false);
          cleanup();
        }
      };
      ```

      Style the notice:
      ```typescript
      &lt;div className="mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20"&gt;
        &lt;div className="flex items-start gap-3"&gt;
          &lt;Info size={16} className="text-blue-400 mt-0.5 shrink-0" /&gt;
          &lt;div className="flex-1"&gt;
            &lt;p className="text-sm text-blue-300"&gt;
              No Whisper model installed. Recordings will be saved but transcription
              won't be available.
            &lt;/p&gt;
            {downloading ? (
              &lt;div className="mt-2"&gt;
                &lt;div className="h-1.5 bg-surface-700 rounded-full overflow-hidden"&gt;
                  &lt;div className="h-full bg-blue-500 transition-all" style={{ width: `${downloadProgress}%` }} /&gt;
                &lt;/div&gt;
                &lt;p className="text-xs text-surface-400 mt-1"&gt;Downloading... {downloadProgress}%&lt;/p&gt;
              &lt;/div&gt;
            ) : (
              &lt;button
                onClick={handleDownloadModel}
                className="mt-2 text-sm text-blue-400 hover:text-blue-300 underline"
              &gt;
                Download base.en model (74 MB)
              &lt;/button&gt;
            )}
          &lt;/div&gt;
        &lt;/div&gt;
      &lt;/div&gt;
      ```
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify MeetingDetailModal.tsx:
         - Has a project selector dropdown with "No project" + all projects
         - Changing the dropdown calls updateMeeting with new projectId
         - Project list is loaded from projectStore on mount
      3. Verify MeetingsPage.tsx:
         - Checks hasWhisperModel on mount
         - Shows info notice when no model is available
         - "Download Model" button triggers download with progress bar
         - Progress updates in real-time via onWhisperDownloadProgress
         - Notice hides when model is available
      4. Verify project name resolution still works on MeetingCards (from Task 1)
    </verify>
    <done>
      Meeting detail modal has a project selector dropdown for linking meetings to projects.
      MeetingsPage shows a whisper model status notice with download capability when no model
      is installed. Progress bar shows real-time download progress. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - hasWhisperModel() accurately reflects whether any model is locally available
      - downloadWhisperModel('ggml-base.en.bin') downloads to the correct location
      - onWhisperDownloadProgress fires reliably during download
      - DB cascade: deleting a meeting also deletes its transcript segments (Drizzle onDelete: cascade)
      - select element renders correctly with dark theme styling in Electron
    </assumptions>
  </task>
</phase>
