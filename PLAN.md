# Plan 7.7 — Speaker Diarization & Meeting Analytics

**Requirements:** R13 (Advanced Meeting Features — 8 pts, partial)
**Scope:** Post-recording speaker diarization (Deepgram + AssemblyAI), meeting analytics (speaker stats, talk time, action item tracking), analytics UI
**Approach:** Post-recording diarization on full audio file (not per-segment), analytics computed from transcript + action item data, speaker-labeled transcript display

## Phase 7 Overview

Phase 7 covers R11, R13, R14, R15, R16, R17 (31 pts total, v2 features).
Planned as 8 sequential plans:

| Plan | Requirement | Focus |
|------|-------------|-------|
| 7.1 | R16 (backend) | Card comments, relationships, activity log — schema + services + IPC |
| 7.2 | R16 (UI) | Comments UI, relationships UI, activity log, card templates in CardDetailModal |
| 7.3 | R15 | Database backup/restore (pg_dump), JSON/CSV export, backup UI |
| 7.4 | R11 | AI task structuring — service, IPC, store, project planning modal, card breakdown |
| 7.5 | R13+R17 | Meeting templates, desktop notifications, daily digest |
| 7.6 | R14 | API transcription providers (Deepgram, AssemblyAI), fallback |
| **7.7** | **R13** | **Speaker diarization, meeting analytics, analytics UI** |
| 7.8 | R16 (rest) | Card attachments, due dates UI, reminders |

## Architecture Decisions

1. **Post-recording diarization (not per-segment):** 10-second segments are too short for reliable cross-segment speaker consistency. Both Deepgram and AssemblyAI recommend longer audio for diarization (30+ seconds per speaker). Instead, after a recording completes, the user can trigger "Identify Speakers" which sends the full WAV file to the API. The API returns words with speaker labels, which we map back to existing transcript segments by timestamp. This preserves existing transcript text while adding accurate speaker attribution.

2. **Speaker column on transcripts table:** Add a nullable `speaker` varchar column to the transcripts table. Null means "not diarized" (backward-compatible with all existing data). For Deepgram, speakers are integers (0, 1, 2...) stored as strings. For AssemblyAI, speakers are letters ("A", "B"...) stored as-is. We normalize to "Speaker 1", "Speaker 2" etc. in the service layer for consistent display.

3. **Diarization as full-file transcription + speaker mapping:** Send full WAV to Deepgram (`?diarize=true`) or AssemblyAI (`speaker_labels: true`). The API returns words with speaker labels. For each existing transcript segment, find words that overlap its time range and assign the majority speaker. This avoids re-transcribing (keeps existing text) while adding speaker data.

4. **Analytics as computed values (not stored):** Meeting analytics (duration, word count, speaker breakdown, action item stats) are computed on-demand from transcript segments and action items. No new analytics table needed — these are derived from existing data. This avoids data staleness issues.

5. **Deferred items:** Calendar integration and automatic meeting detection (VAD) are complex features requiring OS-level integrations. These are deferred to ISSUES.md rather than cramming into this plan.

---

