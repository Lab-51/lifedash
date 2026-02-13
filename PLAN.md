# Phase 4 — Plan 3 of 4: Whisper Transcription Pipeline

## Coverage
- **R5: Meeting Intelligence — Transcription** (core implementation)

## Plan Overview
Phase 4 delivers Meeting Intelligence: Audio Capture (R4) and Transcription (R5). It requires 4 plans:

- **Plan 4.1** (DONE): Foundation — deps, shared types, meeting service, IPC handlers.
- **Plan 4.2** (DONE): Audio capture pipeline — capture bridge, audio processing in main, recording UI.
- **Plan 4.3** (this plan): Whisper transcription — worker thread, chunked transcription, real-time pipeline.
- **Plan 4.4**: Meetings UI — meetings page, transcript display, meeting ↔ project linking.

## Architecture Decisions for Plan 4.3

1. **Worker thread for transcription** — Whisper is CPU-intensive and would block Electron's
   main process event loop. We use Node.js `worker_threads` to run transcription in a
   separate thread. The worker stays alive for the duration of a recording session (model
   stays loaded in memory). This avoids the 2-5 second model loading penalty per chunk.

2. **Chunk accumulation in main process** — Audio chunks arrive from the renderer at ~256ms
   intervals (4096 Int16 samples per chunk). The transcription service accumulates these into
   ~10-second PCM segments (160,000 samples = 320KB). When a segment is full, it's dispatched
   to the worker for transcription. This produces near-real-time results with 10-12 second
   latency (10s accumulation + 2-5s transcription).

3. **Worker thread bundling** — Electron Forge + Vite requires the worker file to be a
   separate compiled JS file. We add a second build entry in forge.config.ts for the worker.
   The main process references it via `path.join(__dirname, 'transcriptionWorker.js')`.

4. **Model lazy download** — Whisper models are too large to bundle (244MB+ for small.en).
   The model manager downloads from HuggingFace on first use. Downloads go to
   `{userData}/whisper-models/`. Default: `ggml-base.en.bin` (74MB, fast, English-only).

5. **Transcription results flow** — Worker produces segments with timestamps → transcription
   service saves each segment to DB via `meetingService.addTranscriptSegment()` → pushes
   segment to renderer via `recording:transcript-segment` IPC → updates `lastTranscript`
   in recording state for the sidebar indicator.

6. **ArrayBuffer transfer** — When sending PCM data to the worker, we use transferable objects
   (`worker.postMessage(msg, [msg.audioData])`) to avoid copying the 320KB buffer.

## Verified API: @fugood/whisper.node v1.0.16

```typescript
import { initWhisper } from '@fugood/whisper.node';

// Initialize (loads model into memory — takes 2-5s)
const context = await initWhisper({ filePath: '/path/to/ggml-base.en.bin' });

// Transcribe raw PCM buffer (16kHz, 16-bit, mono)
const { promise, stop } = context.transcribeData(arrayBuffer, {
  language: 'en',
  onNewSegments: (result) => {
    // result.segments: Array<{ text: string, t0: number, t1: number }>
  },
});
const result = await promise;
// result: { result: string, segments: [...], isAborted: boolean }

await context.release(); // MUST call to free memory
```

- `transcribeData` accepts ArrayBuffer (16kHz, 16-bit, mono PCM)
- Returns `{ stop: () => Promise<void>, promise: Promise<TranscribeResult> }`
- Segments have `text`, `t0` (ms), `t1` (ms) — relative to chunk start
- `onNewSegments` callback fires as segments are recognized (for progress)
- Context must be released when done

## Audio Math

- Sample rate: 16,000 Hz, mono, Int16 (2 bytes/sample)
- Renderer sends: 4096 samples per chunk ≈ 256ms ≈ 8,192 bytes
- 10-second segment: 16,000 × 10 = 160,000 samples = 320,000 bytes
- Chunks per segment: 160,000 / 4,096 ≈ 39 chunks
- IPC overhead: ~32 KB/s (negligible)

---

