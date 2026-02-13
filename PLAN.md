# Plan 7.5 — Meeting Templates & Desktop Notifications

**Requirements:** R13 (partial — meeting templates) + R17 (desktop notifications, daily digest)
**Scope:** Meeting template presets with template-aware AI summarization, desktop notifications via Electron Notification API, and daily digest scheduler
**Approach:** Schema migration for template field, template presets as constants, Electron native notifications with settings-based preferences

## Phase 7 Overview

Phase 7 covers R11, R13, R14, R15, R16, R17 (31 pts total, v2 features).
Planned as 8 sequential plans:

| Plan | Requirement | Focus |
|------|-------------|-------|
| 7.1 | R16 (backend) | Card comments, relationships, activity log — schema + services + IPC |
| 7.2 | R16 (UI) | Comments UI, relationships UI, activity log, card templates in CardDetailModal |
| 7.3 | R15 | Database backup/restore (pg_dump), JSON/CSV export, backup UI |
| 7.4 | R11 | AI task structuring — service, IPC, store, project planning modal, card breakdown |
| **7.5** | **R13+R17** | **Meeting templates, desktop notifications, daily digest** |
| 7.6 | R14 | API transcription providers (Deepgram, AssemblyAI), fallback |
| 7.7 | R13 | Meeting analytics, speaker diarization, advanced features |
| 7.8 | R16 (rest) | Card attachments, due dates UI, reminders |

## Architecture Decisions

1. **Meeting templates as enum + constant presets:** Add a `meetingTemplateEnum` to the meetings table (`none`, `standup`, `retro`, `planning`, `brainstorm`, `one_on_one`). Template presets are defined as a TypeScript constant with name, description, agenda structure, and customized AI summarization prompts. This avoids a separate DB table for rarely-changing data.

2. **Template-aware AI summarization:** The meetingIntelligenceService's SUMMARIZATION_SYSTEM_PROMPT becomes a function that incorporates template-specific instructions. For example, a standup template tells the AI to look for blockers, yesterday's work, and today's plans. The action extraction prompt also adapts.

3. **Electron native Notification API:** Use Electron's built-in `new Notification()` (no 3rd-party packages). Works on Windows 10+, macOS, and Linux. Notification preferences stored in the existing settings key-value table.

4. **Notification scheduler pattern:** Follow the `autoBackupScheduler.ts` pattern — hourly interval check for due cards (within 24h), plus a daily digest at configurable time. Graceful error handling, non-blocking.

5. **Settings-based notification preferences:** Store notification config as JSON in the settings table under `notification_preferences` key. Defaults: all enabled, no quiet hours. UI in SettingsPage as a new section.

---

