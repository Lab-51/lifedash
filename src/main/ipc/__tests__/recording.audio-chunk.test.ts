// === FILE PURPOSE ===
// IPC behavior tests for the `audio:chunk` fire-and-forget channel (SPEAKER.1).
// The renderer now sends one object per audio callback carrying three channel
// views, but the handler must still accept the legacy single Buffer an older
// renderer sends across a hot reload, and must drop anything else rather than
// throw — a throw on a ~4 Hz fire-and-forget channel would be far worse than a
// dropped chunk.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

const registeredListeners = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      registeredListeners.set(channel, fn);
    }),
  },
}));

const logMock = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../services/logger', () => ({ createLogger: () => logMock }));

vi.mock('../../services/audioProcessor', () => ({
  setMainWindow: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  addChunk: vi.fn(),
}));
vi.mock('../../services/meetingService', () => ({ getMeeting: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerRecordingHandlers } from '../recording';
import * as audioProcessor from '../../services/audioProcessor';

const MIXED = Buffer.from([1, 2, 3, 4]);
const MIC = Buffer.from([5, 6, 7, 8]);
const SYSTEM = Buffer.from([9, 10, 11, 12]);

function sendChunk(payload: unknown): void {
  registeredListeners.get('audio:chunk')!({}, payload);
}

beforeAll(() => {
  registerRecordingHandlers({} as never);
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('audio:chunk', () => {
  it('forwards the three-channel payload to audioProcessor', () => {
    sendChunk({ mixed: MIXED, mic: MIC, system: SYSTEM });

    expect(audioProcessor.addChunk).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(audioProcessor.addChunk).mock.calls[0][0];
    expect(payload.mixed.equals(MIXED)).toBe(true);
    expect(payload.mic?.equals(MIC)).toBe(true);
    expect(payload.system.equals(SYSTEM)).toBe(true);
  });

  it('keeps a null mic (mic off, or its track gone) null rather than inventing a channel', () => {
    sendChunk({ mixed: MIXED, mic: null, system: SYSTEM });

    expect(vi.mocked(audioProcessor.addChunk).mock.calls[0][0].mic).toBeNull();
  });

  it('accepts the legacy single-buffer payload as mixed-only', () => {
    // An older renderer surviving a hot reload still sends the bare mono sum.
    sendChunk(MIXED);

    const payload = vi.mocked(audioProcessor.addChunk).mock.calls[0][0];
    expect(payload.mixed.equals(MIXED)).toBe(true);
    // mic null routes it down the unchanged mixed-only transcription path.
    expect(payload.mic).toBeNull();
  });

  it('drops a malformed payload without throwing, warning only once', () => {
    expect(() => sendChunk({ mixed: 'not-audio', system: SYSTEM })).not.toThrow();
    expect(() => sendChunk(null)).not.toThrow();

    expect(audioProcessor.addChunk).not.toHaveBeenCalled();
    // Warned at most once for the whole process — at ~4 chunks/second a warning
    // per malformed chunk would bury the log.
    expect(logMock.warn.mock.calls.filter((c) => String(c[0]).includes('audio:chunk'))).toHaveLength(1);
  });
});