<phase n="4.3" name="Whisper Transcription Pipeline">
  <context>
    Plans 4.1 and 4.2 are complete. The app has:
    - audioProcessor.ts: accumulates PCM chunks, saves WAV, pushes RecordingState
    - recording.ts IPC: recording:start, recording:stop, audio:chunk handlers
    - audioCaptureService.ts (renderer): loopback → getDisplayMedia → ScriptProcessorNode → Int16 → IPC
    - recordingStore.ts: Zustand store with startRecording/stopRecording/initListener
    - meetingService.ts: CRUD + addTranscriptSegment() + getTranscripts()
    - preload.ts: onTranscriptSegment() callback already wired (from Plan 4.2)
    - shared/types.ts: TranscriptSegment { id, meetingId, content, startTime, endTime, createdAt }
    - RecordingState { isRecording, meetingId, elapsed, lastTranscript }

    @fugood/whisper.node v1.0.16 installed (Plan 4.1), API verified:
    - initWhisper({ filePath }) → WhisperContext
    - context.transcribeData(arrayBuffer, options) → { promise, stop }
    - TranscribeResult: { result, segments: Array<{ text, t0, t1 }>, isAborted }
    - context.release() — MUST call to free resources

    Electron Forge config: forge.config.ts with VitePlugin.
    Worker files need separate build entry: { entry: '...worker.ts', config: 'vite.main.config.ts' }

    Key files to reference:
    @src/main/services/audioProcessor.ts
    @src/main/services/meetingService.ts
    @src/main/ipc/recording.ts
    @src/main/ipc/index.ts
    @src/shared/types.ts
    @src/preload/preload.ts
    @forge.config.ts
  </context>

  <task type="auto" n="1">
    <n>Create whisper model manager and transcription worker thread</n>
    <files>
      src/main/services/whisperModelManager.ts (create — model download, path resolution, availability check)
      src/main/workers/transcriptionWorker.ts (create — worker thread that loads whisper and transcribes PCM)
      forge.config.ts (modify — add worker as second main-process build entry)
    </files>
    <preconditions>
      - Plan 4.2 complete (audioProcessor, recording IPC)
      - @fugood/whisper.node v1.0.16 installed
    </preconditions>
    <action>
      Create the model management service and the transcription worker thread.

      WHY: Whisper models aren't bundled (74-244MB). We need a model manager to download them
      on first use. The worker thread is needed because Whisper is CPU-intensive — running it
      on the main thread would freeze the Electron UI. The worker stays alive for a recording
      session to avoid reloading the model for each chunk.

      ## Step 1: Create whisperModelManager.ts

      Create `src/main/services/whisperModelManager.ts`:

      ```typescript
      // === FILE PURPOSE ===
      // Whisper model management — download, locate, and check availability of GGML models.
      //
      // === DEPENDENCIES ===
      // electron (app, BrowserWindow), node:fs, node:path, node:https
      //
      // === LIMITATIONS ===
      // - Downloads from HuggingFace only (no mirror support yet)
      // - No checksum verification (future enhancement)
      // - Single download at a time

      import { app, BrowserWindow } from 'electron';
      import fs from 'node:fs';
      import path from 'node:path';
      import https from 'node:https';

      const HF_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

      export interface WhisperModelInfo {
        name: string;         // e.g., 'base.en'
        fileName: string;     // e.g., 'ggml-base.en.bin'
        size: string;         // Human-readable size
        description: string;
      }

      /** Available models for download */
      export const AVAILABLE_MODELS: WhisperModelInfo[] = [
        { name: 'tiny.en', fileName: 'ggml-tiny.en.bin', size: '39 MB', description: 'Fastest, English-only' },
        { name: 'base.en', fileName: 'ggml-base.en.bin', size: '74 MB', description: 'Fast, English-only (default)' },
        { name: 'small.en', fileName: 'ggml-small.en.bin', size: '244 MB', description: 'Balanced, English-only' },
        { name: 'tiny', fileName: 'ggml-tiny.bin', size: '39 MB', description: 'Fastest, multilingual' },
        { name: 'base', fileName: 'ggml-base.bin', size: '74 MB', description: 'Fast, multilingual' },
        { name: 'small', fileName: 'ggml-small.bin', size: '244 MB', description: 'Balanced, multilingual' },
      ];

      export function getModelsDir(): string {
        return path.join(app.getPath('userData'), 'whisper-models');
      }

      export function getModelPath(fileName: string): string {
        return path.join(getModelsDir(), fileName);
      }

      export function isModelAvailable(fileName: string): boolean {
        return fs.existsSync(getModelPath(fileName));
      }

      /** Get list of locally available models */
      export function getLocalModels(): WhisperModelInfo[] {
        return AVAILABLE_MODELS.filter((m) => isModelAvailable(m.fileName));
      }

      /** Get the default model. Returns path if available, null if needs download. */
      export function getDefaultModelPath(): string | null {
        // Prefer base.en → tiny.en → any available model
        const preferred = ['ggml-base.en.bin', 'ggml-tiny.en.bin'];
        for (const fileName of preferred) {
          if (isModelAvailable(fileName)) return getModelPath(fileName);
        }
        const local = getLocalModels();
        if (local.length > 0) return getModelPath(local[0].fileName);
        return null;
      }

      /** Download a model from HuggingFace with progress callback */
      export function downloadModel(
        fileName: string,
        onProgress?: (downloaded: number, total: number) => void,
      ): { promise: Promise<string>; abort: () => void } {
        const url = `${HF_BASE_URL}/${fileName}`;
        const destPath = getModelPath(fileName);
        let aborted = false;
        let req: ReturnType<typeof https.get> | null = null;

        const promise = new Promise<string>((resolve, reject) => {
          fs.mkdirSync(getModelsDir(), { recursive: true });
          const tempPath = `${destPath}.downloading`;

          const file = fs.createWriteStream(tempPath);
          const makeRequest = (requestUrl: string) => {
            req = https.get(requestUrl, (response) => {
              // Handle redirects (HuggingFace uses 302)
              if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                  makeRequest(redirectUrl);
                  return;
                }
              }

              if (response.statusCode !== 200) {
                file.close();
                fs.unlinkSync(tempPath);
                reject(new Error(`Download failed: HTTP ${response.statusCode}`));
                return;
              }

              const total = parseInt(response.headers['content-length'] || '0', 10);
              let downloaded = 0;

              response.on('data', (chunk: Buffer) => {
                if (aborted) return;
                downloaded += chunk.length;
                onProgress?.(downloaded, total);
              });

              response.pipe(file);

              file.on('finish', () => {
                file.close(() => {
                  if (aborted) {
                    fs.unlinkSync(tempPath);
                    reject(new Error('Download aborted'));
                    return;
                  }
                  // Rename temp → final (atomic on same filesystem)
                  fs.renameSync(tempPath, destPath);
                  resolve(destPath);
                });
              });
            });

            req.on('error', (err) => {
              file.close();
              if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
              reject(err);
            });
          };

          makeRequest(url);
        });

        const abort = () => {
          aborted = true;
          req?.destroy();
        };

        return { promise, abort };
      }
      ```

      ## Step 2: Create transcriptionWorker.ts

      Create `src/main/workers/transcriptionWorker.ts`:

      ```typescript
      // === FILE PURPOSE ===
      // Worker thread for Whisper transcription. Runs in a separate thread
      // to avoid blocking Electron's main process event loop.
      //
      // Protocol:
      //   Main → Worker: { type: 'init', modelPath: string }
      //   Main → Worker: { type: 'transcribe', audioData: ArrayBuffer, segmentIndex: number, startTimeMs: number }
      //   Main → Worker: { type: 'stop' }
      //   Worker → Main: { type: 'ready' }
      //   Worker → Main: { type: 'result', text: string, segments: Array<{text,t0,t1}>, segmentIndex: number, startTimeMs: number }
      //   Worker → Main: { type: 'error', message: string }
      //
      // === DEPENDENCIES ===
      // @fugood/whisper.node (initWhisper)
      //
      // === LIMITATIONS ===
      // - Sequential transcription only (one segment at a time)
      // - Must init before transcribe

      import { parentPort } from 'worker_threads';
      import { initWhisper } from '@fugood/whisper.node';

      // Types for the WhisperContext returned by initWhisper
      // (using the actual return type from the library)
      type WhisperContext = Awaited<ReturnType<typeof initWhisper>>;

      let context: WhisperContext | null = null;

      parentPort?.on('message', async (msg: any) => {
        try {
          switch (msg.type) {
            case 'init': {
              if (context) {
                await context.release();
              }
              context = await initWhisper({ filePath: msg.modelPath });
              parentPort?.postMessage({ type: 'ready' });
              break;
            }

            case 'transcribe': {
              if (!context) {
                parentPort?.postMessage({
                  type: 'error',
                  message: 'Worker not initialized. Send init message first.',
                });
                return;
              }

              const { promise } = context.transcribeData(msg.audioData, {
                language: 'en',
              });

              const result = await promise;

              parentPort?.postMessage({
                type: 'result',
                text: result.result,
                segments: result.segments,
                segmentIndex: msg.segmentIndex,
                startTimeMs: msg.startTimeMs,
              });
              break;
            }

            case 'stop': {
              if (context) {
                await context.release();
                context = null;
              }
              parentPort?.postMessage({ type: 'stopped' });
              break;
            }
          }
        } catch (error) {
          parentPort?.postMessage({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
      ```

      ## Step 3: Add worker as build entry in forge.config.ts

      In `forge.config.ts`, add the worker as a second build entry alongside main.ts:

      ```typescript
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/main/workers/transcriptionWorker.ts',
          config: 'vite.main.config.ts',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      ```

      IMPORTANT: The worker entry does NOT have a `target` property — it's just an additional
      build that produces a JS file in the same output directory as main.js. This way,
      `path.join(__dirname, 'transcriptionWorker.js')` from the main process resolves correctly.

      VERIFY: After making this change, check that `npm run build` (or `npx electron-forge build`)
      produces both `main.js` and `transcriptionWorker.js` in the `.vite/build/` directory.
      If the plugin doesn't support entries without a target, we may need an alternative approach
      (see assumptions below).

      IMPORTANT: Check the `@fugood/whisper.node` native addon. Since it's a native Node.js addon
      (.node file), it may need to be externalized from the Vite bundle. In `vite.main.config.ts`,
      add:
      ```typescript
      export default defineConfig({
        build: {
          rollupOptions: {
            external: ['@fugood/whisper.node'],
          },
        },
      });
      ```
      This tells Vite not to bundle the native addon — it will be resolved at runtime from
      node_modules. Also check if `wavefile` or other packages need the same treatment. If the
      current build works without externals for wavefile, it's fine — wavefile is pure JS.

      Actually, check the current vite.main.config.ts first. If it already has externals configured
      by the Forge plugin, we may just need to add to the list. If not, configure it.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify whisperModelManager.ts exports: getModelsDir, getModelPath, isModelAvailable, getLocalModels, getDefaultModelPath, downloadModel, AVAILABLE_MODELS
      3. Verify transcriptionWorker.ts handles 3 message types: init, transcribe, stop
      4. Verify forge.config.ts has 3 build entries (main, worker, preload)
      5. Run `npx electron-forge build` or check that `npm run make` doesn't break (if too slow, at minimum verify the forge config is valid JSON/TS)
      6. Verify vite.main.config.ts externalizes @fugood/whisper.node (native addon)
    </verify>
    <done>
      Whisper model manager can download models from HuggingFace with progress tracking.
      Transcription worker thread handles init (load model) → transcribe (PCM → text) → stop
      (release). Forge config updated to build worker as separate JS file. Native addon
      externalized in Vite config. TypeScript compiles clean.
    </done>
    <confidence>MEDIUM</confidence>
    <assumptions>
      - Electron Forge VitePlugin supports build entries without `target` property (need to verify)
      - @fugood/whisper.node works inside a worker_threads Worker (native addons generally do)
      - HuggingFace model URLs follow pattern: /ggerganov/whisper.cpp/resolve/main/{fileName}
      - initWhisper can be called inside a worker thread (not just main thread)
      - path.join(__dirname, 'transcriptionWorker.js') resolves correctly in the Vite build output
      - @fugood/whisper.node needs to be externalized from Vite bundle (native .node addon)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Create transcription service and integrate with audio pipeline</n>
    <files>
      src/main/services/transcriptionService.ts (create — chunk accumulation, worker dispatch, result handling)
      src/main/services/audioProcessor.ts (modify — forward chunks to transcription, update lastTranscript)
      src/main/ipc/recording.ts (modify — initialize transcription, push transcript segments to renderer)
    </files>
    <preconditions>
      - Task 1 completed (whisperModelManager + transcriptionWorker + forge config)
      - meetingService.addTranscriptSegment() exists (Plan 4.1)
      - audioProcessor.addChunk() receives PCM from renderer (Plan 4.2)
    </preconditions>
    <action>
      Create the transcription service that orchestrates the chunked transcription pipeline,
      and integrate it with the existing audio processor and recording IPC.

      WHY: The audio processor currently only accumulates chunks for WAV saving. We need to also
      feed those chunks into the transcription pipeline for near-real-time transcription. The
      transcription service is the "brain" that accumulates 10-second segments, dispatches them
      to the worker, saves results to DB, and pushes them to the renderer.

      ## Step 1: Create transcriptionService.ts

      Create `src/main/services/transcriptionService.ts`:

      ```typescript
      // === FILE PURPOSE ===
      // Transcription service — accumulates PCM chunks into 10-second segments,
      // dispatches them to the whisper worker thread, saves results to DB,
      // and pushes segments to the renderer.
      //
      // === DEPENDENCIES ===
      // worker_threads (Worker), whisperModelManager, meetingService, electron (BrowserWindow)
      //
      // === LIMITATIONS ===
      // - Sequential transcription (one segment at a time in the worker)
      // - Fixed 10-second segments (no VAD-based splitting)
      // - English-only for v1 (language is hardcoded in worker)

      import { Worker } from 'worker_threads';
      import { BrowserWindow } from 'electron';
      import path from 'node:path';
      import * as meetingService from './meetingService';
      import * as whisperModelManager from './whisperModelManager';

      const SAMPLE_RATE = 16000;
      const SEGMENT_DURATION_SEC = 10;
      const SAMPLES_PER_SEGMENT = SAMPLE_RATE * SEGMENT_DURATION_SEC; // 160,000
      const BYTES_PER_SEGMENT = SAMPLES_PER_SEGMENT * 2; // 320,000 (Int16 = 2 bytes)

      let worker: Worker | null = null;
      let mainWindow: BrowserWindow | null = null;
      let currentMeetingId: string | null = null;
      let accumulatorBuffer: Buffer = Buffer.alloc(0);
      let segmentIndex = 0;
      let lastTranscriptText = '';
      let pendingSegments: Buffer[] = []; // Queue of segments waiting to be transcribed
      let transcribing = false;

      export function setMainWindow(win: BrowserWindow): void {
        mainWindow = win;
      }

      export function getLastTranscript(): string {
        return lastTranscriptText;
      }

      /**
       * Start the transcription pipeline for a recording session.
       * Spawns a worker, loads the whisper model, and prepares for chunk ingestion.
       */
      export async function start(meetingId: string): Promise<void> {
        const modelPath = whisperModelManager.getDefaultModelPath();
        if (!modelPath) {
          console.log('[Transcription] No whisper model available. Skipping transcription.');
          return;
        }

        currentMeetingId = meetingId;
        accumulatorBuffer = Buffer.alloc(0);
        segmentIndex = 0;
        lastTranscriptText = '';
        pendingSegments = [];
        transcribing = false;

        // Spawn worker
        const workerPath = path.join(__dirname, 'transcriptionWorker.js');
        worker = new Worker(workerPath);

        // Handle messages from worker
        worker.on('message', handleWorkerMessage);
        worker.on('error', (err) => {
          console.error('[Transcription] Worker error:', err);
        });

        // Initialize whisper in the worker
        await new Promise<void>((resolve, reject) => {
          const onMessage = (msg: any) => {
            if (msg.type === 'ready') {
              worker?.off('message', onMessage);
              resolve();
            } else if (msg.type === 'error') {
              worker?.off('message', onMessage);
              reject(new Error(msg.message));
            }
          };
          worker!.on('message', onMessage);
          worker!.postMessage({ type: 'init', modelPath });
        });

        // Re-attach the main message handler (was temporarily replaced during init)
        worker.on('message', handleWorkerMessage);
        console.log(`[Transcription] Started with model: ${path.basename(modelPath)}`);
      }

      /**
       * Feed a PCM chunk into the transcription pipeline.
       * Accumulates chunks and dispatches 10-second segments to the worker.
       */
      export function addChunk(chunk: Buffer): void {
        if (!worker || !currentMeetingId) return;

        accumulatorBuffer = Buffer.concat([accumulatorBuffer, chunk]);

        // When we have enough for a full segment, queue it
        while (accumulatorBuffer.byteLength >= BYTES_PER_SEGMENT) {
          const segment = accumulatorBuffer.subarray(0, BYTES_PER_SEGMENT);
          pendingSegments.push(Buffer.from(segment)); // Copy to avoid reference issues
          accumulatorBuffer = accumulatorBuffer.subarray(BYTES_PER_SEGMENT);
          dispatchNext();
        }
      }

      /**
       * Stop the transcription pipeline. Transcribes any remaining audio, then terminates.
       */
      export async function stop(): Promise<void> {
        if (!worker) return;

        // Transcribe remaining accumulated audio (partial segment)
        if (accumulatorBuffer.byteLength > 0 && currentMeetingId) {
          pendingSegments.push(Buffer.from(accumulatorBuffer));
          accumulatorBuffer = Buffer.alloc(0);
          dispatchNext();
        }

        // Wait for pending transcriptions to finish
        await waitForPending();

        // Terminate worker
        worker.postMessage({ type: 'stop' });
        await worker.terminate();
        worker = null;
        currentMeetingId = null;
        console.log('[Transcription] Stopped');
      }

      /** Dispatch the next pending segment to the worker if not already transcribing */
      function dispatchNext(): void {
        if (transcribing || pendingSegments.length === 0 || !worker) return;

        transcribing = true;
        const segment = pendingSegments.shift()!;
        const startTimeMs = segmentIndex * SEGMENT_DURATION_SEC * 1000;

        // Convert Buffer to ArrayBuffer for transfer
        const arrayBuffer = segment.buffer.slice(
          segment.byteOffset,
          segment.byteOffset + segment.byteLength,
        );

        worker.postMessage(
          {
            type: 'transcribe',
            audioData: arrayBuffer,
            segmentIndex,
            startTimeMs,
          },
          [arrayBuffer], // Transfer ownership (zero-copy)
        );
        segmentIndex++;
      }

      /** Handle messages from the transcription worker */
      async function handleWorkerMessage(msg: any): Promise<void> {
        if (msg.type === 'result') {
          transcribing = false;

          if (msg.text && msg.text.trim() && currentMeetingId) {
            const text = msg.text.trim();
            lastTranscriptText = text;

            // Save each segment to the database
            for (const seg of msg.segments) {
              if (!seg.text.trim()) continue;
              const segStartMs = msg.startTimeMs + seg.t0;
              const segEndMs = msg.startTimeMs + seg.t1;

              try {
                const saved = await meetingService.addTranscriptSegment(
                  currentMeetingId,
                  seg.text.trim(),
                  segStartMs,
                  segEndMs,
                );

                // Push segment to renderer
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('recording:transcript-segment', saved);
                }
              } catch (err) {
                console.error('[Transcription] Failed to save segment:', err);
              }
            }
          }

          // Process next pending segment
          dispatchNext();
        } else if (msg.type === 'error') {
          console.error('[Transcription] Worker error:', msg.message);
          transcribing = false;
          dispatchNext(); // Try next segment
        }
      }

      /** Wait for all pending transcriptions to complete */
      function waitForPending(): Promise<void> {
        return new Promise((resolve) => {
          const check = () => {
            if (!transcribing && pendingSegments.length === 0) {
              resolve();
            } else {
              setTimeout(check, 200);
            }
          };
          check();
        });
      }
      ```

      ## Step 2: Modify audioProcessor.ts

      In `src/main/services/audioProcessor.ts`:

      1. Import the transcription service:
         ```typescript
         import * as transcriptionService from './transcriptionService';
         ```

      2. In `setMainWindow()`, also set the window on transcription service:
         ```typescript
         export function setMainWindow(win: BrowserWindow): void {
           mainWindow = win;
           transcriptionService.setMainWindow(win);
         }
         ```

      3. In `startRecording()`, after resetting state, start transcription:
         ```typescript
         // After: pushState();
         // Start transcription pipeline (non-blocking, may skip if no model)
         transcriptionService.start(meetingId).catch((err) => {
           console.error('[Audio] Transcription start failed:', err);
         });
         ```

      4. In `addChunk()`, also forward to transcription service:
         ```typescript
         export function addChunk(chunk: Buffer): void {
           if (!currentMeetingId) return;
           chunks.push(chunk);
           transcriptionService.addChunk(chunk);
         }
         ```

      5. In `stopRecording()`, stop transcription before concatenating chunks:
         ```typescript
         // After clearing the stateTimer, before concatenating chunks:
         await transcriptionService.stop();
         ```

      6. In `pushState()`, update lastTranscript from transcription service:
         ```typescript
         lastTranscript: transcriptionService.getLastTranscript(),
         ```

      ## Step 3: Modify recording.ts IPC

      The recording IPC handlers don't need structural changes — the transcription integration
      happens inside audioProcessor → transcriptionService. But verify that transcript segments
      are being pushed via `recording:transcript-segment` (which is already handled by
      transcriptionService directly using the mainWindow reference).

      No changes needed to recording.ts — the transcription service handles its own IPC push.
      But verify the flow works end-to-end.
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify transcriptionService.ts exports: setMainWindow, getLastTranscript, start, addChunk, stop
      3. Verify audioProcessor.ts imports and calls transcriptionService methods:
         - setMainWindow passes window to transcriptionService
         - startRecording calls transcriptionService.start()
         - addChunk forwards to transcriptionService.addChunk()
         - stopRecording calls transcriptionService.stop()
         - pushState uses transcriptionService.getLastTranscript()
      4. Verify transcription service accumulates chunks into ~10-second segments (BYTES_PER_SEGMENT = 320000)
      5. Verify results flow: worker result → meetingService.addTranscriptSegment() → mainWindow.webContents.send('recording:transcript-segment', saved)
      6. Verify worker uses transferable objects for ArrayBuffer (zero-copy)
    </verify>
    <done>
      Transcription service orchestrates full pipeline: accumulate PCM → 10s segments →
      worker dispatch → save to DB → push to renderer. Audio processor forwards chunks
      to transcription service. LastTranscript updates in recording state. TypeScript
      compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - transcriptionService.start() is non-blocking (awaited in background, recording continues even if model unavailable)
      - Worker path resolves correctly: path.join(__dirname, 'transcriptionWorker.js')
      - meetingService.addTranscriptSegment() works during active recording (DB writes don't block)
      - Buffer.concat for accumulation is efficient enough at these sizes (320KB segments)
      - Transferable ArrayBuffer works with worker_threads postMessage
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Add whisper model management types, IPC handlers, and preload bridge</n>
    <files>
      src/shared/types.ts (modify — add WhisperModel types + model management methods to ElectronAPI)
      src/main/ipc/whisper.ts (create — IPC handlers for model management)
      src/main/ipc/index.ts (modify — register whisper handlers)
      src/preload/preload.ts (modify — add model management bridge methods)
    </files>
    <preconditions>
      - Task 1 completed (whisperModelManager exists)
      - Task 2 completed (transcription pipeline works)
    </preconditions>
    <action>
      Add the IPC layer for whisper model management so the renderer can check model
      availability, trigger downloads, and track download progress.

      WHY: The renderer needs to know if a whisper model is available before starting a
      recording with transcription. If no model is installed, it should show a download
      prompt. The model download progress needs to be pushed to the renderer for UI feedback.

      ## Step 1: Update shared/types.ts

      Add whisper model types after the existing meeting types section:

      ```typescript
      // === WHISPER MODEL TYPES ===

      export interface WhisperModel {
        name: string;           // e.g., 'base.en'
        fileName: string;       // e.g., 'ggml-base.en.bin'
        size: string;           // Human-readable: '74 MB'
        description: string;
        available: boolean;     // true if downloaded locally
      }

      export interface WhisperDownloadProgress {
        fileName: string;
        downloaded: number;     // bytes
        total: number;          // bytes
        percent: number;        // 0-100
      }
      ```

      Add to the ElectronAPI interface (after the meeting recording methods):

      ```typescript
      // Whisper Models
      getWhisperModels: () => Promise<WhisperModel[]>;
      downloadWhisperModel: (fileName: string) => Promise<string>;
      hasWhisperModel: () => Promise<boolean>;
      onWhisperDownloadProgress: (callback: (progress: WhisperDownloadProgress) => void) => () => void;
      ```

      ## Step 2: Create whisper.ts IPC handlers

      Create `src/main/ipc/whisper.ts`:

      ```typescript
      // === FILE PURPOSE ===
      // IPC handlers for whisper model management — list, download, check availability.

      import { ipcMain, BrowserWindow } from 'electron';
      import * as whisperModelManager from '../services/whisperModelManager';

      export function registerWhisperHandlers(mainWindow: BrowserWindow): void {
        ipcMain.handle('whisper:list-models', async () => {
          return whisperModelManager.AVAILABLE_MODELS.map((m) => ({
            ...m,
            available: whisperModelManager.isModelAvailable(m.fileName),
          }));
        });

        ipcMain.handle('whisper:download-model', async (_event, fileName: string) => {
          const { promise } = whisperModelManager.downloadModel(fileName, (downloaded, total) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('whisper:download-progress', {
                fileName,
                downloaded,
                total,
                percent: total > 0 ? Math.round((downloaded / total) * 100) : 0,
              });
            }
          });
          return promise;
        });

        ipcMain.handle('whisper:has-model', async () => {
          return whisperModelManager.getDefaultModelPath() !== null;
        });
      }
      ```

      ## Step 3: Register in ipc/index.ts

      Add import: `import { registerWhisperHandlers } from './whisper';`
      Add call: `registerWhisperHandlers(mainWindow);` inside registerIpcHandlers().

      ## Step 4: Extend preload bridge

      In `src/preload/preload.ts`, add after the Recording section:

      ```typescript
      // Whisper Models
      getWhisperModels: () => ipcRenderer.invoke('whisper:list-models'),
      downloadWhisperModel: (fileName: string) =>
        ipcRenderer.invoke('whisper:download-model', fileName),
      hasWhisperModel: () => ipcRenderer.invoke('whisper:has-model'),
      onWhisperDownloadProgress: (callback: (progress: any) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, progress: any) => {
          callback(progress);
        };
        ipcRenderer.on('whisper:download-progress', handler);
        return () => {
          ipcRenderer.removeListener('whisper:download-progress', handler);
        };
      },
      ```
    </action>
    <verify>
      1. Run `npx tsc --noEmit` — no TypeScript errors
      2. Verify shared/types.ts has WhisperModel and WhisperDownloadProgress types
      3. Verify ElectronAPI has 4 whisper methods: getWhisperModels, downloadWhisperModel, hasWhisperModel, onWhisperDownloadProgress
      4. Verify whisper.ts IPC handles 3 channels: whisper:list-models, whisper:download-model, whisper:has-model
      5. Verify whisper:download-progress is pushed to renderer during download
      6. Verify ipc/index.ts imports and calls registerWhisperHandlers(mainWindow)
      7. Verify preload.ts has 4 whisper bridge methods matching ElectronAPI interface
    </verify>
    <done>
      Whisper model types in shared/types.ts. IPC handlers for model list, download with
      progress, and availability check. Preload bridge wired. Renderer can now check for
      models, trigger downloads, and receive progress updates. TypeScript compiles clean.
    </done>
    <confidence>HIGH</confidence>
    <assumptions>
      - HuggingFace download URLs are stable and follow the expected pattern
      - https.get follows 302 redirects for HuggingFace CDN
      - Content-Length header is provided by HuggingFace (for progress calculation)
      - Download progress push via mainWindow.webContents.send works during download
    </assumptions>
  </task>
</phase>
