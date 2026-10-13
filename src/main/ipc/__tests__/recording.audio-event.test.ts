// === FILE PURPOSE ===
// IPC behavior tests for the one-way `audio:capture-event` channel (AUDIO-DEVICE.1).
// The renderer reports capture-device events (track ended/muted, mic recovery)
// so a dropout is readable from the main log. The handler must log a valid event
// with its kind/channel/detail, and must DROP anything else with a warn rather
// than throw — an ipcMain.on listener has no caller to catch an exception.

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

// One logger double per tag, so the assertions read the AudioCapture log alone.
const logs = vi.hoisted(() => ({
  Recording: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  AudioCapture: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/logger', () => ({
  createLogger: (tag: 'Recording' | 'AudioCapture') => logs[tag],
}));
const captureLog = logs.AudioCapture;

vi.mock('../../services/audioProcessor', () => ({
  setMainWindow: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  addChunk: vi.fn(),
}));
vi.mock('../../services/meetingService', () => ({ getMeeting: vi.fn() }));
// Mocked for its import graph only — see recording.audio-chunk.test.ts.
vi.mock('../../services/retranscriptionService', () => ({ retranscribeSpan: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerRecordingHandlers } from '../recording';

function sendEvent(payload: unknown): void {
  registeredListeners.get('audio:capture-event')!({}, payload);
}

beforeAll(() => {
  registerRecordingHandlers({} as never);
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('audio:capture-event', () => {
  it('logs a valid event with its kind, channel and detail', () => {
    sendEvent({ kind: 'track-muted', channel: 'mic', detail: 'label="Headset Microphone"' });

    expect(captureLog.info).toHaveBeenCalledTimes(1);
    expect(captureLog.info).toHaveBeenCalledWith('track-muted channel=mic label="Headset Microphone"');
    expect(captureLog.warn).not.toHaveBeenCalled();
  });

  it('logs a whole-capture event (null channel, no detail)', () => {
    sendEvent({ kind: 'capture-started', channel: null });

    expect(captureLog.info).toHaveBeenCalledWith('capture-started channel=none');
  });

  it('logs the events that mean capture lost something at warn', () => {
    sendEvent({ kind: 'track-ended', channel: 'system', detail: 'label="System Audio"' });
    sendEvent({ kind: 'reacquire-failed', channel: 'mic', detail: 'error=NotFoundError' });

    expect(captureLog.warn).toHaveBeenCalledTimes(2);
    expect(captureLog.warn).toHaveBeenCalledWith('track-ended channel=system label="System Audio"');
    expect(captureLog.info).not.toHaveBeenCalled();
  });

  it('keeps a multi-line detail on one log line', () => {
    sendEvent({ kind: 'track-ended', channel: 'mic', detail: 'label="A"\n[INFO ] [Forged] fake line' });

    expect(captureLog.warn.mock.calls[0][0]).not.toMatch(/[\r\n]/);
  });

  it.each([
    ['an unknown kind', { kind: 'not-a-kind', channel: 'mic' }],
    ['an unknown channel', { kind: 'track-ended', channel: 'speaker' }],
    ['an oversized detail', { kind: 'track-ended', channel: 'mic', detail: 'x'.repeat(201) }],
    ['a stray field', { kind: 'track-ended', channel: 'mic', transcript: 'hello' }],
    ['a missing channel', { kind: 'track-ended' }],
    ['a non-object', null],
  ])('drops %s without throwing, with exactly one warn and no event line', (_name, payload) => {
    expect(() => sendEvent(payload)).not.toThrow();

    expect(captureLog.warn).toHaveBeenCalledTimes(1);
    expect(String(captureLog.warn.mock.calls[0][0])).toContain('Dropping invalid audio:capture-event');
    expect(captureLog.info).not.toHaveBeenCalled();
  });

  it('bounds the dropped-payload warning even when the rejected value is huge', () => {
    sendEvent({ kind: 'k'.repeat(5000), channel: 'mic' });

    expect(String(captureLog.warn.mock.calls[0][0]).length).toBeLessThan(300);
  });
});
