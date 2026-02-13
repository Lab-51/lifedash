# Plan 7.6 — API Transcription Providers

**Requirements:** R14 (API-Based Transcription Providers — 5 pts)
**Scope:** Deepgram + AssemblyAI REST transcription, provider selection in settings, automatic fallback
**Approach:** Transcriber interface abstraction, HTTP-based API calls (no SDK deps), settings-based provider config with encrypted keys, refactor transcriptionService for provider routing

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
| **7.6** | **R14** | **API transcription providers (Deepgram, AssemblyAI), fallback** |
| 7.7 | R13 | Meeting analytics, speaker diarization, advanced features |
| 7.8 | R16 (rest) | Card attachments, due dates UI, reminders |

## Architecture Decisions

1. **Transcriber interface pattern:** Define a `Transcriber` interface (`transcribeSegment(audio: Buffer, startTimeMs: number) → Promise<TranscriberResult>`) that both local Whisper and API providers implement. The transcriptionService dispatches to whichever is active — same result format, different backend.

2. **REST API (not WebSocket):** Use Deepgram's REST `/v1/listen` and AssemblyAI's REST `/v2/upload` + `/v2/transcript` endpoints. REST fits the existing 10-second segment pipeline cleanly. WebSocket streaming would require a fundamentally different audio pipeline and is deferred to a future plan.