<phase n="7.7" name="Speaker Diarization & Meeting Analytics">
  <context>
    Phase 7, Plan 7 of 8. Implements remaining R13 items:
    - Speaker diarization (who said what) — via Deepgram/AssemblyAI post-recording
    - Meeting analytics (talk time, speaker stats, action item tracking)

    Already complete (not in scope):
    - Meeting templates (Plan 7.5)
    - API transcription providers (Plan 7.6)

    Deferred to ISSUES.md:
    - Meeting calendar integration (needs OS-level calendar access)
    - Automatic meeting detection (needs VAD library)

    Current transcription infrastructure:
    - transcripts table: id, meetingId, content, startTime, endTime, createdAt (NO speaker column)
    - meetings table: has audioPath (full WAV file path after recording)
    - deepgramTranscriber.ts: transcribeSegment() for 10-sec PCM, testConnection()
    - assemblyaiTranscriber.ts: transcribeSegment() for 10-sec PCM (with WAV conversion), testConnection()
    - transcriptionService.ts: 10-sec segment pipeline, provider routing (local/deepgram/assemblyai)
    - transcriptionProviderService.ts: getConfig, getDecryptedKey, provider settings
    - meetingService.ts: addTranscriptSegment(meetingId, content, startTime, endTime)
    - MeetingDetailModal.tsx: transcript timeline with MM:SS timestamps, brief + actions sections

    API diarization parameters (verified):
    - Deepgram: `diarize=true` query param → words get `speaker` (integer 0-based) + `speaker_confidence`
    - AssemblyAI: `speaker_labels: true` in request body → `utterances` array with `speaker` (letter "A", "B"), words also get `speaker`

    Key files for context:
    @src/main/db/schema/meetings.ts (add speaker column to transcripts)
    @src/main/services/deepgramTranscriber.ts (add transcribeFileWithDiarization)
    @src/main/services/assemblyaiTranscriber.ts (add transcribeFileWithDiarization)
    @src/main/services/meetingService.ts (add updateSegmentSpeakers)
    @src/main/services/transcriptionProviderService.ts (getConfig, getDecryptedKey)
    @src/shared/types.ts (add speaker to TranscriptSegment, add diarization types, add analytics types)
    @src/main/ipc/index.ts (register new handlers)
    @src/preload/preload.ts (add bridge methods)
    @src/renderer/components/MeetingDetailModal.tsx (speaker labels, analytics, diarize button)
  </context>

  <task type="auto" n="1">
    <n>Schema extension + diarization service + transcriber functions + IPC</n>
    <files>
      src/main/db/schema/meetings.ts (MODIFY — add speaker column to transcripts)
      src/shared/types.ts (MODIFY — add speaker to TranscriptSegment, add DiarizationWord/DiarizationResult types, add ElectronAPI methods)
      src/main/services/deepgramTranscriber.ts (MODIFY — add transcribeFileWithDiarization function)
      src/main/services/assemblyaiTranscriber.ts (MODIFY — add transcribeFileWithDiarization function)
      src/main/services/meetingService.ts (MODIFY — add updateSegmentSpeakers, add speaker to addTranscriptSegment)
      src/main/services/speakerDiarizationService.ts (NEW ~180 lines)
      src/main/ipc/diarization.ts (NEW ~30 lines)
      src/main/ipc/index.ts (MODIFY — register diarization handlers)
      src/preload/preload.ts (MODIFY — add diarization bridge methods)
      drizzle migration (auto-generated for speaker column)
    </files>
    <action>
      ## WHY
      Speaker diarization ("who said what") requires: schema support for speaker labels,
      full-file transcription functions with diarization enabled on both API providers,
      a service to orchestrate the diarization process (send full audio, map speakers to
      existing segments), and IPC plumbing for the renderer to trigger diarization.

      ## WHAT

      ### 1a. Schema — modify src/main/db/schema/meetings.ts

      Add `speaker` column to the transcripts table:
      ```typescript
      speaker: varchar('speaker', { length: 50 }),  // nullable — null means not diarized
      ```
      Place it after `endTime` and before `createdAt`.

      Generate migration: `npx drizzle-kit generate`
      Apply migration: standard Drizzle migrate on app startup (already wired).

      ### 1b. Types — modify src/shared/types.ts

      Add `speaker` field to TranscriptSegment interface:
      ```typescript
      export interface TranscriptSegment {
        id: string;
        meetingId: string;
        content: string;
        startTime: number;
        endTime: number;
        speaker: string | null;  // NEW — null = not diarized
        createdAt: string;
      }
      ```

      Add diarization types (place near transcription types):
      ```typescript
      // === DIARIZATION TYPES ===

      export interface DiarizationWord {
        text: string;
        startMs: number;
        endMs: number;
        speaker: string;  // Normalized: "Speaker 1", "Speaker 2", etc.
      }

      export interface DiarizationResult {
        words: DiarizationWord[];
        speakers: string[];        // Unique speaker labels found
        durationMs: number;        // Total audio duration
      }
      ```

      Add to ElectronAPI interface:
      ```typescript
      // Diarization
      diarizeMeeting: (meetingId: string) => Promise<{ success: boolean; speakers: string[]; error?: string }>;
      ```

      ### 1c. Modify deepgramTranscriber.ts — add transcribeFileWithDiarization

      Add a new export function that sends a full WAV file with diarization:

      ```typescript
      /**
       * Transcribe a full WAV file with speaker diarization using Deepgram.
       * Returns words with speaker labels for post-recording speaker identification.
       * @param wavBuffer Complete WAV file buffer
       */
      export async function transcribeFileWithDiarization(
        wavBuffer: Buffer,
      ): Promise<DiarizationResult> {
        const apiKey = await transcriptionProviderService.getDecryptedKey('deepgram');
        if (!apiKey) throw new Error('Deepgram API key not configured');

        // Add diarize=true to enable speaker identification
        const url = `${DEEPGRAM_API_URL}?model=nova-2&language=en&punctuate=true&diarize=true&encoding=linear16&sample_rate=16000`;

        const response = await net.fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${apiKey}`,
            'Content-Type': 'audio/wav',  // Full WAV file, not raw PCM
          },
          body: new Uint8Array(wavBuffer),
        });

        if (!response.ok) {
          const bodyText = await response.text();
          throw new Error(`Deepgram diarization error ${response.status}: ${bodyText}`);
        }

        const data: any = await response.json();
        const words = data.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];

        // Deepgram speakers are integers (0, 1, 2...) — normalize to "Speaker 1", "Speaker 2"
        const speakerSet = new Set<string>();
        const diarizationWords: DiarizationWord[] = words.map((w: any) => {
          const speaker = `Speaker ${(w.speaker ?? 0) + 1}`;
          speakerSet.add(speaker);
          return {
            text: w.word,
            startMs: Math.round((w.start ?? 0) * 1000),
            endMs: Math.round((w.end ?? 0) * 1000),
            speaker,
          };
        });

        const duration = data.metadata?.duration ?? 0;
        return {
          words: diarizationWords,
          speakers: Array.from(speakerSet).sort(),
          durationMs: Math.round(duration * 1000),
        };
      }
      ```

      Import DiarizationResult and DiarizationWord from shared/types.ts.
      Update the LIMITATIONS header comment to note that diarization IS now implemented.

      ### 1d. Modify assemblyaiTranscriber.ts — add transcribeFileWithDiarization

      ```typescript
      /**
       * Transcribe a full WAV file with speaker diarization using AssemblyAI.
       * Returns words with speaker labels for post-recording speaker identification.
       * @param wavBuffer Complete WAV file buffer (already in WAV format)
       */
      export async function transcribeFileWithDiarization(
        wavBuffer: Buffer,
      ): Promise<DiarizationResult> {
        const apiKey = await transcriptionProviderService.getDecryptedKey('assemblyai');
        if (!apiKey) throw new Error('AssemblyAI API key not configured');

        // Step 1: Upload WAV file
        const uploadResponse = await net.fetch(`${ASSEMBLYAI_API_URL}/upload`, {
          method: 'POST',
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/octet-stream',
          },
          body: new Uint8Array(wavBuffer),
        });

        if (!uploadResponse.ok) {
          const bodyText = await uploadResponse.text();
          throw new Error(`AssemblyAI upload error ${uploadResponse.status}: ${bodyText}`);
        }

        const uploadData: any = await uploadResponse.json();
        const uploadUrl: string = uploadData.upload_url;
        if (!uploadUrl) throw new Error('AssemblyAI upload did not return upload_url');

        // Step 2: Submit transcription with speaker_labels enabled
        const transcriptResponse = await net.fetch(`${ASSEMBLYAI_API_URL}/transcript`, {
          method: 'POST',
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            audio_url: uploadUrl,
            language_code: 'en',
            speaker_labels: true,  // Enable diarization
          }),
        });

        if (!transcriptResponse.ok) {
          const bodyText = await transcriptResponse.text();
          throw new Error(`AssemblyAI transcript error ${transcriptResponse.status}: ${bodyText}`);
        }

        const transcriptData: any = await transcriptResponse.json();
        const transcriptId: string = transcriptData.id;
        if (!transcriptId) throw new Error('AssemblyAI transcript did not return id');

        // Step 3: Poll for result (longer timeout for full files)
        const maxAttempts = 120;  // 2 minutes for full-file diarization
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

          const pollResponse = await net.fetch(
            `${ASSEMBLYAI_API_URL}/transcript/${transcriptId}`,
            { headers: { 'Authorization': apiKey } },
          );

          if (!pollResponse.ok) {
            const bodyText = await pollResponse.text();
            throw new Error(`AssemblyAI poll error ${pollResponse.status}: ${bodyText}`);
          }

          const result: any = await pollResponse.json();

          if (result.status === 'completed') {
            // AssemblyAI speakers are letters ("A", "B"...) — normalize to "Speaker 1", etc.
            const speakerMap = new Map<string, string>();
            let speakerCount = 0;

            const words: DiarizationWord[] = (result.words ?? []).map((w: any) => {
              const rawSpeaker = w.speaker ?? 'A';
              if (!speakerMap.has(rawSpeaker)) {
                speakerCount++;
                speakerMap.set(rawSpeaker, `Speaker ${speakerCount}`);
              }
              return {
                text: w.text,
                startMs: w.start ?? 0,  // AssemblyAI words are already in ms
                endMs: w.end ?? 0,
                speaker: speakerMap.get(rawSpeaker)!,
              };
            });

            return {
              words,
              speakers: Array.from(speakerMap.values()).sort(),
              durationMs: result.audio_duration ? Math.round(result.audio_duration * 1000) : 0,
            };
          }

          if (result.status === 'error') {
            throw new Error(`AssemblyAI diarization error: ${result.error}`);
          }
        }

        throw new Error('AssemblyAI diarization timed out after polling');
      }
      ```

      NOTE: The existing `pcmToWav()` helper is only needed when sending raw PCM segments.
      For diarization, the input is already a WAV file (read from disk via audioPath), so
      no conversion is needed. If the audioPath file happens to be raw PCM, we'd need conversion,
      but audioProcessor.ts saves as WAV format, so this should be safe.

      Update the LIMITATIONS header to note diarization is now implemented.

      ### 1e. Modify meetingService.ts — add updateSegmentSpeakers + speaker support

      Add a new function to batch-update speaker labels on existing transcript segments:

      ```typescript
      /**
       * Update speaker labels for transcript segments of a meeting.
       * @param meetingId The meeting to update
       * @param speakerMap Map of segment ID → speaker label
       */
      export async function updateSegmentSpeakers(
        meetingId: string,
        speakerMap: Map<string, string>,
      ): Promise<void> {
        const db = getDb();
        // Update each segment's speaker label
        for (const [segmentId, speaker] of speakerMap) {
          await db
            .update(transcripts)
            .set({ speaker })
            .where(eq(transcripts.id, segmentId));
        }
      }
      ```

      Also update `toTranscriptSegment()` mapper to include the speaker field:
      ```typescript
      function toTranscriptSegment(row: ...): TranscriptSegment {
        return {
          ...existing fields...,
          speaker: row.speaker ?? null,
        };
      }
      ```

      ### 1f. Create src/main/services/speakerDiarizationService.ts (~180 lines)

      File header:
      ```
      // === FILE PURPOSE ===
      // Orchestrates post-recording speaker diarization. Reads the full WAV file,
      // sends it to the configured API provider with diarization enabled, then maps
      // speaker labels back to existing transcript segments by timestamp overlap.
      //
      // === DEPENDENCIES ===
      // fs (read WAV file), meetingService, deepgramTranscriber, assemblyaiTranscriber,
      // transcriptionProviderService
      //
      // === LIMITATIONS ===
      // - Requires a cloud API provider (Deepgram or AssemblyAI) — local Whisper has no diarization
      // - Requires audioPath to be set on the meeting (WAV file must exist on disk)
      // - Speaker labels are best-effort — short meetings or quick speaker switches may be inaccurate
      ```

      Imports:
      ```typescript
      import fs from 'node:fs';
      import * as meetingService from './meetingService';
      import * as deepgramTranscriber from './deepgramTranscriber';
      import * as assemblyaiTranscriber from './assemblyaiTranscriber';
      import * as transcriptionProviderService from './transcriptionProviderService';
      import type { DiarizationWord, TranscriptSegment } from '../../shared/types';
      ```

      Single export:

      **`async function diarizeMeeting(meetingId: string): Promise<{ success: boolean; speakers: string[]; error?: string }>`**

      Steps:
      1. Load meeting with transcript: `meetingService.getMeeting(meetingId)`
      2. Validate: meeting exists, status === 'completed', audioPath exists and file is readable
      3. Resolve provider: `transcriptionProviderService.getConfig()` — must be 'deepgram' or 'assemblyai' (not 'local')
         - If 'local', check if either API has a key configured and use that instead
         - If no API provider available, return error "Speaker diarization requires a cloud transcription provider (Deepgram or AssemblyAI)"
      4. Read WAV file: `fs.readFileSync(meeting.audioPath)`
      5. Call provider:
         - If deepgram: `deepgramTranscriber.transcribeFileWithDiarization(wavBuffer)`
         - If assemblyai: `assemblyaiTranscriber.transcribeFileWithDiarization(wavBuffer)`
      6. Map speakers to segments:
         - For each existing transcript segment, find all diarization words that overlap its time range
         - A word overlaps a segment if: `word.startMs < segment.endTime && word.endMs > segment.startTime`
         - Count speaker occurrences among overlapping words
         - Assign the majority speaker to the segment
         - Build a Map<segmentId, speakerLabel>
      7. Update DB: `meetingService.updateSegmentSpeakers(meetingId, speakerMap)`
      8. Return `{ success: true, speakers: result.speakers }`

      Error handling:
      - Wrap entire operation in try/catch
      - Return `{ success: false, speakers: [], error: message }` on failure
      - Log errors to console

      ### 1g. Create src/main/ipc/diarization.ts (~30 lines)

      ```typescript
      import { ipcMain } from 'electron';
      import * as speakerDiarizationService from '../services/speakerDiarizationService';

      export function registerDiarizationHandlers(): void {
        ipcMain.handle('meeting:diarize', async (_event, meetingId: string) => {
          return speakerDiarizationService.diarizeMeeting(meetingId);
        });
      }
      ```

      ### 1h. Register in src/main/ipc/index.ts

      Import and call `registerDiarizationHandlers()`.

      ### 1i. Extend src/preload/preload.ts

      Add to electronAPI:
      ```typescript
      // Diarization
      diarizeMeeting: (meetingId: string) => ipcRenderer.invoke('meeting:diarize', meetingId),
      ```

      ### 1j. Generate and apply migration

      Run `npx drizzle-kit generate` to create migration for the new speaker column.
      The migration should be a simple `ALTER TABLE transcripts ADD COLUMN speaker varchar(50);`
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. transcripts table has new `speaker` column (nullable varchar(50))
      3. TranscriptSegment type includes `speaker: string | null`
      4. DiarizationWord and DiarizationResult types exist
      5. deepgramTranscriber exports: transcribeSegment (existing) + transcribeFileWithDiarization (new)
      6. assemblyaiTranscriber exports: transcribeSegment (existing) + transcribeFileWithDiarization (new)
      7. Deepgram diarization uses `diarize=true` query param, Content-Type `audio/wav`
      8. AssemblyAI diarization uses `speaker_labels: true` in request body
      9. Speaker labels normalized to "Speaker 1", "Speaker 2" etc. (consistent across providers)
      10. speakerDiarizationService.diarizeMeeting reads WAV, calls API, maps speakers to segments, updates DB
      11. meetingService.updateSegmentSpeakers batch-updates speaker column
      12. toTranscriptSegment mapper includes speaker field
      13. IPC handler registered for 'meeting:diarize' channel
      14. preload.ts has diarizeMeeting bridge method
      15. Migration generated and applies cleanly
    </verify>
    <done>Schema with speaker column, diarization functions on both API transcribers (Deepgram diarize=true, AssemblyAI speaker_labels=true), speaker diarization service (orchestrator: read WAV → API → map speakers → update DB), IPC + preload wired. Migration applied. TypeScript compiles cleanly.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - audioProcessor.ts saves recordings as WAV format (verified — uses wavefile library)
      - Deepgram accepts WAV files with Content-Type: audio/wav (standard format)
      - AssemblyAI accepts WAV files via /v2/upload (same as existing segment upload path)
      - Deepgram word response includes `speaker` integer field when diarize=true
      - AssemblyAI word response includes `speaker` letter field when speaker_labels=true
      - Meeting audioPath is an absolute filesystem path readable by fs.readFileSync
      - Existing transcript segments have accurate startTime/endTime for timestamp matching
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Meeting analytics service + types + IPC + preload</n>
    <files>
      src/shared/types.ts (MODIFY — add MeetingAnalytics type + ElectronAPI method)
      src/main/services/meetingAnalyticsService.ts (NEW ~120 lines)
      src/main/ipc/diarization.ts (MODIFY — add analytics handler)
      src/preload/preload.ts (MODIFY — add analytics bridge method)
    </files>
    <action>
      ## WHY
      Meeting analytics give users insight into their meetings: who talked the most,
      how long the meeting was, word counts, and action item outcomes. These are computed
      from existing transcript segments and action items — no new data collection needed.

      ## WHAT

      ### 2a. Types — modify src/shared/types.ts

      Add MeetingAnalytics type (place near diarization types):
      ```typescript
      // === MEETING ANALYTICS TYPES ===

      export interface SpeakerStats {
        speaker: string;           // "Speaker 1", "Speaker 2", or "Unknown"
        segmentCount: number;      // Number of transcript segments
        wordCount: number;         // Total words spoken
        talkTimeMs: number;        // Total talk time in milliseconds
        talkTimePercent: number;   // Percentage of total talk time (0-100)
      }

      export interface MeetingAnalytics {
        meetingId: string;
        durationMs: number;              // Total meeting duration (endedAt - startedAt)
        totalSegments: number;           // Number of transcript segments
        totalWords: number;              // Total word count across all segments
        hasDiarization: boolean;         // Whether speaker labels are available
        speakers: SpeakerStats[];        // Per-speaker breakdown (empty if no diarization)
        actionItemCounts: {
          total: number;
          pending: number;
          approved: number;
          dismissed: number;
          converted: number;
        };
        wordsPerMinute: number;          // Average speaking pace
      }
      ```

      Add to ElectronAPI:
      ```typescript
      // Meeting Analytics
      getMeetingAnalytics: (meetingId: string) => Promise<MeetingAnalytics>;
      ```

      ### 2b. Create src/main/services/meetingAnalyticsService.ts (~120 lines)

      File header:
      ```
      // === FILE PURPOSE ===
      // Computes meeting analytics from transcript segments and action items.
      // All values are derived on-demand (not stored) — always fresh.
      //
      // === DEPENDENCIES ===
      // meetingService, drizzle (for action item counts)
      //
      // === LIMITATIONS ===
      // - Speaker breakdown only available if meeting has been diarized
      // - Words per minute is an approximation (based on total words / duration)
      ```

      Imports:
      ```typescript
      import { getDb } from '../db/connection';
      import { meetings, transcripts, actionItems } from '../db/schema';
      import { eq, sql, and } from 'drizzle-orm';
      import type { MeetingAnalytics, SpeakerStats } from '../../shared/types';
      ```

      Single export:

      **`async function calculateAnalytics(meetingId: string): Promise<MeetingAnalytics>`**

      Steps:
      1. Load meeting record (for startedAt, endedAt, duration calculation)
      2. Load all transcript segments for this meeting
      3. Query action item counts by status (single aggregation query)
      4. Calculate derived values:

      Duration:
      ```typescript
      const durationMs = meeting.endedAt
        ? new Date(meeting.endedAt).getTime() - new Date(meeting.startedAt).getTime()
        : 0;
      ```

      Total words:
      ```typescript
      const totalWords = segments.reduce(
        (sum, seg) => sum + seg.content.split(/\s+/).filter(Boolean).length,
        0,
      );
      ```

      Speaker breakdown (if diarized):
      ```typescript
      const hasDiarization = segments.some(s => s.speaker !== null);

      if (hasDiarization) {
        // Group segments by speaker
        const bySpkr = new Map<string, { segments: typeof segments }>();
        for (const seg of segments) {
          const spkr = seg.speaker ?? 'Unknown';
          if (!bySpkr.has(spkr)) bySpkr.set(spkr, { segments: [] });
          bySpkr.get(spkr)!.segments.push(seg);
        }

        // Calculate per-speaker stats
        const totalTalkTime = segments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);

        speakers = Array.from(bySpkr.entries()).map(([speaker, data]) => {
          const talkTimeMs = data.segments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);
          const wordCount = data.segments.reduce(
            (sum, s) => sum + s.content.split(/\s+/).filter(Boolean).length, 0);
          return {
            speaker,
            segmentCount: data.segments.length,
            wordCount,
            talkTimeMs,
            talkTimePercent: totalTalkTime > 0 ? Math.round((talkTimeMs / totalTalkTime) * 100) : 0,
          };
        }).sort((a, b) => b.talkTimeMs - a.talkTimeMs);  // Most talkative first
      }
      ```

      Action item counts:
      ```typescript
      const actionRows = await db
        .select({
          status: actionItems.status,
          count: sql<number>`count(*)::int`,
        })
        .from(actionItems)
        .where(eq(actionItems.meetingId, meetingId))
        .groupBy(actionItems.status);

      const actionItemCounts = {
        total: 0, pending: 0, approved: 0, dismissed: 0, converted: 0,
      };
      for (const row of actionRows) {
        actionItemCounts[row.status as keyof typeof actionItemCounts] = row.count;
        actionItemCounts.total += row.count;
      }
      ```

      Words per minute:
      ```typescript
      const durationMin = durationMs / 60000;
      const wordsPerMinute = durationMin > 0 ? Math.round(totalWords / durationMin) : 0;
      ```

      Return the assembled MeetingAnalytics object.

      ### 2c. Add IPC handler in src/main/ipc/diarization.ts

      Rename file consideration: since this file now handles both diarization and analytics,
      rename the file to `meeting-advanced.ts` or keep as `diarization.ts` and just add the
      analytics handler. Keep as `diarization.ts` for simplicity — analytics is closely related.

      Add:
      ```typescript
      import * as meetingAnalyticsService from '../services/meetingAnalyticsService';

      // Inside registerDiarizationHandlers():
      ipcMain.handle('meeting:analytics', async (_event, meetingId: string) => {
        return meetingAnalyticsService.calculateAnalytics(meetingId);
      });
      ```

      ### 2d. Extend src/preload/preload.ts

      Add:
      ```typescript
      getMeetingAnalytics: (meetingId: string) => ipcRenderer.invoke('meeting:analytics', meetingId),
      ```
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. SpeakerStats type has: speaker, segmentCount, wordCount, talkTimeMs, talkTimePercent
      3. MeetingAnalytics type has: meetingId, durationMs, totalSegments, totalWords, hasDiarization, speakers, actionItemCounts, wordsPerMinute
      4. meetingAnalyticsService.calculateAnalytics returns correct analytics structure
      5. Speaker breakdown only populated when hasDiarization is true (segments have speaker labels)
      6. Action item counts aggregated by status from DB
      7. wordsPerMinute calculated from total words / duration in minutes
      8. IPC handler registered for 'meeting:analytics'
      9. preload.ts has getMeetingAnalytics bridge method
      10. Analytics are computed on-demand (no stored/stale data)
    </verify>
    <done>MeetingAnalytics type with speaker breakdown and action item counts. meetingAnalyticsService computes all values from existing transcript + action item data. IPC + preload wired. TypeScript compiles cleanly.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Transcript segments have accurate startTime/endTime in milliseconds
      - Action items have status field matching one of: pending, approved, dismissed, converted
      - Meeting has startedAt and endedAt timestamps (endedAt null for incomplete meetings)
      - Drizzle sql template supports count(*) with ::int cast for type safety
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Speaker labels in transcript + meeting analytics UI + diarization trigger</n>
    <files>
      src/renderer/stores/meetingStore.ts (MODIFY — add diarization + analytics state/actions)
      src/renderer/components/MeetingAnalyticsSection.tsx (NEW ~200 lines)
      src/renderer/components/MeetingDetailModal.tsx (MODIFY — speaker labels, analytics section, diarize button)
    </files>
    <action>
      ## WHY
      Users need to see speaker labels in the transcript ("Speaker 1: Hello everyone"),
      trigger diarization after recording, and view meeting analytics (duration, speaker
      breakdown, word counts, action item summary). This completes the user-facing R13 features.

      ## WHAT

      ### 3a. Modify meetingStore.ts — add diarization + analytics state

      Add state:
      ```typescript
      diarizing: boolean;
      diarizationError: string | null;
      analytics: MeetingAnalytics | null;
      analyticsLoading: boolean;
      ```

      Add actions:
      ```typescript
      diarizeMeeting: async (meetingId: string) => {
        set({ diarizing: true, diarizationError: null });
        try {
          const result = await window.electronAPI.diarizeMeeting(meetingId);
          if (result.success) {
            // Reload the meeting to get updated segments with speaker labels
            const meeting = await window.electronAPI.getMeeting(meetingId);
            set({ selectedMeeting: meeting, diarizing: false });
          } else {
            set({ diarizing: false, diarizationError: result.error ?? 'Diarization failed' });
          }
        } catch (err) {
          set({ diarizing: false, diarizationError: err instanceof Error ? err.message : 'Diarization failed' });
        }
      },

      loadAnalytics: async (meetingId: string) => {
        set({ analyticsLoading: true });
        try {
          const analytics = await window.electronAPI.getMeetingAnalytics(meetingId);
          set({ analytics, analyticsLoading: false });
        } catch {
          set({ analyticsLoading: false });
        }
      },

      clearAnalytics: () => set({ analytics: null, analyticsLoading: false, diarizing: false, diarizationError: null }),
      ```

      In clearSelectedMeeting (or equivalent clear action), also reset analytics + diarization state.

      ### 3b. Create src/renderer/components/MeetingAnalyticsSection.tsx (~200 lines)

      Read BriefSection.tsx and ActionItemList.tsx first for component patterns.

      Props:
      ```typescript
      interface MeetingAnalyticsSectionProps {
        meetingId: string;
      }
      ```

      Layout:
      ```
      ── Meeting Analytics ──────────────────────────

      Duration: 45m 23s    Segments: 47    Words: 3,421    WPM: 75

      [If hasDiarization:]
      ── Speaker Breakdown ──
      Speaker 1  ████████████████░░░░  62% (2,121 words, 28m 07s)
      Speaker 2  ████████░░░░░░░░░░░░  31% (1,060 words, 14m 03s)
      Speaker 3  ██░░░░░░░░░░░░░░░░░░   7% (240 words, 3m 13s)

      [If !hasDiarization:]
      Speaker data not available. [Identify Speakers] button

      ── Action Items ──
      Total: 5  |  Pending: 2  |  Approved: 1  |  Converted: 2
      ─────────────────────────────────────────────
      ```

      Component:
      - Uses meetingStore.analytics (loaded via loadAnalytics on mount)
      - Shows loading spinner while analyticsLoading
      - Top stats row: duration (formatted as Xh Ym Zs), segments count, total words, WPM
      - Speaker breakdown section (only if hasDiarization):
        - For each speaker: name, horizontal bar (colored), percentage, word count, talk time
        - Bar colors: use a predefined palette (e.g., blue, green, amber, purple, rose)
        - Sorted by talk time (most to least)
      - If no diarization: show message + "Identify Speakers" button
        - Button calls meetingStore.diarizeMeeting(meetingId)
        - Show spinner while diarizing
        - Show error message if diarizationError
        - After success, analytics auto-refresh (loadAnalytics)
      - Action item summary: compact row with colored count badges

      Styling:
      - Follow existing section patterns (BriefSection border/padding style)
      - Use Tailwind for bar charts (div with dynamic width% and bg-color)
      - Lucide icons: BarChart3, Users, Clock, MessageSquare for section headers

      ### 3c. Modify MeetingDetailModal.tsx — speaker labels + analytics integration

      Speaker labels in transcript timeline:
      - Currently, transcript segments display as `MM:SS — content`
      - If segment.speaker is not null, display as `MM:SS — [Speaker 1] content`
      - Color-code speaker labels using the same palette as analytics bars
      - Create a small helper: `getSpeakerColor(speaker: string): string` that maps
        "Speaker 1" → blue, "Speaker 2" → green, etc.

      Integration:
      - Import MeetingAnalyticsSection
      - Add it between the project selector section and the BriefSection
      - On modal open (useEffect with selectedMeeting): call loadAnalytics(meetingId)
      - On modal close (clearSelectedMeeting): also call clearAnalytics()
      - After successful diarization: call loadAnalytics to refresh (the store's
        diarizeMeeting already reloads the meeting, so the transcript will update;
        analytics should also refresh)

      Loading/error states:
      - While diarizing: show spinner on the "Identify Speakers" button
      - diarizationError: show inline red error text below the button
      - Provider hint: if no API provider configured, show "Configure Deepgram or AssemblyAI
        in Settings to enable speaker identification"
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. meetingStore has diarizing, diarizationError, analytics, analyticsLoading state
      3. meetingStore.diarizeMeeting calls IPC, reloads meeting on success
      4. meetingStore.loadAnalytics calls IPC, stores result
      5. MeetingAnalyticsSection shows: duration, segments, words, WPM
      6. MeetingAnalyticsSection shows speaker breakdown bars when hasDiarization is true
      7. MeetingAnalyticsSection shows "Identify Speakers" button when hasDiarization is false
      8. "Identify Speakers" button triggers diarization, shows spinner, handles errors
      9. Transcript segments in MeetingDetailModal show speaker labels with color coding when available
      10. Speaker colors are consistent between transcript labels and analytics bars
      11. Analytics loaded on modal open, cleared on modal close
      12. Provider hint shown when no API key configured
    </verify>
    <done>Speaker-labeled transcript display with color-coded speaker names. MeetingAnalyticsSection with duration/words/WPM stats, speaker breakdown bars, action item counts. "Identify Speakers" button triggers post-recording diarization. Full integration in MeetingDetailModal. TypeScript compiles cleanly.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - meetingStore.selectedMeeting is loaded with segments that include speaker field
      - MeetingDetailModal already has useEffect for loading meeting data on open
      - BriefSection and ActionItemList patterns are suitable for MeetingAnalyticsSection
      - Lucide React has BarChart3, Users, Clock icons (standard lucide-react exports)
      - 6+ speaker colors are sufficient (most meetings have 2-5 speakers)
    </assumptions>
  </task>
</phase>