<phase n="7.5" name="Meeting Templates & Desktop Notifications">
  <context>
    Phase 7, Plan 5 of 8. Implements:
    - R13 (partial): Meeting templates — standup, retro, planning, brainstorm, 1-on-1
    - R17: Desktop notifications + daily digest

    Current meeting infrastructure:
    - meetings table: id, projectId, title, startedAt, endedAt, audioPath, status, createdAt (NO template field)
    - meetingStatusEnum: 'recording' | 'processing' | 'completed'
    - meetingService.ts: CRUD for meetings and transcripts
    - meetingIntelligenceService.ts: SUMMARIZATION_SYSTEM_PROMPT + ACTION_EXTRACTION_SYSTEM_PROMPT (hardcoded prompts)
    - CreateMeetingInput: { title, projectId? }
    - RecordingControls.tsx: title input + start/stop
    - recordingStore.ts: startRecording(title, projectId?) → creates meeting + starts capture

    Current notification infrastructure:
    - tray.ts: basic tray icon with show/quit menu (no notification integration)
    - autoBackupScheduler.ts: hourly interval pattern (reusable for notification scheduler)
    - Settings stored in settings table as key-value pairs

    Key files for context:
    @src/main/db/schema/meetings.ts (schema — add template enum + column)
    @src/main/services/meetingService.ts (CRUD — update toMeeting, createMeeting)
    @src/main/services/meetingIntelligenceService.ts (AI prompts — make template-aware)
    @src/main/services/autoBackupScheduler.ts (scheduler pattern to follow)
    @src/main/tray.ts (system tray)
    @src/main/main.ts (startup — wire scheduler init/stop)
    @src/main/ipc/meetings.ts (IPC handlers)
    @src/preload/preload.ts (bridge methods)
    @src/shared/types.ts (Meeting, CreateMeetingInput, ElectronAPI)
    @src/renderer/components/RecordingControls.tsx (add template selector)
    @src/renderer/pages/MeetingsPage.tsx (show template badge on cards)
    @src/renderer/components/MeetingDetailModal.tsx (show template info)
    @src/renderer/stores/recordingStore.ts (pass template to startRecording)
    @src/renderer/pages/SettingsPage.tsx (add notification settings section)
  </context>

  <task type="auto" n="1">
    <n>Meeting templates — schema, types, service, and template-aware AI prompts</n>
    <files>
      src/main/db/schema/meetings.ts (MODIFY — add meetingTemplateEnum + template column)
      src/shared/types.ts (MODIFY — add MeetingTemplateType, MeetingTemplate, update Meeting + CreateMeetingInput)
      src/main/services/meetingService.ts (MODIFY — handle template field in CRUD)
      src/main/services/meetingIntelligenceService.ts (MODIFY — template-aware prompts)
      drizzle migration (GENERATE — via npx drizzle-kit generate)
    </files>
    <action>
      ## WHY
      R13 requires meeting templates (standup, retro, planning, etc.) to provide structured
      meeting experiences. Templates customize the AI summarization to focus on template-relevant
      information (e.g., standups → blockers/progress/plans, retros → went well/improve/actions).

      ## WHAT

      ### 1a. Schema — modify src/main/db/schema/meetings.ts

      Add a new enum and column:
      ```typescript
      export const meetingTemplateEnum = pgEnum('meeting_template', [
        'none', 'standup', 'retro', 'planning', 'brainstorm', 'one_on_one'
      ]);
      ```

      Add to meetings table:
      ```typescript
      template: meetingTemplateEnum('template').default('none').notNull(),
      ```

      ### 1b. Generate migration

      Run: `npx drizzle-kit generate`
      Then apply: `npx drizzle-kit push` (or let the app apply on startup via runMigrations)

      ### 1c. Types — modify src/shared/types.ts

      Add template types (place near meeting types):

      ```typescript
      export type MeetingTemplateType = 'none' | 'standup' | 'retro' | 'planning' | 'brainstorm' | 'one_on_one';

      export interface MeetingTemplate {
        type: MeetingTemplateType;
        name: string;
        description: string;
        icon: string;           // Lucide icon name
        agenda: string[];       // Suggested agenda items
        aiPromptHint: string;   // Injected into AI summarization prompt
      }
      ```

      Update Meeting interface to include template:
      ```typescript
      export interface Meeting {
        id: string;
        projectId: string | null;
        title: string;
        template: MeetingTemplateType;  // ADD THIS
        startedAt: string;
        endedAt: string | null;
        audioPath: string | null;
        status: MeetingStatus;
        createdAt: string;
      }
      ```

      Update CreateMeetingInput:
      ```typescript
      export interface CreateMeetingInput {
        title: string;
        projectId?: string;
        template?: MeetingTemplateType;  // ADD THIS — defaults to 'none'
      }
      ```

      Add a MEETING_TEMPLATES constant (exported for use in both main and renderer):
      ```typescript
      export const MEETING_TEMPLATES: MeetingTemplate[] = [
        {
          type: 'none',
          name: 'General',
          description: 'No specific template — general meeting',
          icon: 'MessageSquare',
          agenda: [],
          aiPromptHint: '',
        },
        {
          type: 'standup',
          name: 'Daily Standup',
          description: 'Quick status update — what was done, what is planned, any blockers',
          icon: 'Users',
          agenda: ['What I did yesterday', 'What I plan to do today', 'Blockers or concerns'],
          aiPromptHint: 'This is a daily standup meeting. Focus on: (1) work completed since last standup, (2) planned work for today, (3) blockers or impediments. Keep the summary structured around these three areas.',
        },
        {
          type: 'retro',
          name: 'Retrospective',
          description: 'Team reflection — what went well, what to improve, action items',
          icon: 'RotateCcw',
          agenda: ['What went well', 'What could be improved', 'Action items for next sprint'],
          aiPromptHint: 'This is a retrospective meeting. Organize the summary into: (1) What went well — positive outcomes and successes, (2) What could be improved — pain points and challenges, (3) Action items — concrete steps the team agreed to take.',
        },
        {
          type: 'planning',
          name: 'Sprint Planning',
          description: 'Plan upcoming work — priorities, capacity, commitments',
          icon: 'CalendarCheck',
          agenda: ['Sprint goal', 'Priority items for the sprint', 'Capacity and availability', 'Commitments and assignments'],
          aiPromptHint: 'This is a sprint/iteration planning meeting. Focus on: (1) the sprint goal or objectives, (2) which items were prioritized, (3) capacity considerations, (4) who committed to what work. Track any estimated effort or story points mentioned.',
        },
        {
          type: 'brainstorm',
          name: 'Brainstorming',
          description: 'Creative ideation session — explore ideas freely',
          icon: 'Lightbulb',
          agenda: ['Problem statement or opportunity', 'Idea generation', 'Discussion and evaluation', 'Next steps'],
          aiPromptHint: 'This is a brainstorming session. Capture all ideas discussed, even partial ones. Group related ideas together. Note which ideas received the most interest or support. Highlight any novel or unconventional suggestions.',
        },
        {
          type: 'one_on_one',
          name: '1-on-1',
          description: 'One-on-one meeting — feedback, goals, personal development',
          icon: 'UserCheck',
          agenda: ['Check-in and wellbeing', 'Progress on goals', 'Feedback (both directions)', 'Development and growth', 'Action items'],
          aiPromptHint: 'This is a 1-on-1 meeting. Focus on: (1) personal updates and wellbeing, (2) progress on previously set goals, (3) feedback exchanged, (4) career development topics, (5) agreed action items. Be sensitive with personal topics — summarize without including private details.',
        },
      ];
      ```

      ### 1d. meetingService — modify src/main/services/meetingService.ts

      Update `toMeeting()` mapper to include template:
      ```typescript
      template: row.template,
      ```

      Update `createMeeting()` to accept and save template:
      The insert call should include `template: data.template ?? 'none'`.

      ### 1e. meetingIntelligenceService — make prompts template-aware

      Change SUMMARIZATION_SYSTEM_PROMPT from a constant string to a function:
      ```typescript
      function getSummarizationPrompt(template: MeetingTemplateType): string {
        const templateInfo = MEETING_TEMPLATES.find(t => t.type === template);
        const basePrompt = `You are a meeting summarization assistant...`;

        if (!templateInfo || !templateInfo.aiPromptHint) {
          return basePrompt;
        }

        return `${basePrompt}\n\nIMPORTANT CONTEXT: ${templateInfo.aiPromptHint}`;
      }
      ```

      Import MEETING_TEMPLATES and MeetingTemplateType from shared/types.

      Update `generateBrief()` to accept template parameter and pass it to getSummarizationPrompt.
      The template comes from the meeting record — load it when loading the meeting for brief generation.
      Since generateBrief already calls getMeeting(meetingId), the Meeting object now includes template.
      Use `meeting.template` to get the template-aware prompt.

      Similarly, update the ACTION_EXTRACTION_SYSTEM_PROMPT to be template-aware (optional but valuable):
      For standups, the AI should extract blocker-resolution actions.
      For retros, the AI should extract improvement actions.
      For planning, the AI should extract task assignments.

      Make ACTION_EXTRACTION_SYSTEM_PROMPT a function:
      ```typescript
      function getActionExtractionPrompt(template: MeetingTemplateType): string {
        const base = `You are a meeting action item extractor...`;
        if (template === 'standup') {
          return `${base}\n\nThis is a standup — prioritize extracting blocker-resolution tasks and follow-up items.`;
        }
        if (template === 'retro') {
          return `${base}\n\nThis is a retrospective — focus on improvement action items the team agreed to pursue.`;
        }
        if (template === 'planning') {
          return `${base}\n\nThis is a planning meeting — extract task assignments and commitments with owners when mentioned.`;
        }
        return base;
      }
      ```

      Update generateActions() similarly to use the template-aware prompt.

      ### 1f. No IPC/preload changes needed for this task
      The existing meeting CRUD IPC handlers already pass through CreateMeetingInput,
      which now includes the optional template field. The DB accepts it via the schema change.
    </action>
    <verify>
      1. `npx drizzle-kit generate` produces a migration adding meeting_template enum + column
      2. `npx tsc --noEmit` — zero TypeScript errors
      3. meetings table has template column with default 'none'
      4. Meeting type includes template field
      5. CreateMeetingInput has optional template field
      6. MEETING_TEMPLATES constant has 6 entries (none, standup, retro, planning, brainstorm, one_on_one)
      7. meetingService.toMeeting includes template field
      8. meetingService.createMeeting saves template to DB
      9. meetingIntelligenceService uses template-aware prompts for summarization and action extraction
      10. MEETING_TEMPLATES imported from shared/types in meetingIntelligenceService
    </verify>
    <done>Meeting template schema (migration applied), shared types with 6 template presets, template-aware AI prompts in meetingIntelligenceService. TypeScript compiles cleanly.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Drizzle pgEnum + column addition works with generate (standard Drizzle workflow)
      - Default 'none' for existing rows doesn't require data migration
      - MEETING_TEMPLATES as a shared constant is importable by both main and renderer
      - Template-aware prompts improve AI output quality for structured meeting types
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Meeting templates — UI integration (RecordingControls, MeetingsPage, MeetingDetailModal)</n>
    <files>
      src/renderer/components/RecordingControls.tsx (MODIFY — add template selector dropdown)
      src/renderer/stores/recordingStore.ts (MODIFY — startRecording accepts template)
      src/renderer/pages/MeetingsPage.tsx (MODIFY — show template badge on meeting cards)
      src/renderer/components/MeetingDetailModal.tsx (MODIFY — show template info + agenda)
    </files>
    <action>
      ## WHY
      Users need to select a template before starting a recording, see which template a meeting
      used, and view the template's agenda structure in the meeting detail. The template selection
      should be easy and optional (defaults to "General").

      ## WHAT

      ### 2a. RecordingControls — add template selector

      Import MEETING_TEMPLATES and MeetingTemplateType from shared/types.
      Import an icon (e.g., FileText or Layout from lucide-react) for the template selector.

      Add local state: `selectedTemplate: MeetingTemplateType` (default: 'none')

      Add a template selector dropdown below the title input (when not recording):
      ```tsx
      <select
        value={selectedTemplate}
        onChange={(e) => setSelectedTemplate(e.target.value as MeetingTemplateType)}
        className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2
                   text-sm text-surface-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
        disabled={starting}
      >
        {MEETING_TEMPLATES.map((t) => (
          <option key={t.type} value={t.type}>
            {t.name} — {t.description}
          </option>
        ))}
      </select>
      ```

      Update handleStart to pass template:
      ```typescript
      const handleStart = async () => {
        if (!title.trim()) return;
        await startRecording(title.trim(), undefined, selectedTemplate);
        setTitle('');
        setSelectedTemplate('none');
      };
      ```

      Show template-specific hint when a template is selected (not 'none'):
      Display the template's agenda items as a small list below the selector:
      ```tsx
      {selectedTemplate !== 'none' && (
        <div className="text-xs text-surface-400 space-y-0.5">
          <span className="font-medium">Suggested agenda:</span>
          {MEETING_TEMPLATES.find(t => t.type === selectedTemplate)?.agenda.map((item, i) => (
            <div key={i}>• {item}</div>
          ))}
        </div>
      )}
      ```

      ### 2b. recordingStore — accept template parameter

      Update the startRecording signature:
      ```typescript
      startRecording: (title: string, projectId?: string, template?: MeetingTemplateType) => Promise<void>;
      ```

      Pass template to createMeeting:
      ```typescript
      const meeting = await window.electronAPI.createMeeting({
        title,
        projectId,
        template: template ?? 'none',
      });
      ```

      ### 2c. MeetingsPage — show template badge on meeting cards

      Import MEETING_TEMPLATES from shared/types.

      On each MeetingCard component (or inline in MeetingsPage if MeetingCard is simple),
      show a small badge if the meeting has a template other than 'none':
      ```tsx
      {meeting.template && meeting.template !== 'none' && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-surface-700 text-surface-300">
          {MEETING_TEMPLATES.find(t => t.type === meeting.template)?.name ?? meeting.template}
        </span>
      )}
      ```

      Place this near the meeting title or status badge area.

      Check if MeetingsPage renders meeting cards inline or via a MeetingCard component.
      If MeetingCard.tsx exists as a separate component, modify it there.
      If inline in MeetingsPage, add the badge inline.

      ### 2d. MeetingDetailModal — show template info

      Import MEETING_TEMPLATES from shared/types.

      Add a template indicator in the metadata area (near status, duration, date):
      ```tsx
      {meeting.template && meeting.template !== 'none' && (() => {
        const tmpl = MEETING_TEMPLATES.find(t => t.type === meeting.template);
        return tmpl ? (
          <div className="flex items-center gap-2 text-sm text-surface-300">
            <span className="font-medium">{tmpl.name}</span>
            {tmpl.agenda.length > 0 && (
              <div className="mt-1 text-xs text-surface-400">
                {tmpl.agenda.map((item, i) => (
                  <div key={i}>• {item}</div>
                ))}
              </div>
            )}
          </div>
        ) : null;
      })()}
      ```

      This is informational — shows what template was used and its agenda for reference.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. RecordingControls shows template dropdown with 6 options
      3. Selecting a non-'none' template shows the agenda hint below the dropdown
      4. startRecording passes template to createMeeting
      5. MeetingsPage/MeetingCard shows template badge for templated meetings
      6. MeetingDetailModal shows template name and agenda for templated meetings
      7. Template selector resets to 'none' after starting a recording
      8. Default template is 'none' (backward compatible with existing meetings)
    </verify>
    <done>Template selector in RecordingControls, template badges on meeting cards, template info in MeetingDetailModal. Users can select a meeting type before recording. TypeScript compiles cleanly.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - MEETING_TEMPLATES importable from shared/types in renderer code (Vite handles this)
      - MeetingCard is either a separate component or inline in MeetingsPage (check during execution)
      - HTML select element is sufficient for template selection (no need for custom dropdown library)
      - Existing recordings display correctly with template='none' (backward compatible)
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Desktop notifications — service, scheduler, IPC, and settings UI</n>
    <files>
      src/main/services/notificationService.ts (NEW ~120 lines)
      src/main/services/notificationScheduler.ts (NEW ~130 lines)
      src/main/ipc/notifications.ts (NEW ~50 lines)
      src/main/ipc/index.ts (MODIFY — register notification handlers)
      src/shared/types.ts (MODIFY — add notification types + 3 ElectronAPI methods)
      src/preload/preload.ts (MODIFY — add 3 notification bridge methods)
      src/main/main.ts (MODIFY — wire scheduler init/stop)
      src/renderer/components/settings/NotificationSection.tsx (NEW ~150 lines)
      src/renderer/pages/SettingsPage.tsx (MODIFY — add NotificationSection)
    </files>
    <action>
      ## WHY
      R17 requires desktop notifications for due tasks, meeting reminders, and a daily digest.
      Electron has a built-in Notification API that works cross-platform. The scheduler follows
      the proven autoBackupScheduler pattern.

      ## WHAT

      ### 3a. Types — add to src/shared/types.ts

      ```typescript
      // === NOTIFICATION TYPES ===

      export interface NotificationPreferences {
        enabled: boolean;                // Master toggle
        dueDateReminders: boolean;       // Notify when cards are due within 24h
        dailyDigest: boolean;            // Morning summary of tasks/meetings
        dailyDigestHour: number;         // Hour (0-23) to send daily digest (default: 9)
        recordingReminders: boolean;     // Remind to record upcoming meetings
      }

      export interface DailyDigestData {
        dueToday: Array<{ title: string; projectName: string }>;
        overdue: Array<{ title: string; projectName: string; dueDate: string }>;
        recentMeetings: Array<{ title: string; date: string }>;
      }
      ```

      Add to ElectronAPI interface:
      ```typescript
      // Notifications
      notificationGetPreferences: () => Promise<NotificationPreferences>;
      notificationUpdatePreferences: (prefs: Partial<NotificationPreferences>) => Promise<void>;
      notificationSendTest: () => Promise<void>;
      ```

      ### 3b. Create src/main/services/notificationService.ts

      File header:
      ```
      // === FILE PURPOSE ===
      // Desktop notification service using Electron's Notification API.
      // Sends native OS notifications for due dates, daily digest, and reminders.
      //
      // === DEPENDENCIES ===
      // Electron (Notification), settings table for preferences
      //
      // === LIMITATIONS ===
      // - Requires OS notification permissions (usually granted by default for desktop apps)
      // - No notification history/log (fire-and-forget)
      // - Daily digest is text-only (no rich HTML in OS notifications)
      ```

      Imports:
      ```typescript
      import { Notification } from 'electron';
      import { getDb } from '../db/connection';
      import { settings } from '../db/schema';
      import { eq } from 'drizzle-orm';
      import type { NotificationPreferences } from '../../shared/types';
      ```

      Constants:
      ```typescript
      const SETTINGS_KEY = 'notification_preferences';
      const DEFAULT_PREFERENCES: NotificationPreferences = {
        enabled: true,
        dueDateReminders: true,
        dailyDigest: true,
        dailyDigestHour: 9,
        recordingReminders: true,
      };
      ```

      Exports:

      **`getNotificationPreferences(): Promise<NotificationPreferences>`**
      - Query settings table for SETTINGS_KEY
      - If not found, return DEFAULT_PREFERENCES
      - Parse stored JSON value, merge with defaults for forward-compatibility

      **`updateNotificationPreferences(prefs: Partial<NotificationPreferences>): Promise<void>`**
      - Load current preferences
      - Merge with new values
      - Upsert to settings table (check if exists → update or insert)

      **`showNotification(title: string, body: string): void`**
      - Check if Notification.isSupported() (Electron API)
      - Create new Notification({ title, body, icon: undefined })
      - Call notification.show()
      - Wrap in try-catch (non-fatal)

      **`sendTestNotification(): void`**
      - Call showNotification('Living Dashboard', 'Notifications are working!')

      ### 3c. Create src/main/services/notificationScheduler.ts

      Follow autoBackupScheduler.ts pattern exactly.

      File header:
      ```
      // === FILE PURPOSE ===
      // Background scheduler for notification checks.
      // Periodically checks for due cards and sends daily digest.
      //
      // === DEPENDENCIES ===
      // notificationService, database (cards, meetings)
      //
      // === LIMITATIONS ===
      // - Hourly check granularity (not minute-precise)
      // - Daily digest timing approximate (depends on check interval)
      ```

      Imports:
      ```typescript
      import { eq, and, lte, gte, isNotNull, not } from 'drizzle-orm';
      import { getDb } from '../db/connection';
      import { cards, columns, boards, projects, meetings } from '../db/schema';
      import { getNotificationPreferences, showNotification } from './notificationService';
      ```

      Constants:
      ```typescript
      const CHECK_INTERVAL_MS = 3_600_000;  // 1 hour
      const STARTUP_DELAY_MS = 30_000;       // 30 seconds (after backup scheduler's 10s)
      ```

      Module-level state:
      ```typescript
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let lastDigestDate: string | null = null;  // 'YYYY-MM-DD' of last digest sent
      ```

      Exports:

      **`initNotificationScheduler(): void`**
      - Set timeout for first check (STARTUP_DELAY_MS)
      - Set interval for periodic checks (CHECK_INTERVAL_MS)
      - Log init

      **`stopNotificationScheduler(): void`**
      - Clear interval, reset state, log stop

      **`async checkAndNotify(): Promise<void>`**
      Wrapped in try-catch (never throw from background scheduler):
      1. Load preferences via getNotificationPreferences()
      2. If !preferences.enabled, return early
      3. If preferences.dueDateReminders, check for due cards:
         - Query cards where dueDate is within next 24 hours AND archived = false
         - For each due card not already notified this cycle:
           - Join through columns → boards → projects to get project name
           - showNotification(`Due soon: ${card.title}`, `In project: ${projectName}`)
         - Limit to 5 notifications per check (prevent notification spam)
      4. If preferences.dailyDigest, check if digest is due:
         - Get current date as YYYY-MM-DD string
         - Get current hour
         - If currentHour >= preferences.dailyDigestHour AND lastDigestDate !== today:
           - Build digest: count due today, overdue, recent meetings (last 24h)
           - showNotification('Daily Digest', `${dueCount} tasks due today, ${overdueCount} overdue`)
           - Set lastDigestDate = today

      Note: Use simple date comparisons. Don't need timezone-perfect precision for notifications.
      Due card query:
      ```typescript
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const dueCards = await db
        .select({ title: cards.title, dueDate: cards.dueDate, columnId: cards.columnId })
        .from(cards)
        .where(
          and(
            isNotNull(cards.dueDate),
            lte(cards.dueDate, in24h),
            not(cards.archived),
          )
        )
        .limit(10);
      ```

      ### 3d. Create src/main/ipc/notifications.ts

      ```typescript
      import { ipcMain } from 'electron';
      import {
        getNotificationPreferences,
        updateNotificationPreferences,
        sendTestNotification,
      } from '../services/notificationService';

      export function registerNotificationHandlers(): void {
        ipcMain.handle('notifications:get-preferences', async () => {
          return getNotificationPreferences();
        });

        ipcMain.handle('notifications:update-preferences', async (_event, prefs) => {
          await updateNotificationPreferences(prefs);
        });

        ipcMain.handle('notifications:test', async () => {
          sendTestNotification();
        });
      }
      ```

      ### 3e. Register in src/main/ipc/index.ts

      Add import and call registerNotificationHandlers() in registerIpcHandlers.

      ### 3f. Extend src/preload/preload.ts

      Add to electronAPI:
      ```typescript
      // Notifications
      notificationGetPreferences: () => ipcRenderer.invoke('notifications:get-preferences'),
      notificationUpdatePreferences: (prefs: Partial<NotificationPreferences>) =>
        ipcRenderer.invoke('notifications:update-preferences', prefs),
      notificationSendTest: () => ipcRenderer.invoke('notifications:test'),
      ```

      Note: preload doesn't import types — use the parameter shape inline.
      Actually, preload uses `: (...) =>` style without importing types.
      Check existing preload patterns and follow them.

      ### 3g. Wire scheduler into src/main/main.ts

      Add import:
      ```typescript
      import { initNotificationScheduler, stopNotificationScheduler } from './services/notificationScheduler';
      ```

      In createWindow, after initAutoBackup(mainWindow):
      ```typescript
      initNotificationScheduler();
      ```

      In before-quit handler, after stopAutoBackup():
      ```typescript
      stopNotificationScheduler();
      ```

      ### 3h. Create src/renderer/components/settings/NotificationSection.tsx

      Settings panel for notification preferences. Follow BackupSection pattern.

      ```
      ── Notifications ─────────────────────────────
      ☑ Enable notifications (master toggle)

      ☑ Due date reminders
        Notify when cards are due within 24 hours

      ☑ Daily digest
        Receive a morning summary of tasks and meetings
        Time: [9:00 AM ▼] (hour selector)

      ☑ Recording reminders
        Remind to start recording for upcoming meetings

      [Send Test Notification]
      ─────────────────────────────────────────────
      ```

      State: load preferences on mount, update via electronAPI on toggle change.
      Each toggle is a checkbox or switch.
      The hour selector is a simple select with 0-23 mapped to "12:00 AM", "1:00 AM", etc.
      "Send Test Notification" button calls electronAPI.notificationSendTest().

      Import: Bell (or BellRing) from lucide-react for section icon.

      Styling: Follow BackupSection's layout patterns (section title, description text,
      toggle rows with labels, info text under each toggle).

      ### 3i. Add NotificationSection to SettingsPage

      Import NotificationSection.
      Add it between BackupSection and ExportSection (or after ExportSection, before About).
      Use the same section wrapper pattern.
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. notificationService.ts exports: getNotificationPreferences, updateNotificationPreferences, showNotification, sendTestNotification
      3. notificationScheduler.ts exports: initNotificationScheduler, stopNotificationScheduler
      4. Scheduler follows autoBackupScheduler pattern (interval + startup delay + try-catch)
      5. notifications.ts has 3 IPC handlers registered
      6. preload.ts has 3 notification bridge methods
      7. main.ts calls initNotificationScheduler after DB connect and stopNotificationScheduler on before-quit
      8. NotificationSection.tsx renders: master toggle, 3 feature toggles, hour selector, test button
      9. SettingsPage includes NotificationSection
      10. Notification.isSupported() checked before showing notifications
      11. Daily digest tracks lastDigestDate to avoid duplicate sends
    </verify>
    <done>Desktop notification infrastructure: service (Electron Notification API), scheduler (hourly checks for due cards + daily digest), IPC bridge, and settings UI with toggles and test button. Wired into app startup/shutdown lifecycle.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Electron's Notification API is supported on Windows 11 (it is — verified for Electron apps)
      - settings table key-value pattern works for JSON notification preferences
      - Hourly check interval is sufficient for due date reminders (not time-critical)
      - No notification icon needed (OS default is acceptable)
      - cards.dueDate column exists in schema (confirmed — timestamp with timezone, nullable)
      - drizzle-orm supports isNotNull, lte, and, not operators (standard Drizzle operators)
    </assumptions>
  </task>
</phase>