3. **No new npm dependencies:** Both APIs are simple enough for native `fetch` (available in Electron's Node.js 20+). Avoids SDK version churn and keeps the dependency tree light.

4. **Settings-based provider config:** Store transcription provider choice and encrypted API keys in the settings key-value table under `transcription_provider` key as JSON. Follows the notification preferences pattern but with safeStorage encryption for API keys.

5. **Fallback strategy:** If the active API provider fails (network error, auth error, quota), automatically fall back to local Whisper if a model is available. If neither works, log the error and skip the segment (existing behavior when no Whisper model).

6. **Usage logging:** Add `'transcription'` to `AITaskType` and log API transcription calls to the `ai_usage` table for cost tracking. For API calls, log estimated token equivalents based on audio duration (since transcription APIs charge per second/minute, not tokens).

---

<phase n="7.6" name="API Transcription Providers">
  <context>
    Phase 7, Plan 6 of 8. Implements:
    - R14: API-Based Transcription Providers (Deepgram, AssemblyAI, selection, fallback)

    Current transcription infrastructure:
    - transcriptionService.ts: accumulates PCM chunks into 10-sec segments, dispatches to Whisper worker, saves results to DB, pushes to renderer
    - transcriptionWorker.ts: worker_threads, runs whisper.cpp via @fugood/whisper.node
    - whisperModelManager.ts: downloads GGML models, getDefaultModelPath() — returns null if no model
    - audioProcessor.ts: orchestrates recording (PCM accumulation + WAV save + transcription start/stop)
    - transcriptionService.start() currently skips transcription entirely if no Whisper model available

    Audio format: PCM Int16, 16kHz mono, 10-second segments (320,000 bytes each)

    Current provider system:
    - ai-provider.ts: provider factory, generate/streamGenerate, resolveTaskModel, logUsage
    - secure-storage.ts: encryptString/decryptString (Electron safeStorage → base64)
    - Settings stored in key-value settings table
    - AITaskType: 'summarization' | 'brainstorming' | 'task_generation' | 'idea_analysis' | 'task_structuring'

    Key files for context:
    @src/main/services/transcriptionService.ts (refactor — add provider routing)
    @src/main/services/whisperModelManager.ts (check for local model availability)
    @src/main/services/ai-provider.ts (logUsage pattern, secure-storage import)
    @src/main/services/secure-storage.ts (encryptString/decryptString)
    @src/main/services/audioProcessor.ts (no changes needed — calls transcriptionService)
    @src/shared/types.ts (add types, update AITaskType, update ElectronAPI)
    @src/main/ipc/index.ts (register new handlers)
    @src/preload/preload.ts (add bridge methods)
    @src/renderer/pages/SettingsPage.tsx (add TranscriptionProviderSection)
    @src/main/db/schema/settings.ts (settings table reference)
  </context>

  <task type="auto" n="1">
    <n>Transcription provider infrastructure — types, config service, IPC, preload</n>
    <files>
      src/shared/types.ts (MODIFY — add transcription provider types, update AITaskType + ElectronAPI)
      src/main/services/transcriptionProviderService.ts (NEW ~100 lines)
      src/main/ipc/transcription-provider.ts (NEW ~60 lines)
      src/main/ipc/index.ts (MODIFY — register transcription provider handlers)
      src/preload/preload.ts (MODIFY — add 4 transcription provider bridge methods)
    </files>
    <action>
      ## WHY
      Before implementing the actual API transcibers, we need the infrastructure: types, config
      management (with encrypted API keys), IPC channel plumbing, and preload bridge. This
      establishes the provider abstraction that Tasks 2 and 3 build on.

      ## WHAT

      ### 1a. Types — modify src/shared/types.ts

      Add transcription provider types (place near notification types):

      ```typescript
      // === TRANSCRIPTION PROVIDER TYPES ===

      export type TranscriptionProviderType = 'local' | 'deepgram' | 'assemblyai';

      export interface TranscriptionProviderConfig {
        type: TranscriptionProviderType;
        deepgramKeyEncrypted?: string;    // Encrypted via safeStorage
        assemblyaiKeyEncrypted?: string;  // Encrypted via safeStorage
      }

      export interface TranscriptionProviderStatus {
        type: TranscriptionProviderType;
        hasDeepgramKey: boolean;
        hasAssemblyaiKey: boolean;
        localModelAvailable: boolean;
      }
      ```

      Update AITaskType to include transcription:
      ```typescript
      export type AITaskType = 'summarization' | 'brainstorming' | 'task_generation' | 'idea_analysis' | 'task_structuring' | 'transcription';
      ```

      Add to ElectronAPI interface:
      ```typescript
      // Transcription Provider
      transcriptionGetConfig: () => Promise<TranscriptionProviderStatus>;
      transcriptionSetProvider: (type: TranscriptionProviderType) => Promise<void>;
      transcriptionSetApiKey: (provider: 'deepgram' | 'assemblyai', apiKey: string) => Promise<void>;
      transcriptionTestProvider: (type: TranscriptionProviderType) => Promise<{ success: boolean; error?: string; latencyMs?: number }>;
      ```

      Note: `transcriptionGetConfig` returns `TranscriptionProviderStatus` (not the raw config with
      encrypted keys — never send encrypted key strings to renderer, only hasXxxKey booleans).

      ### 1b. Create src/main/services/transcriptionProviderService.ts

      File header:
      ```
      // === FILE PURPOSE ===
      // Manages transcription provider configuration — which provider (local/deepgram/assemblyai)
      // is active and stores encrypted API keys for cloud providers.
      //
      // === DEPENDENCIES ===
      // secure-storage (encryptString/decryptString), settings table, whisperModelManager
      //
      // === LIMITATIONS ===
      // - API keys are encrypted at rest but decrypted in memory for API calls
      // - Only one active provider at a time (no round-robin or load balancing)
      ```

      Imports:
      ```typescript
      import { getDb } from '../db/connection';
      import { settings } from '../db/schema';
      import { eq } from 'drizzle-orm';
      import { encryptString, decryptString } from './secure-storage';
      import * as whisperModelManager from './whisperModelManager';
      import type { TranscriptionProviderConfig, TranscriptionProviderStatus, TranscriptionProviderType } from '../../shared/types';
      ```

      Constants:
      ```typescript
      const SETTINGS_KEY = 'transcription_provider';
      const DEFAULT_CONFIG: TranscriptionProviderConfig = { type: 'local' };
      ```

      Exports:

      **`getConfig(): Promise<TranscriptionProviderConfig>`**
      - Query settings table for SETTINGS_KEY
      - If not found, return DEFAULT_CONFIG
      - Parse stored JSON, merge with defaults for forward-compatibility

      **`getStatus(): Promise<TranscriptionProviderStatus>`**
      - Load config via getConfig()
      - Return { type, hasDeepgramKey: !!config.deepgramKeyEncrypted, hasAssemblyaiKey: !!config.assemblyaiKeyEncrypted, localModelAvailable: !!whisperModelManager.getDefaultModelPath() }
      - This is the renderer-safe version (no encrypted keys)

      **`setProviderType(type: TranscriptionProviderType): Promise<void>`**
      - Load current config
      - Update type field
      - Upsert to settings table

      **`setApiKey(provider: 'deepgram' | 'assemblyai', apiKey: string): Promise<void>`**
      - Load current config
      - Encrypt the key: `encryptString(apiKey)` → base64 string
      - Set `config.deepgramKeyEncrypted` or `config.assemblyaiKeyEncrypted`
      - Upsert to settings table

      **`getDecryptedKey(provider: 'deepgram' | 'assemblyai'): Promise<string | null>`**
      - Load config, return decryptString(encryptedKey) or null
      - Used internally by transcriber services (never exposed via IPC)

      Helper: `saveConfig(config: TranscriptionProviderConfig): Promise<void>`
      - Upsert pattern: check if key exists → update or insert

      ### 1c. Create src/main/ipc/transcription-provider.ts

      ```typescript
      import { ipcMain } from 'electron';
      import * as transcriptionProviderService from '../services/transcriptionProviderService';
      import type { TranscriptionProviderType } from '../../shared/types';

      export function registerTranscriptionProviderHandlers(): void {
        ipcMain.handle('transcription:get-config', async () => {
          return transcriptionProviderService.getStatus();
        });

        ipcMain.handle('transcription:set-provider', async (_event, type: TranscriptionProviderType) => {
          await transcriptionProviderService.setProviderType(type);
        });

        ipcMain.handle('transcription:set-api-key', async (_event, provider: 'deepgram' | 'assemblyai', apiKey: string) => {
          await transcriptionProviderService.setApiKey(provider, apiKey);
        });

        ipcMain.handle('transcription:test-provider', async (_event, type: TranscriptionProviderType) => {
          // Test implementation depends on provider:
          // 'local' → check if whisperModelManager.getDefaultModelPath() returns non-null
          // 'deepgram' → send tiny audio sample to Deepgram API
          // 'assemblyai' → send tiny audio sample to AssemblyAI API
          // Import test functions from deepgramTranscriber/assemblyaiTranscriber (created in Task 2)
          // For now, implement local test only; API tests wired in Task 2
          if (type === 'local') {
            const { getDefaultModelPath } = await import('../services/whisperModelManager');
            const modelPath = getDefaultModelPath();
            return { success: !!modelPath, error: modelPath ? undefined : 'No Whisper model downloaded' };
          }
          return { success: false, error: 'API provider test not yet implemented' };
        });
      }
      ```

      NOTE: The test for API providers will be updated in Task 2 when the actual transciber
      services are created. For now, just local testing works.

      ### 1d. Register in src/main/ipc/index.ts

      Add import and call registerTranscriptionProviderHandlers() in registerIpcHandlers.

      ### 1e. Extend src/preload/preload.ts

      Add to electronAPI:
      ```typescript
      // Transcription Provider
      transcriptionGetConfig: () => ipcRenderer.invoke('transcription:get-config'),
      transcriptionSetProvider: (type: string) => ipcRenderer.invoke('transcription:set-provider', type),
      transcriptionSetApiKey: (provider: string, apiKey: string) => ipcRenderer.invoke('transcription:set-api-key', provider, apiKey),
      transcriptionTestProvider: (type: string) => ipcRenderer.invoke('transcription:test-provider', type),
      ```
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. TranscriptionProviderType has 3 values: 'local', 'deepgram', 'assemblyai'
      3. TranscriptionProviderConfig has type + optional encrypted keys
      4. TranscriptionProviderStatus has type + 3 booleans (no encrypted keys exposed)
      5. AITaskType includes 'transcription'
      6. transcriptionProviderService exports: getConfig, getStatus, setProviderType, setApiKey, getDecryptedKey
      7. IPC handlers registered for 4 channels: transcription:get-config, transcription:set-provider, transcription:set-api-key, transcription:test-provider
      8. preload.ts has 4 transcription provider bridge methods
      9. Default config is type: 'local' (backward compatible)
    </verify>
    <done>Transcription provider infrastructure: types, config service with encrypted key storage, 4 IPC channels, preload bridge. Default provider is 'local' (backward compatible). TypeScript compiles cleanly.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - Settings key-value table supports JSON storage (verified — used by notification preferences)
      - encryptString/decryptString from secure-storage.ts work for API keys (same pattern as AI providers)
      - whisperModelManager.getDefaultModelPath() is synchronous (verified — reads from filesystem)
    </assumptions>
  </task>

  <task type="auto" n="2">
    <n>Deepgram + AssemblyAI transcribers, transcriptionService refactor, and fallback</n>
    <files>
      src/main/services/deepgramTranscriber.ts (NEW ~120 lines)
      src/main/services/assemblyaiTranscriber.ts (NEW ~140 lines)
      src/main/services/transcriptionService.ts (MODIFY — add provider routing + fallback)
      src/main/ipc/transcription-provider.ts (MODIFY — wire API test functions)
    </files>
    <action>
      ## WHY
      This is the core of R14 — actual API transcription implementations that can replace or
      supplement local Whisper. Both providers receive 10-second PCM segments and return
      transcript text in a uniform format. The transcriptionService is refactored to route
      segments based on the active provider, with automatic fallback.

      ## WHAT

      ### 2a. Define the Transcriber interface (in transcriptionService.ts or separate file)

      Either at the top of transcriptionService.ts or as a shared type:
      ```typescript
      interface TranscriberResult {
        text: string;
        segments: Array<{ text: string; startMs: number; endMs: number }>;
      }
      ```

      This is the uniform result format that both API transcribers and the existing worker produce.

      ### 2b. Create src/main/services/deepgramTranscriber.ts

      File header:
      ```
      // === FILE PURPOSE ===
      // Deepgram REST API transcriber — sends PCM audio segments and receives
      // transcribed text. Uses the /v1/listen endpoint with pre-recorded audio.
      //
      // === DEPENDENCIES ===
      // Node.js fetch (built-in), transcriptionProviderService (for API key)
      //
      // === LIMITATIONS ===
      // - REST API (not WebSocket streaming) — transcribes 10-sec segments after recording
      // - English-only for now (language parameter hardcoded)
      // - No speaker diarization in this implementation (deferred to Plan 7.7)
      ```

      Imports:
      ```typescript
      import * as transcriptionProviderService from './transcriptionProviderService';
      ```

      Constants:
      ```typescript
      const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';
      ```

      Exports:

      **`async transcribeSegment(pcmBuffer: Buffer, startTimeMs: number): Promise<TranscriberResult>`**

      Steps:
      1. Get API key: `const apiKey = await transcriptionProviderService.getDecryptedKey('deepgram');`
      2. If no key, throw error: `'Deepgram API key not configured'`
      3. Build query params: `?model=nova-2&language=en&punctuate=true&smart_format=true`
      4. Make HTTP request:
         ```typescript
         const response = await fetch(`${DEEPGRAM_API_URL}?model=nova-2&language=en&punctuate=true&smart_format=true`, {
           method: 'POST',
           headers: {
             'Authorization': `Token ${apiKey}`,
             'Content-Type': 'audio/l16;rate=16000;channels=1',
           },
           body: pcmBuffer,
         });
         ```
      5. Check response.ok — if not, throw with status + body text
      6. Parse JSON response:
         ```typescript
         const data = await response.json();
         const channel = data.results?.channels?.[0];
         const alternative = channel?.alternatives?.[0];
         const transcript = alternative?.transcript ?? '';
         ```
      7. Build segments from Deepgram's word-level timestamps (if available) or treat as single segment:
         ```typescript
         // Deepgram returns words with start/end in seconds
         const words = alternative?.words ?? [];
         if (words.length === 0) {
           return { text: transcript, segments: [{ text: transcript, startMs: startTimeMs, endMs: startTimeMs + 10000 }] };
         }
         // Group words into the full segment (for now, treat as single segment like local Whisper)
         return {
           text: transcript,
           segments: [{
             text: transcript,
             startMs: startTimeMs + Math.round((words[0]?.start ?? 0) * 1000),
             endMs: startTimeMs + Math.round((words[words.length - 1]?.end ?? 10) * 1000),
           }],
         };
         ```

      **`async testConnection(): Promise<{ success: boolean; error?: string; latencyMs?: number }>`**
      - Generate 1 second of silence (16000 Int16 samples = 32000 bytes of zeros)
      - Send to Deepgram API
      - If 200 OK → success (even with empty transcript, it means auth works)
      - Measure latency
      - Return result

      IMPORTANT: I'm not 100% certain about the exact Deepgram REST API response format. The
      agent MUST verify by checking the Deepgram documentation before implementing. The format
      described above is based on known patterns but should be confirmed. Key things to verify:
      - Content-Type header for raw PCM: is `audio/l16;rate=16000;channels=1` correct?
      - Response JSON path: is it `results.channels[0].alternatives[0].transcript`?
      - Query parameters: `model=nova-2`, `punctuate=true`, `smart_format=true`

      ### 2c. Create src/main/services/assemblyaiTranscriber.ts

      File header:
      ```
      // === FILE PURPOSE ===
      // AssemblyAI REST API transcriber — uploads PCM audio and polls for
      // transcription results. Uses upload + transcript + polling workflow.
      //
      // === DEPENDENCIES ===
      // Node.js fetch (built-in), transcriptionProviderService (for API key)
      //
      // === LIMITATIONS ===
      // - Polling-based (adds 3-10 seconds of latency per segment)
      // - No speaker diarization in this implementation (deferred to Plan 7.7)
      // - English-only for now
      ```

      Constants:
      ```typescript
      const ASSEMBLYAI_API_URL = 'https://api.assemblyai.com/v2';
      const POLL_INTERVAL_MS = 1000;
      const MAX_POLL_ATTEMPTS = 30; // 30 seconds max wait
      ```

      Exports:

      **`async transcribeSegment(pcmBuffer: Buffer, startTimeMs: number): Promise<TranscriberResult>`**

      Steps:
      1. Get API key from transcriptionProviderService
      2. Upload audio:
         ```typescript
         const uploadResponse = await fetch(`${ASSEMBLYAI_API_URL}/upload`, {
           method: 'POST',
           headers: {
             'Authorization': apiKey,
             'Content-Type': 'application/octet-stream',
           },
           body: pcmBuffer,
         });
         const { upload_url } = await uploadResponse.json();
         ```
      3. Submit transcription request:
         ```typescript
         const transcriptResponse = await fetch(`${ASSEMBLYAI_API_URL}/transcript`, {
           method: 'POST',
           headers: {
             'Authorization': apiKey,
             'Content-Type': 'application/json',
           },
           body: JSON.stringify({
             audio_url: upload_url,
             language_code: 'en',
           }),
         });
         const { id } = await transcriptResponse.json();
         ```
      4. Poll for result:
         ```typescript
         for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
           await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
           const pollResponse = await fetch(`${ASSEMBLYAI_API_URL}/transcript/${id}`, {
             headers: { 'Authorization': apiKey },
           });
           const result = await pollResponse.json();
           if (result.status === 'completed') {
             return {
               text: result.text || '',
               segments: [{
                 text: result.text || '',
                 startMs: startTimeMs,
                 endMs: startTimeMs + 10000,
               }],
             };
           }
           if (result.status === 'error') {
             throw new Error(`AssemblyAI error: ${result.error}`);
           }
         }
         throw new Error('AssemblyAI transcription timed out');
         ```

      **`async testConnection(): Promise<{ success: boolean; error?: string; latencyMs?: number }>`**
      - Upload 1 second of silence
      - If upload succeeds (200 OK with upload_url) → connection works
      - Don't need to wait for full transcription — upload success proves auth works
      - Return result

      IMPORTANT: Same as Deepgram — verify exact API format:
      - Does AssemblyAI accept raw PCM via /v2/upload? Or does it need WAV headers?
        If it needs WAV, use the wavefile library (already installed) to wrap PCM in WAV format.
      - Response format for upload: `{ upload_url: string }`?
      - Response format for transcript: `{ id: string, status: string, text: string }`?

      ### 2d. Refactor src/main/services/transcriptionService.ts

      This is the most important change. The transcription service needs to route segments
      based on the active provider while keeping the existing worker-based local path intact.

      Import additions:
      ```typescript
      import * as transcriptionProviderService from './transcriptionProviderService';
      import * as deepgramTranscriber from './deepgramTranscriber';
      import * as assemblyaiTranscriber from './assemblyaiTranscriber';
      import { logUsage } from './ai-provider';
      import type { TranscriptionProviderType } from '../../shared/types';
      ```

      Add module-level state:
      ```typescript
      let activeProvider: TranscriptionProviderType = 'local';
      ```

      Modify `start()`:
      ```typescript
      export async function start(meetingId: string): Promise<void> {
        // Resolve which provider to use
        const config = await transcriptionProviderService.getConfig();
        activeProvider = config.type;

        // Common reset
        currentMeetingId = meetingId;
        accumulatorBuffer = Buffer.alloc(0);
        segmentIndex = 0;
        lastTranscriptText = '';
        pendingSegments = [];
        transcribing = false;

        if (activeProvider === 'local') {
          // Existing local Whisper path
          const modelPath = whisperModelManager.getDefaultModelPath();
          if (!modelPath) {
            console.log('[Transcription] No whisper model available. Skipping transcription.');
            return;
          }
          // ... existing worker spawn code (unchanged) ...
        } else {
          // API provider — verify key is configured
          const hasKey = activeProvider === 'deepgram'
            ? !!(await transcriptionProviderService.getDecryptedKey('deepgram'))
            : !!(await transcriptionProviderService.getDecryptedKey('assemblyai'));

          if (!hasKey) {
            console.log(`[Transcription] No API key for ${activeProvider}. Skipping transcription.`);
            return;
          }
          console.log(`[Transcription] Using API provider: ${activeProvider}`);
          // No worker needed — API calls happen in dispatchNext
        }
      }
      ```

      Modify `addChunk()`:
      - The chunk accumulation logic stays the same — 10-second segments regardless of provider
      - Need to handle the case where no worker is spawned (API mode): still queue segments

      Modify `dispatchNext()` — the key routing point:
      ```typescript
      function dispatchNext(): void {
        if (transcribing || pendingSegments.length === 0) return;
        if (activeProvider === 'local' && !worker) return;

        transcribing = true;
        const segment = pendingSegments.shift()!;
        const startTimeMs = segmentIndex * SEGMENT_DURATION_SEC * 1000;
        segmentIndex++;

        if (activeProvider === 'local') {
          // Existing worker dispatch (unchanged)
          const arrayBuffer = segment.buffer.slice(segment.byteOffset, segment.byteOffset + segment.byteLength) as ArrayBuffer;
          worker!.postMessage({ type: 'transcribe', audioData: arrayBuffer, segmentIndex: segmentIndex - 1, startTimeMs }, [arrayBuffer]);
        } else {
          // API provider dispatch
          dispatchToApi(segment, startTimeMs);
        }
      }
      ```

      Add new async function for API dispatch:
      ```typescript
      async function dispatchToApi(segment: Buffer, startTimeMs: number): Promise<void> {
        try {
          let result;
          if (activeProvider === 'deepgram') {
            result = await deepgramTranscriber.transcribeSegment(segment, startTimeMs);
          } else {
            result = await assemblyaiTranscriber.transcribeSegment(segment, startTimeMs);
          }

          // Process result same as worker result
          if (result.text && result.text.trim() && currentMeetingId) {
            lastTranscriptText = result.text.trim();

            for (const seg of result.segments) {
              if (!seg.text.trim()) continue;
              try {
                const saved = await meetingService.addTranscriptSegment(
                  currentMeetingId,
                  seg.text.trim(),
                  seg.startMs,
                  seg.endMs,
                );
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('recording:transcript-segment', saved);
                }
              } catch (err) {
                console.error('[Transcription] Failed to save segment:', err);
              }
            }

            // Log API usage (fire-and-forget) — use segment duration as proxy metric
            try {
              const durationSec = segment.byteLength / (SAMPLE_RATE * 2); // PCM Int16 = 2 bytes/sample
              // Log with estimated "tokens" based on audio duration (1 sec ≈ 1 "token" for tracking)
              await logUsage('api-transcription', activeProvider, 'transcription', {
                inputTokens: Math.round(durationSec),
                outputTokens: 0,
                totalTokens: Math.round(durationSec),
              });
            } catch { /* non-fatal */ }
          }
        } catch (err) {
          console.error(`[Transcription] API (${activeProvider}) failed:`, err);

          // FALLBACK: try local Whisper if available
          if (worker) {
            console.log('[Transcription] Falling back to local Whisper');
            const arrayBuffer = segment.buffer.slice(segment.byteOffset, segment.byteOffset + segment.byteLength) as ArrayBuffer;
            worker.postMessage({ type: 'transcribe', audioData: arrayBuffer, segmentIndex: segmentIndex - 1, startTimeMs }, [arrayBuffer]);
            return; // Worker message handler will set transcribing = false
          }

          console.error('[Transcription] No fallback available. Skipping segment.');
        }

        transcribing = false;
        dispatchNext();
      }
      ```

      Modify `stop()`:
      - If activeProvider !== 'local', skip worker termination (no worker exists)
      - Still wait for pending segments to complete
      ```typescript
      export async function stop(): Promise<void> {
        // Flush remaining audio
        if (accumulatorBuffer.byteLength > 0 && currentMeetingId) {
          pendingSegments.push(Buffer.from(accumulatorBuffer));
          accumulatorBuffer = Buffer.alloc(0);
          dispatchNext();
        }

        await waitForPending();

        if (worker) {
          worker.postMessage({ type: 'stop' });
          await worker.terminate();
          worker = null;
        }

        currentMeetingId = null;
        activeProvider = 'local';
        console.log('[Transcription] Stopped');
      }
      ```

      **Fallback enhancement**: For a more robust fallback, modify `start()` to spawn
      the Whisper worker in the background even when an API provider is active, IF a local
      model is available. This gives us a warm fallback. However, this adds complexity.
      For MVP, only fall back if the worker was already spawned (i.e., don't spawn it
      just for fallback). Document this limitation.

      ### 2e. Wire API test functions in transcription-provider.ts

      Update the 'transcription:test-provider' handler:
      ```typescript
      if (type === 'deepgram') {
        const { testConnection } = await import('../services/deepgramTranscriber');
        return testConnection();
      }
      if (type === 'assemblyai') {
        const { testConnection } = await import('../services/assemblyaiTranscriber');
        return testConnection();
      }
      ```
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. deepgramTranscriber.ts exports: transcribeSegment, testConnection
      3. assemblyaiTranscriber.ts exports: transcribeSegment, testConnection
      4. transcriptionService.ts resolves provider from config on start()
      5. dispatchNext() routes to worker (local) or API (deepgram/assemblyai)
      6. API dispatch saves segments to DB and pushes to renderer (same as worker path)
      7. API failures log error and attempt fallback to local Whisper if worker exists
      8. API transcription calls logged to ai_usage table with taskType 'transcription'
      9. transcription:test-provider IPC handler works for all 3 provider types
      10. stop() handles both local (worker cleanup) and API (no worker) modes
    </verify>
    <done>Deepgram and AssemblyAI REST transcribers with uniform TranscriberResult format. transcriptionService refactored for provider routing (local/deepgram/assemblyai) with automatic fallback. API test functions wired into IPC. Usage logging for API calls. TypeScript compiles cleanly.</done>
    <confidence>MEDIUM</confidence>
    <assumptions>
      - Deepgram REST API at /v1/listen accepts raw PCM with Content-Type: audio/l16;rate=16000;channels=1
        VERIFY: Check Deepgram docs for exact content-type header format and response JSON structure
      - AssemblyAI /v2/upload accepts raw binary audio data
        VERIFY: Check if AssemblyAI needs WAV headers or if raw PCM works. If WAV needed, use wavefile library.
      - Node.js native fetch is available in Electron's Node.js runtime (Node 20+)
        VERIFY: If not, use node-fetch or Electron's net module
      - Deepgram model 'nova-2' is the current recommended model
      - AssemblyAI polling is fast enough for 10-sec segments (typically 3-10 sec)
      - logUsage works with synthetic providerId 'api-transcription' (no FK constraint on providerId)
        VERIFY: Check if ai_usage.providerId has a foreign key to ai_providers table. If yes, need a different approach for logging.
    </assumptions>
  </task>

  <task type="auto" n="3">
    <n>Transcription provider settings UI</n>
    <files>
      src/renderer/components/settings/TranscriptionProviderSection.tsx (NEW ~200 lines)
      src/renderer/pages/SettingsPage.tsx (MODIFY — add TranscriptionProviderSection)
    </files>
    <action>
      ## WHY
      Users need a UI to select their transcription provider (Local Whisper, Deepgram, or
      AssemblyAI), configure API keys, and test connectivity. This completes R14's
      "provider selection in settings" requirement.

      ## WHAT

      ### 3a. Create src/renderer/components/settings/TranscriptionProviderSection.tsx

      Read BackupSection.tsx and NotificationSection.tsx first to follow the same patterns.

      Layout:
      ```
      ── Transcription Provider ──────────────────────

      Select how meeting audio is transcribed:

      ○ Local (Whisper)
        Uses locally downloaded Whisper model. Free, private, works offline.
        Status: Model available ✓  (or: No model downloaded)

      ○ Deepgram
        Cloud-based transcription with high accuracy and speed.
        API Key: [••••••••••••] [Show/Hide] [Clear]
        Status: Connected ✓  (or: Not configured)

      ○ AssemblyAI
        Cloud-based transcription with advanced features.
        API Key: [••••••••••••] [Show/Hide] [Clear]
        Status: Connected ✓  (or: Not configured)

      [Test Connection]
      ─────────────────────────────────────────────────
      ```

      State:
      ```typescript
      const [config, setConfig] = useState<TranscriptionProviderStatus | null>(null);
      const [deepgramKey, setDeepgramKey] = useState('');
      const [assemblyaiKey, setAssemblyaiKey] = useState('');
      const [showDeepgramKey, setShowDeepgramKey] = useState(false);
      const [showAssemblyaiKey, setShowAssemblyaiKey] = useState(false);
      const [testing, setTesting] = useState(false);
      const [testResult, setTestResult] = useState<{ success: boolean; error?: string; latencyMs?: number } | null>(null);
      const [saving, setSaving] = useState(false);
      ```

      On mount: load config via `window.electronAPI.transcriptionGetConfig()`

      Provider selection:
      - Radio buttons for 'local', 'deepgram', 'assemblyai'
      - On change: call `window.electronAPI.transcriptionSetProvider(type)` + refresh config

      API key inputs (shown when corresponding provider is selected or has a key):
      - Text input with type="password" (toggleable with Show/Hide button)
      - On blur or Enter: if key changed, call `window.electronAPI.transcriptionSetApiKey(provider, key)` + refresh config
      - Clear button: sets key to empty string

      Test button:
      - Calls `window.electronAPI.transcriptionTestProvider(config.type)`
      - Shows spinner while testing
      - Shows result: success (green check + latency) or error (red X + message)

      Status indicators per provider:
      - Local: "Model available" (green) if localModelAvailable, "No model downloaded" (yellow) otherwise
      - Deepgram: "API key configured" (green) if hasDeepgramKey, "Not configured" (gray) otherwise
      - AssemblyAI: "API key configured" (green) if hasAssemblyaiKey, "Not configured" (gray) otherwise

      Icon: use Mic or AudioLines from lucide-react for the section header.

      Styling: follow BackupSection/NotificationSection patterns:
      - Section header with icon + title
      - Description text
      - Radio group with labels and descriptions
      - Input fields with appropriate spacing
      - Button styling consistent with other settings sections

      ### 3b. Add TranscriptionProviderSection to SettingsPage

      Import TranscriptionProviderSection.
      Add it BEFORE the "AI Providers" section (since transcription provider is a user-facing
      choice that's more immediately relevant than AI model configuration).

      Check the current section order in SettingsPage and insert appropriately.
      The order should be approximately:
      1. Appearance (theme)
      2. **Transcription Provider** (NEW)
      3. AI Providers
      4. Model Assignments
      5. AI Usage
      6. Database Backups
      7. Notifications
      8. Export Data
      9. About
    </action>
    <verify>
      1. `npx tsc --noEmit` — zero TypeScript errors
      2. TranscriptionProviderSection renders 3 radio options (Local, Deepgram, AssemblyAI)
      3. Selecting a provider calls transcriptionSetProvider IPC
      4. API key inputs appear for Deepgram and AssemblyAI
      5. API key save calls transcriptionSetApiKey IPC with the key value
      6. Test button calls transcriptionTestProvider and shows result
      7. Status indicators show based on config (localModelAvailable, hasDeepgramKey, hasAssemblyaiKey)
      8. Section is positioned before AI Providers in SettingsPage
      9. Styling follows existing settings section patterns (BackupSection, NotificationSection)
    </verify>
    <done>TranscriptionProviderSection settings UI with provider selection radio buttons, API key management, test connectivity button, and status indicators. Added to SettingsPage before AI Providers section. TypeScript compiles cleanly.</done>
    <confidence>HIGH</confidence>
    <assumptions>
      - TranscriptionProviderStatus type is available from shared/types (created in Task 1)
      - transcriptionGetConfig, transcriptionSetProvider, transcriptionSetApiKey, transcriptionTestProvider methods available on electronAPI (created in Task 1)
      - Lucide icons Mic or AudioLines exist (standard lucide-react icons)
      - Settings page can accommodate a new section without layout issues
    </assumptions>
  </task>
</phase>
