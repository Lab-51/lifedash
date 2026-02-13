# Phase 4 — Plan 2 of 4: Audio Capture Pipeline

## Coverage
- **R4: Meeting Intelligence — Audio Capture** (core implementation)

## Plan Overview
Phase 4 delivers Meeting Intelligence: Audio Capture (R4) and Transcription (R5). It requires 4 plans:

- **Plan 4.1** (DONE): Foundation — deps, shared types, meeting service, IPC handlers.
- **Plan 4.2** (this plan): Audio capture pipeline — capture bridge, audio processing in main, recording UI.
- **Plan 4.3**: Whisper transcription — worker thread, chunked transcription, real-time pipeline.
- **Plan 4.4**: Meetings UI — meetings page, transcript display, meeting ↔ project linking.

## Architecture Decisions for Plan 4.2

1. **Audio capture flow** — Renderer enables loopback via IPC → calls `getDisplayMedia()` (patched
   by electron-audio-loopback) → extracts PCM via ScriptProcessorNode → converts Float32 to Int16
   → sends Int16 chunks to main via IPC. Main accumulates chunks and saves WAV.

2. **electron-audio-loopback Manual Mode** — Since we use `contextIsolation: true` and
   `nodeIntegration: false`, we use the "Manual Mode" from the library's README:
   - Preload exposes `enableLoopbackAudio()` / `disableLoopbackAudio()` via contextBridge
   - These invoke auto-registered IPC handlers `enable-loopback-audio` / `disable-loopback-audio`
   - Renderer calls `getDisplayMedia({ video: true, audio: true })` (video required by API)
   - Video tracks are immediately stopped and removed
   - This shows a system picker dialog — acceptable UX for starting a recording session

3. **ScriptProcessorNode for MVP** — Deprecated but simpler than AudioWorklet. No separate
   worker file needed, no CSP issues in Electron. Can migrate to AudioWorklet in v2.

4. **Resampling via AudioContext** — Create `new AudioContext({ sampleRate: 16000 })`.
   The browser automatically resamples the 48kHz system audio to 16kHz. ScriptProcessorNode
   with 1 input channel handles stereo→mono downmix.

5. **IPC audio streaming** — `ipcRenderer.send('audio:chunk', buffer)` one-way (fire-and-forget).
   Int16 at 16kHz mono = ~32KB/s, negligible overhead. Main receives as Buffer.

6. **Recording state push** — Main process sends `recording:state-update` events to renderer
   via `mainWindow.webContents.send()`. Follows the same pattern as `window:maximize-change`.

7. **WAV storage** — Files saved to `{app.getPath('userData')}/recordings/{meetingId}.wav`
   using the `wavefile` package's `fromScratch()` API.

---

