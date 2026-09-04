// === FILE PURPOSE ===
// IPC handlers for audio recording control and streaming.
// Coordinates between audioProcessor (raw audio) and meetingService (DB).
//
// === DEPENDENCIES ===
// electron (ipcMain, BrowserWindow), ../services/audioProcessor
//
// === LIMITATIONS ===
// - No transcription handlers yet (Plan 4.3)
// - 'enable-loopback-audio' and 'disable-loopback-audio' are auto-registered
//   by electron-audio-loopback's initMain() — NOT registered here.
//
// === VERIFICATION STATUS ===
// - ipcMain.handle for request/response (recording:start, recording:stop)
// - ipcMain.on for fire-and-forget (audio:chunk)

import { ipcMain, BrowserWindow } from 'electron';
import * as audioProcessor from '../services/audioProcessor';
import * as meetingService from '../services/meetingService';
import { validateInput } from '../../shared/validation/ipc-validator';
import { idParamSchema } from '../../shared/validation/schemas';
import type { AudioChunkBuffers } from '../../shared/types';
import { createLogger } from '../services/logger';

const log = createLogger('Recording');

/** Reuse the incoming bytes without a copy; only wrap when it is not already a Buffer. */
function asBuffer(view: ArrayBufferView): Buffer {
  return Buffer.isBuffer(view) ? view : Buffer.from(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
}

/**
 * Normalize an `audio:chunk` payload. Zod is deliberately not used here: the
 * payload is binary, the channel is fire-and-forget at ~4 Hz, and validateInput
 * throws — a throw per chunk would be far worse than dropping one. Returns null
 * for anything unrecognized so the caller can drop it.
 *
 * Two shapes are accepted:
 *  - the SPEAKER.1 object `{ mixed, mic, system }`, and
 *  - the legacy single buffer (the mono sum), which an older renderer still
 *    sends across a hot reload. That stream is the only one available, so it
 *    fills `mixed` and `system` and leaves `mic` null — which routes it down
 *    the unchanged mixed-only path in transcriptionService.
 */
function toAudioChunkBuffers(payload: unknown): AudioChunkBuffers | null {
  if (ArrayBuffer.isView(payload)) {
    const mixed = asBuffer(payload);
    return { mixed, mic: null, system: mixed };
  }
  if (payload !== null && typeof payload === 'object') {
    const parts = payload as Record<string, unknown>;
    if (ArrayBuffer.isView(parts.mixed) && ArrayBuffer.isView(parts.system)) {
      return {
        mixed: asBuffer(parts.mixed),
        mic: ArrayBuffer.isView(parts.mic) ? asBuffer(parts.mic) : null,
        system: asBuffer(parts.system),
      };
    }
  }
  return null;
}

export function registerRecordingHandlers(mainWindow: BrowserWindow): void {
  // Only warn once per process: a malformed renderer would otherwise log ~4x/s.
  let warnedMalformedChunk = false;
  // Pass the window reference to audioProcessor for state push events
  audioProcessor.setMainWindow(mainWindow);

  ipcMain.handle('recording:start', async (_event, meetingId: unknown) => {
    const validMeetingId = validateInput(idParamSchema, meetingId);

    // Read the meeting's stored transcription language to pass to audio processor
    let language: string | undefined;
    try {
      const meeting = await meetingService.getMeeting(validMeetingId);
      if (meeting?.transcriptionLanguage) {
        language = meeting.transcriptionLanguage;
      }
    } catch {
      // Non-fatal — will fall back to DB setting in transcriptionService
    }

    await audioProcessor.startRecording(validMeetingId, language);
  });

  ipcMain.handle('recording:stop', async () => {
    const audioPath = await audioProcessor.stopRecording();
    return audioPath;
  });

  // audio:chunk: binary PCM data — normalized structurally, see toAudioChunkBuffers
  ipcMain.on('audio:chunk', (_event, chunk: unknown) => {
    const payload = toAudioChunkBuffers(chunk);
    if (!payload) {
      if (!warnedMalformedChunk) {
        warnedMalformedChunk = true;
        log.warn('Dropping malformed audio:chunk payload (further occurrences are not logged)');
      }
      return;
    }
    audioProcessor.addChunk(payload);
  });
}