<phase n="4.2" name="Audio Capture Pipeline">
  <context>
    Plan 4.1 is complete. The app has meeting CRUD (service + IPC + preload), 3 Phase 4
    packages installed (electron-audio-loopback, @fugood/whisper.node, wavefile), and
    initMain() configured in main.ts.

    Existing meeting infrastructure (from Plan 4.1):
    - meetingService: getMeetings, getMeeting, createMeeting, updateMeeting, deleteMeeting,
      addTranscriptSegment, getTranscripts
    - IPC channels: meetings:list, meetings:get, meetings:create, meetings:update, meetings:delete
    - Preload: getMeetings, getMeeting, createMeeting, updateMeeting, deleteMeeting
    - Types: Meeting, MeetingWithTranscript, TranscriptSegment, RecordingState,
      CreateMeetingInput, UpdateMeetingInput (all in shared/types.ts)
    - ElectronAPI: has 5 meeting CRUD methods active + 4 recording methods COMMENTED OUT

    electron-audio-loopback verified behavior (from README):
    - initMain() auto-registers IPC handlers: 'enable-loopback-audio', 'disable-loopback-audio'
    - Manual Mode (our pattern): preload exposes enable/disable → renderer calls getDisplayMedia
    - getDisplayMedia({ video: true, audio: true }) — video is REQUIRED by the API
    - Must remove video tracks after getting the stream
    - Stream contains system audio loopback track(s)

    wavefile v11.0.0 API:
    - new WaveFile() → wav.fromScratch(channels, sampleRate, bitDepth, samples) → wav.toBuffer()
    - For 16kHz mono Int16: wav.fromScratch(1, 16000, '16', int16Array)

    Key files to reference:
    @src/shared/types.ts
    @src/main/services/meetingService.ts
    @src/main/ipc/index.ts
    @src/main/main.ts
    @src/preload/preload.ts
    @src/renderer/stores/settingsStore.ts (pattern reference for Zustand stores)
    @src/renderer/components/Sidebar.tsx
  </context>

  <task type="auto" n="1">
    <n>Create audio processor service in main + recording IPC handlers + extend preload and types</n>
    <files>
      src/main/services/audioProcessor.ts (create — accumulate PCM, save WAV, manage state)
      src/main/ipc/recording.ts (create — IPC handlers for recording control + audio streaming)
      src/main/ipc/index.ts (modify — register recording handlers)
      src/shared/types.ts (modify — uncomment recording methods, add sendAudioChunk + loopback)
      src/preload/preload.ts (modify — add recording + loopback methods to bridge)
    </files>
    <preconditions>
      - Plan 4.1 complete (meeting CRUD, packages installed)
      - electron-audio-loopback initMain() called in main.ts
      - wavefile v11.0.0 installed
    </preconditions>
    <action>
      Create the main-process audio processing pipeline and wire it through IPC to the renderer.

      WHY: The main process needs to receive raw PCM audio chunks from the renderer, accumulate
      them into a complete recording buffer, and save the result as a WAV file when recording
      stops. It also needs to push recording state updates (elapsed time, isRecording) to the
      renderer. This is the backend for the audio capture pipeline.

      ## Step 1: Update shared/types.ts

      Uncomment the recording methods in the ElectronAPI interface and add new methods.
      Find the commented-out recording methods block and replace with active methods:

      ```typescript
      // Recording
      startRecording: (meetingId: string) => Promise<void>;
      stopRecording: () => Promise<void>;
      sendAudioChunk: (buffer: ArrayBuffer) => void;
      enableLoopbackAudio: () => Promise<void>;
      disableLoopbackAudio: () => Promise<void>;
      onRecordingState: (callback: (state: RecordingState) => void) => () => void;
      onTranscriptSegment: (callback: (segment: TranscriptSegment) => void) => () => void;
      ```

      Note: `sendAudioChunk` returns void (not Promise) — it's a fire-and-forget one-way message.

      ## Step 2: Create audioProcessor.ts

      Create `src/main/services/audioProcessor.ts`:

      ```typescript
      // === FILE PURPOSE ===
      // Audio processing service — accumulates PCM chunks from renderer,
      // saves WAV files, manages recording state, and pushes updates.
      //
      // === DEPENDENCIES ===
      // electron (app, BrowserWindow), wavefile, node:fs, node:path
      //
      // === LIMITATIONS ===
      // - No transcription (Plan 4.3)
      // - No audio level metering
      // - Single recording at a time

      import { app, BrowserWindow } from 'electron';
      import { WaveFile } from 'wavefile';
      import fs from 'node:fs';
      import path from 'node:path';
      import type { RecordingState } from '../../shared/types';

      let chunks: Buffer[] = [];
      let currentMeetingId: string | null = null;
      let startTime = 0;
      let stateTimer: ReturnType<typeof setInterval> | null = null;
      let mainWindow: BrowserWindow | null = null;

      function getRecordingsDir(): string {
        return path.join(app.getPath('userData'), 'recordings');
      }

      export function setMainWindow(win: BrowserWindow): void {
        mainWindow = win;
      }

      export function isRecording(): boolean {
        return currentMeetingId !== null;
      }

      export function startRecording(meetingId: string): void {
        if (currentMeetingId) {
          throw new Error('Already recording. Stop current recording first.');
        }
        currentMeetingId = meetingId;
        chunks = [];
        startTime = Date.now();

        // Push state updates to renderer every second
        stateTimer = setInterval(() => {
          pushState();
        }, 1000);

        // Push initial state immediately
        pushState();
      }

      export function addChunk(chunk: Buffer): void {
        if (!currentMeetingId) return; // Ignore chunks when not recording
        chunks.push(chunk);
      }

      export async function stopRecording(): Promise<string> {
        if (!currentMeetingId) {
          throw new Error('Not currently recording.');
        }

        // Stop timer
        if (stateTimer) {
          clearInterval(stateTimer);
          stateTimer = null;
        }

        const meetingId = currentMeetingId;
        currentMeetingId = null;

        // Combine all chunks into a single buffer
        const combined = Buffer.concat(chunks);
        chunks = []; // Free memory

        // Save WAV file
        const audioPath = await saveWav(meetingId, combined);

        // Push stopped state
        pushState();

        return audioPath;
      }

      async function saveWav(meetingId: string, pcmBuffer: Buffer): Promise<string> {
        const dir = getRecordingsDir();
        fs.mkdirSync(dir, { recursive: true });

        const filePath = path.join(dir, `${meetingId}.wav`);

        // Convert Buffer to Int16Array
        const int16 = new Int16Array(
          pcmBuffer.buffer,
          pcmBuffer.byteOffset,
          pcmBuffer.byteLength / 2,
        );

        // Create WAV: 1 channel (mono), 16kHz, 16-bit PCM
        const wav = new WaveFile();
        wav.fromScratch(1, 16000, '16', int16);

        fs.writeFileSync(filePath, wav.toBuffer());
        console.log(`[Audio] Saved WAV: ${filePath} (${(pcmBuffer.byteLength / 1024).toFixed(0)} KB)`);

        return filePath;
      }

      function pushState(): void {
        if (!mainWindow || mainWindow.isDestroyed()) return;

        const state: RecordingState = {
          isRecording: currentMeetingId !== null,
          meetingId: currentMeetingId,
          elapsed: currentMeetingId ? Math.floor((Date.now() - startTime) / 1000) : 0,
          lastTranscript: '', // Plan 4.3 will populate this
        };

        mainWindow.webContents.send('recording:state-update', state);
      }
      ```

      IMPORTANT: Check if `wavefile` exports `WaveFile` as a named export or default export.
      The npm package typically uses: `import { WaveFile } from 'wavefile';` but verify by
      checking `node_modules/wavefile/index.js` or type declarations. If it's a default export,
      use `import WaveFile from 'wavefile';` instead.

      ## Step 3: Create recording IPC handlers

      Create `src/main/ipc/recording.ts`:

      ```typescript
      // === FILE PURPOSE ===
      // IPC handlers for audio recording control and streaming.
      // Coordinates between audioProcessor (raw audio) and meetingService (DB).

      import { ipcMain, BrowserWindow } from 'electron';
      import * as audioProcessor from '../services/audioProcessor';
      import * as meetingService from '../services/meetingService';

      export function registerRecordingHandlers(mainWindow: BrowserWindow): void {
        // Pass the window reference to audioProcessor for state push events
        audioProcessor.setMainWindow(mainWindow);

        ipcMain.handle('recording:start', async (_event, meetingId: string) => {
          audioProcessor.startRecording(meetingId);
        });

        ipcMain.handle('recording:stop', async () => {
          const audioPath = await audioProcessor.stopRecording();
          // audioPath is returned but the renderer will update the meeting
          // via meetingService.updateMeeting separately if needed
          return audioPath;
        });

        // One-way audio chunk streaming (no response needed)
        ipcMain.on('audio:chunk', (_event, chunk: Buffer) => {
          audioProcessor.addChunk(chunk);
        });
      }
      ```

      Note: `registerRecordingHandlers` takes `mainWindow: BrowserWindow` — same pattern as
      `registerWindowControlHandlers`.

      ## Step 4: Register in IPC index

      In `src/main/ipc/index.ts`:
      - Add import: `import { registerRecordingHandlers } from './recording';`
      - Add call: `registerRecordingHandlers(mainWindow);` (passing mainWindow, same as
        registerWindowControlHandlers)

      ## Step 5: Extend preload bridge

      In `src/preload/preload.ts`, add after the Meetings section:

      ```typescript
      // Recording
      startRecording: (meetingId: string) =>
        ipcRenderer.invoke('recording:start', meetingId),
      stopRecording: () => ipcRenderer.invoke('recording:stop'),
      sendAudioChunk: (buffer: ArrayBuffer) =>
        ipcRenderer.send('audio:chunk', Buffer.from(buffer)),
      enableLoopbackAudio: () => ipcRenderer.invoke('enable-loopback-audio'),
      disableLoopbackAudio: () => ipcRenderer.invoke('disable-loopback-audio'),
      onRecordingState: (callback: (state: any) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, state: any) => {
          callback(state);
        };
        ipcRenderer.on('recording:state-update', handler);
        return () => {
          ipcRenderer.removeListener('recording:state-update', handler);
        };
      },
      onTranscriptSegment: (callback: (segment: any) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, segment: any) => {
          callback(segment);
        };
        ipcRenderer.on('recording:transcript-segment', handler);
        return () => {
          ipcRenderer.removeListener('recording:transcript-segment', handler);
        };
      },
      ```

      Note: `enableLoopbackAudio` and `disableLoopbackAudio` invoke IPC handlers that are
      auto-registered by electron-audio-loopback's `initMain()` — we do NOT need to create
      these handlers ourselves.

      Note: `sendAudioChunk` uses `ipcRenderer.send` (one-way), not `invoke` (request-response).
      The `Buffer.from(buffer)` wraps the ArrayBuffer for IPC transport.

      IMPORTANT: Verify that `Buffer` is available in the preload context. It should be
      (preload has Node.js access), but if not, send the ArrayBuffer directly — Electron
      can serialize it.

      ## Step 6: Update stopRecording return type

      The `stopRecording` IPC handler returns the audioPath string. Update the ElectronAPI
      type if needed: `stopRecording: () => Promise<string>;`

      Wait — the plan's type definition says `Promise<void>`. Let me keep it as `Promise<void>`
      for simplicity since the renderer will update the meeting via meetingService separately.
      If we need the path, we can change it later. The IPC handler can still return it — the
      type just won't expose it.

      Actually, let's return the path. Change the type to:
      `stopRecording: () => Promise<string>;`
      This is useful for the renderer to know where the WAV was saved.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify audioProcessor.ts exports: setMainWindow, isRecording, startRecording, addChunk, stopRecording
      3. Verify recording.ts registers 3 handlers: 'recording:start' (handle), 'recording:stop' (handle), 'audio:chunk' (on)
      4. Verify ipc/index.ts imports and calls registerRecordingHandlers(mainWindow)
      5. Verify preload.ts has: startRecording, stopRecording, sendAudioChunk, enableLoopbackAudio, disableLoopbackAudio, onRecordingState, onTranscriptSegment
      6. Verify ElectronAPI interface has all 7 recording methods (uncommented)
      7. Verify 'enable-loopback-audio' and 'disable-loopback-audio' are NOT manually registered (they're auto-registered by electron-audio-loopback)
    </verify>
    <done>
      Audio processing service in main (accumulate, save WAV). Recording IPC handlers
      (start, stop, chunk). Preload bridge extended with 7 recording methods including
      loopback control. ElectronAPI interface fully typed. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - electron-audio-loopback auto-registers 'enable-loopback-audio' and 'disable-loopback-audio' IPC handlers (confirmed in README)
      - wavefile WaveFile constructor accepts Int16Array in fromScratch (verify import style)
      - Buffer.from(arrayBuffer) works in preload context for IPC transport
      - ipcMain.on (not handle) is correct for one-way audio:chunk streaming
      - app.getPath('userData') returns writable directory on all platforms
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Create audio capture bridge service in renderer</n>
    <files>
      src/renderer/services/audioCaptureService.ts (create — loopback + PCM extraction + IPC streaming)
    </files>
    <preconditions>
      - Task 1 completed (recording IPC and preload methods available)
      - electron-audio-loopback initialized in main process
    </preconditions>
    <action>
      Create the renderer-side audio capture service that handles the entire flow from system
      audio to PCM chunks sent to main.

      WHY: The renderer is the only process with access to Web Audio API (AudioContext,
      MediaStream, ScriptProcessorNode). It captures system audio via the patched getDisplayMedia,
      extracts raw PCM, converts to Int16, and streams chunks to the main process. The renderer
      is intentionally thin — just a bridge between Web Audio and IPC.

      ## Create src/renderer/services/audioCaptureService.ts

      ```typescript
      // === FILE PURPOSE ===
      // Audio capture bridge — thin layer that captures system audio via
      // electron-audio-loopback, extracts PCM via ScriptProcessorNode,
      // and streams Int16 chunks to the main process via IPC.
      //
      // === DEPENDENCIES ===
      // Web Audio API (AudioContext, ScriptProcessorNode), window.electronAPI
      //
      // === LIMITATIONS ===
      // - Uses deprecated ScriptProcessorNode (migrate to AudioWorklet in v2)
      // - Single recording at a time
      // - getDisplayMedia shows system picker dialog (user must select screen)
      // - No audio level metering (future enhancement)

      const SAMPLE_RATE = 16000;     // 16kHz for Whisper
      const BUFFER_SIZE = 4096;      // ScriptProcessorNode buffer size (samples per callback)
      const INPUT_CHANNELS = 1;      // Mono (browser handles stereo→mono downmix)
      const OUTPUT_CHANNELS = 1;     // Mono output

      let audioContext: AudioContext | null = null;
      let mediaStream: MediaStream | null = null;
      let sourceNode: MediaStreamAudioSourceNode | null = null;
      let processorNode: ScriptProcessorNode | null = null;

      /**
       * Convert Float32 audio samples to Int16 PCM.
       * Clamps values to [-1, 1] range before scaling.
       */
      function float32ToInt16(float32: Float32Array): Int16Array {
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16;
      }

      /**
       * Start capturing system audio.
       *
       * Flow:
       * 1. Enable loopback audio (patches getDisplayMedia)
       * 2. Call getDisplayMedia (shows system picker — user selects screen)
       * 3. Remove video tracks (we only need audio)
       * 4. Disable loopback (restore normal getDisplayMedia)
       * 5. Create AudioContext at 16kHz (browser resamples automatically)
       * 6. Connect: MediaStreamSource → ScriptProcessorNode
       * 7. On each audio buffer: convert Float32→Int16, send to main via IPC
       *
       * @throws If user cancels the picker dialog or audio capture fails
       */
      export async function startCapture(): Promise<void> {
        if (audioContext) {
          throw new Error('Already capturing. Call stopCapture() first.');
        }

        // Step 1: Enable loopback (patches getDisplayMedia to include system audio)
        await window.electronAPI.enableLoopbackAudio();

        try {
          // Step 2: Get system audio via patched getDisplayMedia
          // IMPORTANT: video: true is REQUIRED by the API even though we don't want video
          mediaStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });
        } catch (error) {
          // User cancelled the picker dialog or permission denied
          await window.electronAPI.disableLoopbackAudio();
          throw error;
        }

        // Step 3: Remove video tracks (we only need audio)
        mediaStream.getVideoTracks().forEach((track) => {
          track.stop();
          mediaStream!.removeTrack(track);
        });

        // Step 4: Disable loopback (restores normal getDisplayMedia behavior)
        await window.electronAPI.disableLoopbackAudio();

        // Verify we have audio tracks
        const audioTracks = mediaStream.getAudioTracks();
        if (audioTracks.length === 0) {
          cleanup();
          throw new Error('No audio tracks in captured stream.');
        }

        // Step 5: Create AudioContext at 16kHz — browser handles resampling from 48kHz
        audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

        // Step 6: Connect audio pipeline
        sourceNode = audioContext.createMediaStreamSource(mediaStream);
        processorNode = audioContext.createScriptProcessor(
          BUFFER_SIZE,
          INPUT_CHANNELS,
          OUTPUT_CHANNELS,
        );

        // Step 7: Extract PCM and send to main
        processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
          const float32Data = event.inputBuffer.getChannelData(0);
          const int16Data = float32ToInt16(float32Data);
          // Send raw Int16 PCM bytes to main process (one-way, fire-and-forget)
          window.electronAPI.sendAudioChunk(int16Data.buffer);
        };

        sourceNode.connect(processorNode);
        // Connect to destination to keep the processor running
        // (ScriptProcessorNode requires being connected to output)
        processorNode.connect(audioContext.destination);

        console.log('[AudioCapture] Started — 16kHz mono Int16 PCM');
      }

      /**
       * Stop capturing audio and clean up all resources.
       */
      export async function stopCapture(): Promise<void> {
        cleanup();
        console.log('[AudioCapture] Stopped');
      }

      /**
       * Check if currently capturing.
       */
      export function isCapturing(): boolean {
        return audioContext !== null;
      }

      /**
       * Internal cleanup — disconnect nodes, stop tracks, close context.
       */
      function cleanup(): void {
        if (processorNode) {
          processorNode.disconnect();
          processorNode.onaudioprocess = null;
          processorNode = null;
        }
        if (sourceNode) {
          sourceNode.disconnect();
          sourceNode = null;
        }
        if (mediaStream) {
          mediaStream.getTracks().forEach((track) => track.stop());
          mediaStream = null;
        }
        if (audioContext) {
          audioContext.close().catch(() => {});
          audioContext = null;
        }
      }
      ```

      ## Key implementation notes:

      - **AudioContext({ sampleRate: 16000 })**: This tells the browser to run the audio graph
        at 16kHz. The MediaStreamSource input at 48kHz is automatically resampled to 16kHz by
        the browser's audio engine. This means every chunk we get from the ScriptProcessorNode
        is already at 16kHz — no manual resampling needed.

      - **ScriptProcessorNode(4096, 1, 1)**: Buffer of 4096 samples at 16kHz = ~256ms per chunk.
        Each callback fires every 256ms, sending ~8KB of Int16 data (4096 * 2 bytes). This is
        ~32KB/s total, which is negligible IPC overhead.

      - **float32ToInt16**: Clamps to [-1, 1] to prevent distortion, then scales to Int16 range
        (-32768 to +32767). This is the standard conversion formula.

      - **cleanup()**: Comprehensive — disconnects nodes, stops all tracks, closes AudioContext.
        Called on both normal stop and error paths.

      - **Error handling**: If the user cancels the picker dialog, `getDisplayMedia` throws
        (NotAllowedError). We catch this, disable loopback, and re-throw so the caller
        (recording store/UI) can show an appropriate message.

      ## IMPORTANT VERIFICATION:
      - Check that `new AudioContext({ sampleRate: 16000 })` is accepted in Electron 40.x
        (Chromium supports arbitrary sample rates since ~v74). If it throws, fallback:
        create AudioContext without sampleRate option and do manual resampling.
      - Check that `processorNode.connect(audioContext.destination)` doesn't play the audio
        through speakers (it shouldn't — we're connecting to a virtual destination, and the
        ScriptProcessorNode doesn't modify the audio). If audio plays back, create a
        GainNode with gain=0 as the destination instead.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify audioCaptureService.ts exports: startCapture, stopCapture, isCapturing
      3. Verify the service uses window.electronAPI methods (enableLoopbackAudio, disableLoopbackAudio, sendAudioChunk)
      4. Verify cleanup handles all resources (audioContext, mediaStream, sourceNode, processorNode)
      5. Verify float32ToInt16 conversion clamps values correctly
      6. Verify SAMPLE_RATE is 16000 (matches main process's WAV creation)
    </verify>
    <done>
      Audio capture bridge in renderer. Handles full flow: loopback enable → getDisplayMedia
      → PCM extraction at 16kHz mono → Int16 conversion → IPC streaming to main.
      Proper cleanup on stop. TypeScript compiles clean.
    </done>
    <confidence>MEDIUM</confidence>
    <assumptions>
      - AudioContext({ sampleRate: 16000 }) works in Electron 40.x Chromium (should — Chromium 74+)
      - ScriptProcessorNode still works in Electron 40.x (deprecated but not removed)
      - getDisplayMedia({ video: true, audio: true }) with loopback returns system audio track
      - Connecting ScriptProcessorNode to destination doesn't play audio through speakers
      - Float32 channel data from ScriptProcessorNode is in [-1, 1] range (standard)
      - Browser handles 48kHz→16kHz resampling when AudioContext sampleRate is set
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Create recording Zustand store and recording UI components</n>
    <files>
      src/renderer/stores/recordingStore.ts (create — Zustand store for recording state)
      src/renderer/components/RecordingControls.tsx (create — start/stop/timer UI)
      src/renderer/components/RecordingIndicator.tsx (create — sidebar recording badge)
      src/renderer/components/Sidebar.tsx (modify — add RecordingIndicator)
    </files>
    <preconditions>
      - Task 1 completed (preload bridge has recording methods)
      - Task 2 completed (audioCaptureService available)
      - Meeting types available in shared/types.ts
    </preconditions>
    <action>
      Create the recording state management and UI components.

      WHY: Users need a way to start/stop recordings and see recording status. The Zustand
      store coordinates between the audio capture service (renderer) and the recording
      backend (main process). The RecordingIndicator in the sidebar provides always-visible
      status so users know a recording is active regardless of which page they're on.

      ## Step 1: Create recordingStore.ts

      Create `src/renderer/stores/recordingStore.ts`:

      ```typescript
      // === FILE PURPOSE ===
      // Zustand store for recording state management.
      // Coordinates audio capture (renderer) with recording backend (main).

      import { create } from 'zustand';
      import * as audioCaptureService from '../services/audioCaptureService';
      import type { RecordingState } from '../../shared/types';

      interface RecordingStore {
        // State
        isRecording: boolean;
        meetingId: string | null;
        elapsed: number;
        lastTranscript: string;
        error: string | null;
        starting: boolean;   // True while start flow is in progress

        // Actions
        startRecording: (title: string, projectId?: string) => Promise<void>;
        stopRecording: () => Promise<void>;
        initListener: () => () => void;  // Returns cleanup function
      }

      export const useRecordingStore = create<RecordingStore>((set, get) => ({
        isRecording: false,
        meetingId: null,
        elapsed: 0,
        lastTranscript: '',
        error: null,
        starting: false,

        startRecording: async (title: string, projectId?: string) => {
          set({ starting: true, error: null });
          try {
            // Step 1: Create meeting in DB
            const meeting = await window.electronAPI.createMeeting({
              title,
              projectId,
            });

            // Step 2: Tell main process to start recording
            await window.electronAPI.startRecording(meeting.id);

            // Step 3: Start audio capture in renderer
            await audioCaptureService.startCapture();

            set({
              isRecording: true,
              meetingId: meeting.id,
              elapsed: 0,
              starting: false,
            });
          } catch (error) {
            // Clean up if anything failed
            const meetingId = get().meetingId;
            if (meetingId) {
              // If meeting was created but capture failed, delete it
              try {
                await window.electronAPI.stopRecording();
              } catch { /* ignore */ }
              try {
                await window.electronAPI.deleteMeeting(meetingId);
              } catch { /* ignore */ }
            }
            set({
              isRecording: false,
              meetingId: null,
              starting: false,
              error: error instanceof Error ? error.message : 'Failed to start recording',
            });
          }
        },

        stopRecording: async () => {
          try {
            // Step 1: Stop audio capture in renderer
            await audioCaptureService.stopCapture();

            // Step 2: Tell main process to stop recording (saves WAV)
            const audioPath = await window.electronAPI.stopRecording();

            // Step 3: Update meeting with audioPath and completion
            const meetingId = get().meetingId;
            if (meetingId) {
              await window.electronAPI.updateMeeting(meetingId, {
                endedAt: new Date().toISOString(),
                audioPath,
                status: 'completed',  // 'processing' when transcription is added in Plan 4.3
              });
            }

            set({
              isRecording: false,
              meetingId: null,
              elapsed: 0,
              lastTranscript: '',
            });
          } catch (error) {
            set({
              error: error instanceof Error ? error.message : 'Failed to stop recording',
            });
          }
        },

        initListener: () => {
          // Listen for recording state updates from main process
          const cleanup = window.electronAPI.onRecordingState((state: RecordingState) => {
            set({
              isRecording: state.isRecording,
              meetingId: state.meetingId,
              elapsed: state.elapsed,
              lastTranscript: state.lastTranscript,
            });
          });
          return cleanup;
        },
      }));
      ```

      ## Step 2: Create RecordingControls.tsx

      Create `src/renderer/components/RecordingControls.tsx`:

      A floating panel component for starting/stopping recordings. Includes:
      - Meeting title input (required)
      - Optional project selector (dropdown of existing projects)
      - Start/Stop button
      - Elapsed time display (MM:SS format)
      - Error message display

      ```typescript
      // === FILE PURPOSE ===
      // Recording control panel — start/stop recording with meeting title input.

      import { useState, useEffect } from 'react';
      import { Mic, Square, Loader2 } from 'lucide-react';
      import { useRecordingStore } from '../stores/recordingStore';

      function formatElapsed(seconds: number): string {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
      }

      export default function RecordingControls() {
        const {
          isRecording, elapsed, error, starting,
          startRecording, stopRecording, initListener,
        } = useRecordingStore();
        const [title, setTitle] = useState('');

        // Initialize recording state listener
        useEffect(() => {
          const cleanup = initListener();
          return cleanup;
        }, [initListener]);

        const handleStart = async () => {
          if (!title.trim()) return;
          await startRecording(title.trim());
          setTitle(''); // Reset for next recording
        };

        const handleStop = async () => {
          await stopRecording();
        };

        return (
          <div className="bg-surface-800 rounded-xl border border-surface-700 p-4">
            {!isRecording ? (
              // Start recording form
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-surface-200">
                  <Mic size={18} />
                  <span className="text-sm font-medium">New Recording</span>
                </div>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Meeting title..."
                  className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2
                             text-sm text-surface-100 placeholder:text-surface-500
                             focus:outline-none focus:ring-1 focus:ring-primary-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleStart()}
                  disabled={starting}
                />
                <button
                  onClick={handleStart}
                  disabled={!title.trim() || starting}
                  className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500
                             disabled:bg-surface-700 disabled:text-surface-500
                             text-white rounded-lg px-3 py-2 text-sm font-medium
                             transition-colors"
                >
                  {starting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Mic size={16} />
                      Start Recording
                    </>
                  )}
                </button>
              </div>
            ) : (
              // Recording in progress
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-sm font-medium text-red-400">Recording</span>
                  </div>
                  <span className="text-lg font-mono text-surface-200">
                    {formatElapsed(elapsed)}
                  </span>
                </div>
                <button
                  onClick={handleStop}
                  className="w-full flex items-center justify-center gap-2 bg-surface-700
                             hover:bg-surface-600 text-surface-200 rounded-lg px-3 py-2
                             text-sm font-medium transition-colors"
                >
                  <Square size={14} />
                  Stop Recording
                </button>
              </div>
            )}
            {error && (
              <p className="mt-2 text-xs text-red-400">{error}</p>
            )}
          </div>
        );
      }
      ```

      ## Step 3: Create RecordingIndicator.tsx

      Create `src/renderer/components/RecordingIndicator.tsx`:

      A small badge for the sidebar that shows recording status.

      ```typescript
      // === FILE PURPOSE ===
      // Compact recording indicator for sidebar — pulsing dot + elapsed time.

      import { useRecordingStore } from '../stores/recordingStore';

      function formatElapsed(seconds: number): string {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
      }

      export default function RecordingIndicator() {
        const { isRecording, elapsed } = useRecordingStore();

        if (!isRecording) return null;

        return (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-500/20
                          border border-red-500/30">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-mono text-red-400">
              {formatElapsed(elapsed)}
            </span>
          </div>
        );
      }
      ```

      ## Step 4: Add RecordingIndicator to Sidebar

      In `src/renderer/components/Sidebar.tsx`, add the RecordingIndicator above the
      theme toggle button (at the bottom of the sidebar). Import it:

      ```typescript
      import RecordingIndicator from './RecordingIndicator';
      ```

      Place `<RecordingIndicator />` in the bottom section of the sidebar (above the
      theme cycle button), so it's always visible when recording is active.

      Also wire up the `initListener` in the Sidebar or App.tsx — actually, the
      RecordingControls component already calls `initListener()` in its useEffect. The
      store state is shared, so the RecordingIndicator will automatically update.

      IMPORTANT: Make sure `initListener()` is only called once. If RecordingControls
      might unmount (e.g., when navigating away from the meetings page), consider calling
      `initListener()` in App.tsx instead so the listener is always active.

      The best approach: call `initListener()` in App.tsx (or the AppShell component).
      This ensures recording state is always received regardless of which page is active.
      The RecordingControls component just reads from the store.

      ## Step 5: Initialize recording listener in App.tsx

      In `src/renderer/App.tsx`, inside the AppShell component:

      ```typescript
      import { useRecordingStore } from './stores/recordingStore';

      // Inside AppShell:
      useEffect(() => {
        const cleanup = useRecordingStore.getState().initListener();
        return cleanup;
      }, []);
      ```

      This ensures the main→renderer recording state updates are always received.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify recordingStore.ts exports useRecordingStore with: isRecording, meetingId, elapsed, startRecording, stopRecording, initListener
      3. Verify RecordingControls.tsx renders start form (title input + button) when not recording
      4. Verify RecordingControls.tsx renders stop button + elapsed timer when recording
      5. Verify RecordingIndicator.tsx shows pulsing dot + time only when isRecording
      6. Verify Sidebar.tsx imports and renders RecordingIndicator
      7. Verify App.tsx (or AppShell) calls initListener() in useEffect
      8. Verify recording state flows: main pushState → IPC → onRecordingState → store → UI
    </verify>
    <done>
      Recording Zustand store managing full recording lifecycle (create meeting → start
      capture → stream audio → stop → save). RecordingControls component with title input,
      start/stop, and timer. RecordingIndicator in sidebar with pulsing dot. Listener
      initialized at app root for always-on recording state. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Zustand store follows the same pattern as settingsStore.ts (confirmed)
      - Tailwind classes match existing design system (surface-* colors, primary-500)
      - lucide-react icons available (Mic, Square, Loader2 — verify they exist)
      - App.tsx has an AppShell component where useEffect can run (check actual structure)
      - The recording state listener (onRecordingState) works the same as onWindowMaximizeChange
    </assumptions>
  </task>
</phase>
