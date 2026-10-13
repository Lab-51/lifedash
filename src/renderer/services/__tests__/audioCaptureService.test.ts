// === FILE PURPOSE ===
// Unit tests for the two-channel capture graph (SPEAKER.1 Task 1). The contracts
// pinned here:
//   - mic and system reach a ChannelMergerNode on inputs 0 and 1 respectively,
//     feeding ONE 2-in/1-out ScriptProcessorNode (one clock, one callback, both
//     channels frame-aligned for free),
//   - each `audio:chunk` message carries all three views, with `mixed` equal to
//     `mic + system` sample-wise so the WAV file and every other mixed-stream
//     consumer are unchanged,
//   - `mic` is null when the microphone is off, so main can fall back to the
//     pre-SPEAKER.1 mixed-only pipeline, and
//   - the level meter reads the MIXED sum, not one channel, and
//   - a lost mic or system track is re-acquired by the device watcher when its
//     device is back -- a chosen mic is waited for, never replaced -- and nothing
//     re-acquires after stopCapture (AUDIO-DEVICE.1 Task 3).
//
// The Web Audio API and window.electronAPI are faked; the real capture service
// runs. Node environment: this module touches no DOM, only globals.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as audioCaptureService from '../audioCaptureService';
import {
  BACKSTOP_INTERVAL_MS,
  DEVICE_CHANGE_DEBOUNCE_MS,
  REACQUIRE_TIMEOUT_MS,
  RETRY_DELAYS_MS,
  SLOW_RETRY_EVERY_TICKS,
} from '../audioDeviceWatcher';

const BUFFER_SIZE = 4096;

// ---------------------------------------------------------------------------
// Web Audio fakes
// ---------------------------------------------------------------------------

interface Connection {
  target: FakeNode;
  output?: number;
  input?: number;
}

class FakeNode {
  connections: Connection[] = [];
  connect(target: FakeNode, output?: number, input?: number): FakeNode {
    this.connections.push({ target, output, input });
    return target;
  }
  disconnect(): void {
    this.connections = [];
  }
  /** The connection this node makes to `target`, if any. */
  connectionTo(target: FakeNode): Connection | undefined {
    return this.connections.find((c) => c.target === target);
  }
}

class FakeGainNode extends FakeNode {
  gain = { value: 0 };
}

class FakeMergerNode extends FakeNode {
  constructor(public numberOfInputs: number) {
    super();
  }
}

class FakeScriptProcessorNode extends FakeNode {
  onaudioprocess: ((event: { inputBuffer: { getChannelData: (ch: number) => Float32Array } }) => void) | null = null;
  constructor(
    public bufferSize: number,
    public numberOfInputChannels: number,
    public numberOfOutputChannels: number,
  ) {
    super();
  }
}

class FakeAudioContext {
  destination = new FakeNode();
  gains: FakeGainNode[] = [];
  mergers: FakeMergerNode[] = [];
  processors: FakeScriptProcessorNode[] = [];
  sources = new Map<unknown, FakeNode>();

  /** What the runtime reports: the requested sink object when honoured, '' (default) otherwise. */
  sinkId: unknown = '';
  closed = false;

  constructor(public options: { sampleRate: number; sinkId?: { type: 'none' } }) {
    if (options.sinkId && sinkSupport === 'throws') throw new DOMException('no sinkId', 'NotSupportedError');
    if (options.sinkId && sinkSupport === 'honoured') this.sinkId = options.sinkId;
    contexts.push(this);
  }
  createMediaStreamSource(stream: unknown): FakeNode {
    const node = new FakeNode();
    this.sources.set(stream, node);
    return node;
  }
  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }
  createChannelMerger(numberOfInputs: number): FakeMergerNode {
    const node = new FakeMergerNode(numberOfInputs);
    this.mergers.push(node);
    return node;
  }
  createScriptProcessor(bufferSize: number, inputs: number, outputs: number): FakeScriptProcessorNode {
    const node = new FakeScriptProcessorNode(bufferSize, inputs, outputs);
    this.processors.push(node);
    return node;
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

let contexts: FakeAudioContext[] = [];
/** How the fake runtime treats `sinkId: { type: 'none' }`: applies it, ignores it, or throws on it. */
let sinkSupport: 'honoured' | 'ignored' | 'throws' = 'honoured';

function makeTrack(label = '') {
  return {
    label,
    readyState: 'live' as 'live' | 'ended',
    onended: null as null | (() => void),
    onmute: null as null | (() => void),
    onunmute: null as null | (() => void),
    stop: vi.fn(),
  };
}

function makeStream(audioTracks = [makeTrack()], videoTracks: ReturnType<typeof makeTrack>[] = []) {
  const stream = {
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks,
    getTracks: () => [...audioTracks, ...videoTracks],
    removeTrack: vi.fn(),
  };
  return stream;
}

let sendAudioChunk: ReturnType<typeof vi.fn>;
let logAudioEvent: ReturnType<typeof vi.fn>;
let systemStream: ReturnType<typeof makeStream>;
let micStream: ReturnType<typeof makeStream>;

beforeEach(() => {
  contexts = [];
  sinkSupport = 'honoured';
  sendAudioChunk = vi.fn();
  logAudioEvent = vi.fn();
  systemStream = makeStream([makeTrack('System Audio')]);
  micStream = makeStream([makeTrack('Headset Microphone')]);

  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('window', {
    electronAPI: {
      enableLoopbackAudio: vi.fn().mockResolvedValue(undefined),
      disableLoopbackAudio: vi.fn().mockResolvedValue(undefined),
      sendAudioChunk,
      logAudioEvent,
    },
  });
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getDisplayMedia: vi.fn().mockResolvedValue(systemStream),
      getUserMedia: vi.fn().mockResolvedValue(micStream),
    },
  });
});

afterEach(async () => {
  await audioCaptureService.stopCapture();
  vi.unstubAllGlobals();
});

/** The single AudioContext the service built, with its nodes. */
function graph() {
  expect(contexts).toHaveLength(1);
  const ctx = contexts[0];
  const merger = ctx.mergers[0];
  const processor = ctx.processors[0];
  // The gains are created system-first, then mic (see startCapture steps 6/7).
  const [systemGain, micGain] = ctx.gains;
  return { ctx, merger, processor, systemGain, micGain };
}

/** Fire one audio callback with the given per-channel float samples. */
function fireCallback(mic: number[], system: number[]): void {
  const channels = [Float32Array.from(mic), Float32Array.from(system)];
  graph().processor.onaudioprocess!({ inputBuffer: { getChannelData: (ch: number) => channels[ch] } });
}

/** The Int16 samples of the last message's named channel. */
function lastChunk(channel: 'mixed' | 'mic' | 'system'): Int16Array | null {
  const payload = sendAudioChunk.mock.calls.at(-1)![0];
  const buffer = payload[channel];
  return buffer === null ? null : new Int16Array(buffer);
}

describe('audioCaptureService — two-channel graph', () => {
  it('routes mic to merger input 0 and system to input 1, into one 2-in/1-out processor', async () => {
    await audioCaptureService.startCapture(true);
    const { merger, processor, systemGain, micGain } = graph();

    expect(merger.numberOfInputs).toBe(2);
    expect(micGain.connectionTo(merger)?.input).toBe(0);
    expect(systemGain.connectionTo(merger)?.input).toBe(1);

    // One processor, fed by the merger — not two processors on two clocks.
    expect(merger.connectionTo(processor)).toBeDefined();
    expect(processor.bufferSize).toBe(BUFFER_SIZE);
    expect(processor.numberOfInputChannels).toBe(2);
    expect(processor.numberOfOutputChannels).toBe(1);
  });

  it('sends one message per callback whose mixed channel is mic + system sample-wise', async () => {
    await audioCaptureService.startCapture(true);
    // Negative samples so the Int16 conversion (s * 0x8000) is exact for these
    // k/32768 values and the sum can be asserted without a rounding allowance.
    fireCallback([-0.25, -0.5, -0.125], [-0.5, -0.25, -0.75]);

    expect(sendAudioChunk).toHaveBeenCalledTimes(1);
    const mic = lastChunk('mic')!;
    const system = lastChunk('system')!;
    const mixed = lastChunk('mixed')!;

    expect([...mic]).toEqual([-8192, -16384, -4096]);
    expect([...system]).toEqual([-16384, -8192, -24576]);
    expect([...mixed]).toEqual([...mic].map((v, i) => v + system[i]));
  });

  it('sends a null mic channel when the microphone is off', async () => {
    await audioCaptureService.startCapture(false);
    fireCallback([0, 0, 0], [-0.5, -0.25, -0.75]);

    expect(lastChunk('mic')).toBeNull();
    // With no mic connected the merger's channel 0 is silence, so the mono sum
    // is the system audio — the mixed-only path main already knows.
    expect([...lastChunk('mixed')!]).toEqual([...lastChunk('system')!]);
  });

  it('computes the level meter from the mixed sum, not from a single channel', async () => {
    await audioCaptureService.startCapture(true);
    const levels: number[] = [];
    audioCaptureService.onAudioLevel((level) => levels.push(level));

    // Each channel is loud on its own, but they cancel: a meter reading either
    // channel alone would show a strong signal here.
    fireCallback([0.5, -0.5, 0.5], [-0.5, 0.5, -0.5]);
    expect(levels).toEqual([0]);

    fireCallback([0.5, -0.5, 0.5], [0.5, -0.5, 0.5]);
    expect(levels[1]).toBeGreaterThan(0);
  });
});

describe('audioCaptureService — capture events (AUDIO-DEVICE.1)', () => {
  /** The events logged so far, optionally narrowed to one kind. */
  const events = (kind?: string) =>
    logAudioEvent.mock.calls.map((c) => c[0]).filter((e) => kind === undefined || e.kind === kind);

  it('reports the capture start once, with both device labels and the sink', async () => {
    await audioCaptureService.startCapture(true);

    expect(events()).toEqual([
      {
        kind: 'capture-started',
        channel: null,
        detail: 'mic="Headset Microphone" system="System Audio" sink=none',
      },
    ]);
  });

  it('says why there is no mic when the microphone cannot be opened', async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new DOMException('gone', 'NotFoundError'));
    await audioCaptureService.startCapture(true);

    expect(events('capture-started')[0].detail).toContain('mic=unavailable error=NotFoundError');
  });

  it('reports a mic mute and unmute as one event each', async () => {
    await audioCaptureService.startCapture(true);
    const micTrack = micStream.getAudioTracks()[0];

    micTrack.onmute!();
    micTrack.onunmute!();

    expect(events('track-muted')).toEqual([
      { kind: 'track-muted', channel: 'mic', detail: 'label="Headset Microphone"' },
    ]);
    expect(events('track-unmuted')).toEqual([
      { kind: 'track-unmuted', channel: 'mic', detail: 'label="Headset Microphone"' },
    ]);
  });

  it('reports the system track ending as one event, and still tells the UI', async () => {
    await audioCaptureService.startCapture(true);
    const onInterrupted = vi.fn();
    audioCaptureService.onAudioInterrupted(onInterrupted);

    systemStream.getAudioTracks()[0].onended!();

    expect(events('track-ended')).toEqual([{ kind: 'track-ended', channel: 'system', detail: 'label="System Audio"' }]);
    expect(onInterrupted).toHaveBeenCalledWith('system', false);
  });

  it('never lets a throwing logAudioEvent break startCapture or onaudioprocess', async () => {
    logAudioEvent.mockImplementation(() => {
      throw new Error('ipc down');
    });

    await expect(audioCaptureService.startCapture(true)).resolves.toBeUndefined();
    expect(() => fireCallback([-0.25], [-0.5])).not.toThrow();
    expect(sendAudioChunk).toHaveBeenCalledTimes(1);

    // And the same for a track event raised mid-capture.
    expect(() => micStream.getAudioTracks()[0].onmute!()).not.toThrow();
  });
});

describe('audioCaptureService — output sink (AUDIO-DEVICE.1)', () => {
  const events = (kind: string) => logAudioEvent.mock.calls.map((c) => c[0]).filter((e) => e.kind === kind);

  it('creates the capture context with no output sink when the runtime supports it', async () => {
    await audioCaptureService.startCapture(true);

    expect(contexts).toHaveLength(1);
    expect(contexts[0].options).toEqual({ sampleRate: 16000, sinkId: { type: 'none' } });
    expect(events('sink-fallback')).toEqual([]);
  });

  it('still starts and captures on the default sink when the runtime throws on sinkId', async () => {
    sinkSupport = 'throws';

    await expect(audioCaptureService.startCapture(true)).resolves.toBeUndefined();
    fireCallback([-0.25], [-0.5]);

    expect(contexts[0].options).toEqual({ sampleRate: 16000 });
    expect(sendAudioChunk).toHaveBeenCalledTimes(1);
    expect(events('sink-fallback')).toEqual([
      { kind: 'sink-fallback', channel: null, detail: 'error=NotSupportedError' },
    ]);
    expect(events('capture-started')[0].detail).toMatch(/ sink=default$/);
  });
});

describe('audioCaptureService — device reconnect (AUDIO-DEVICE.1)', () => {
  type Device = { deviceId: string; label: string; kind: 'audioinput' | 'audiooutput' };
  const input = (deviceId: string, label: string): Device => ({ deviceId, label, kind: 'audioinput' });
  const output = (deviceId: string, label: string): Device => ({ deviceId, label, kind: 'audiooutput' });

  /** Headset off: the laptop mic and speakers are the OS defaults. */
  const LAPTOP = [
    input('default', 'Default - Laptop Mic'),
    input('laptop-mic', 'Laptop Mic'),
    output('default', 'Default - Speakers'),
    output('speakers', 'Speakers'),
  ];
  /** Headset on: listed, and the OS default both ways. */
  const HEADSET = [
    input('default', 'Default - Headset Microphone'),
    input('laptop-mic', 'Laptop Mic'),
    input('headset-mic', 'Headset Microphone'),
    output('default', 'Default - Headset'),
    output('speakers', 'Speakers'),
    output('headset', 'Headset'),
  ];
  /** LAPTOP, except the headset has become the default OUTPUT only. */
  const HEADSET_OUTPUT = [
    ...LAPTOP.filter((d) => d.kind === 'audioinput'),
    output('default', 'Default - Headset'),
    output('speakers', 'Speakers'),
    output('headset', 'Headset'),
  ];

  let devices: Device[];
  let listeners: Set<() => void>;
  let mediaDevices: Record<string, ReturnType<typeof vi.fn>>;
  let onInterrupted = vi.fn<(type: 'mic' | 'system', recovered: boolean) => void>();

  const events = (kind: string) => logAudioEvent.mock.calls.map((c) => c[0]).filter((e) => e.kind === kind);
  const fireDeviceChange = () => listeners.forEach((fn) => fn());
  /** What the browser does when a device goes away: the track ends, then 'ended' fires. */
  const endTrack = (track: ReturnType<typeof makeTrack>) => {
    track.readyState = 'ended';
    track.onended!();
  };

  async function start(chosenMicId?: string) {
    await audioCaptureService.startCapture(true, chosenMicId);
    audioCaptureService.onAudioInterrupted(onInterrupted);
    await vi.advanceTimersByTimeAsync(0); // the watcher's first device snapshot
  }

  beforeEach(() => {
    vi.useFakeTimers();
    devices = HEADSET;
    listeners = new Set();
    onInterrupted = vi.fn();
    mediaDevices = navigator.mediaDevices as unknown as Record<string, ReturnType<typeof vi.fn>>;
    mediaDevices.enumerateDevices = vi.fn(async () => devices);
    mediaDevices.addEventListener = vi.fn((_type: string, fn: () => void) => listeners.add(fn));
    mediaDevices.removeEventListener = vi.fn((_type: string, fn: () => void) => listeners.delete(fn));
    // The capture start gets `systemStream`; every re-acquisition gets a fresh stream.
    mediaDevices.getDisplayMedia = vi
      .fn()
      .mockResolvedValueOnce(systemStream)
      .mockImplementation(async () => makeStream([makeTrack('System Audio')]));
  });

  afterEach(async () => {
    await audioCaptureService.stopCapture();
    vi.useRealTimers();
  });

  it('waits for a chosen mic that dropped, then re-acquires it once when its id is back', async () => {
    await start('headset-mic');
    const getUserMedia = mediaDevices.getUserMedia;
    getUserMedia.mockClear();
    const droppedTrack = micStream.getAudioTracks()[0];

    devices = LAPTOP; // the headset powers off
    endTrack(droppedTrack);
    fireDeviceChange();
    await vi.advanceTimersByTimeAsync(3 * BACKSTOP_INTERVAL_MS); // the debounced check + three backstop checks

    expect(onInterrupted).toHaveBeenCalledWith('mic', false);
    expect(getUserMedia).not.toHaveBeenCalled();
    fireCallback([-0.25], [-0.5]);
    expect(lastChunk('mic')).toBeNull();

    const back = makeStream([makeTrack('Headset Microphone')]);
    getUserMedia.mockResolvedValueOnce(back);
    devices = HEADSET; // the headset is back
    fireDeviceChange();
    await vi.advanceTimersByTimeAsync(DEVICE_CHANGE_DEBOUNCE_MS);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0].audio.deviceId).toEqual({ exact: 'headset-mic' });
    expect(onInterrupted).toHaveBeenCalledWith('mic', true);
    expect(droppedTrack.stop).toHaveBeenCalled();
    fireCallback([-0.25], [-0.5]);
    expect([...lastChunk('mic')!]).toEqual([-8192]);

    await vi.advanceTimersByTimeAsync(3 * BACKSTOP_INTERVAL_MS);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('never opens the default or laptop mic while the chosen mic is absent, even from the start', async () => {
    devices = LAPTOP; // the headset is off when the recording starts
    mediaDevices.getUserMedia.mockRejectedValueOnce(new DOMException('not found', 'NotFoundError'));
    await start('headset-mic');

    for (let i = 0; i < 3; i++) {
      fireDeviceChange();
      await vi.advanceTimersByTimeAsync(BACKSTOP_INTERVAL_MS);
    }
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1); // only the start's own attempt
    fireCallback([-0.25], [-0.5]);
    expect(lastChunk('mic')).toBeNull();

    devices = HEADSET;
    fireDeviceChange();
    await vi.advanceTimersByTimeAsync(DEVICE_CHANGE_DEBOUNCE_MS);

    expect(onInterrupted).toHaveBeenCalledWith('mic', true);
    // Every mic open asked for the chosen device, exactly: never the default, never the laptop mic.
    const asked = mediaDevices.getUserMedia.mock.calls.map(([constraints]) => constraints.audio.deviceId);
    expect(asked).toEqual([{ exact: 'headset-mic' }, { exact: 'headset-mic' }]);
  });

  it('re-acquires an ended system track through loopback on the next check, disabling loopback even when getDisplayMedia throws', async () => {
    await start();
    const enable = vi.mocked(window.electronAPI.enableLoopbackAudio);
    const disable = vi.mocked(window.electronAPI.disableLoopbackAudio);
    const getDisplayMedia = mediaDevices.getDisplayMedia;
    enable.mockClear();
    disable.mockClear();
    getDisplayMedia.mockClear();
    const fresh = makeStream([makeTrack('Headset')], [makeTrack('screen')]);
    getDisplayMedia.mockRejectedValueOnce(new DOMException('busy', 'NotReadableError')).mockResolvedValueOnce(fresh);
    const onAudioProcess = graph().processor.onaudioprocess;
    const lostTrack = systemStream.getAudioTracks()[0];

    endTrack(lostTrack);
    expect(onInterrupted).toHaveBeenCalledWith('system', false);
    expect(getDisplayMedia).not.toHaveBeenCalled(); // nothing until the next check
    fireCallback([-0.25], [0]);
    expect(lastChunk('system')).not.toBeNull(); // the recording keeps going, with silence on system

    await vi.advanceTimersByTimeAsync(BACKSTOP_INTERVAL_MS);
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(disable).toHaveBeenCalledTimes(1); // also after the throw
    expect(events('reacquire-failed')).toEqual([
      { kind: 'reacquire-failed', channel: 'system', detail: 'error=NotReadableError' },
    ]);

    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    expect(getDisplayMedia).toHaveBeenCalledTimes(2);
    // Each attempt: enable -> getDisplayMedia (the loopback request, no picker options) -> disable.
    for (const i of [0, 1]) {
      expect(getDisplayMedia.mock.calls[i][0]).toEqual({ video: true, audio: true });
      expect(enable.mock.invocationCallOrder[i]).toBeLessThan(getDisplayMedia.mock.invocationCallOrder[i]);
      expect(getDisplayMedia.mock.invocationCallOrder[i]).toBeLessThan(disable.mock.invocationCallOrder[i]);
    }
    expect(onInterrupted).toHaveBeenCalledWith('system', true);
    expect(events('reacquire-ok')).toEqual([{ kind: 'reacquire-ok', channel: 'system', detail: 'label="Headset"' }]);
    // The new source feeds the same gain node, then the old track is stopped; the processor is untouched.
    expect(graph().ctx.sources.get(fresh)!.connectionTo(graph().systemGain)).toBeDefined();
    expect(lostTrack.stop).toHaveBeenCalled();
    expect(fresh.getVideoTracks()[0].stop).toHaveBeenCalled();
    expect(graph().processor.onaudioprocess).toBe(onAudioProcess);
  });

  it('re-acquires system audio exactly once when the default output switches, and nothing on an unrelated change', async () => {
    devices = LAPTOP;
    await start();
    mediaDevices.getUserMedia.mockClear();
    mediaDevices.getDisplayMedia.mockClear();

    devices = [...LAPTOP, input('usb-mic', 'USB Mic')]; // plugged in, not the default
    fireDeviceChange();
    await vi.advanceTimersByTimeAsync(BACKSTOP_INTERVAL_MS);
    expect(mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();

    devices = HEADSET_OUTPUT; // both tracks stay live
    fireDeviceChange();
    await vi.advanceTimersByTimeAsync(3 * BACKSTOP_INTERVAL_MS);

    expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(events('default-changed')).toEqual([
      { kind: 'default-changed', channel: 'system', detail: 'from="Default - Speakers" to="Default - Headset"' },
    ]);
    expect(onInterrupted).not.toHaveBeenCalled(); // nothing was lost, so there is nothing to announce
  });

  it('keeps one re-acquisition in flight through a burst of device changes', async () => {
    devices = LAPTOP;
    await start();
    const enable = vi.mocked(window.electronAPI.enableLoopbackAudio);
    enable.mockClear();
    mediaDevices.getDisplayMedia.mockClear();
    let finishEnable!: () => void;
    enable.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishEnable = resolve;
        }),
    );

    devices = HEADSET_OUTPUT;
    for (let i = 0; i < 5; i++) fireDeviceChange();
    await vi.advanceTimersByTimeAsync(DEVICE_CHANGE_DEBOUNCE_MS);
    expect(enable).toHaveBeenCalledTimes(1); // the attempt now waits on the loopback switch

    for (let i = 0; i < 5; i++) fireDeviceChange();
    await vi.advanceTimersByTimeAsync(BACKSTOP_INTERVAL_MS); // a backstop check too, inside the attempt's timeout
    expect(enable).toHaveBeenCalledTimes(1);

    finishEnable();
    await vi.advanceTimersByTimeAsync(2 * BACKSTOP_INTERVAL_MS);
    expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(events('reacquire-attempt')).toHaveLength(1);
  });

  it('stops a pending retry on stopCapture: no further opens, no listener or timer left', async () => {
    await start('headset-mic');
    mediaDevices.getUserMedia.mockClear().mockRejectedValue(new DOMException('busy', 'NotReadableError'));
    mediaDevices.getDisplayMedia.mockClear();

    endTrack(micStream.getAudioTracks()[0]); // still listed, so the next check starts a retry series
    await vi.advanceTimersByTimeAsync(BACKSTOP_INTERVAL_MS);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(2); // the backstop poll + the pending retry

    await audioCaptureService.stopCapture();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
    const [[, handler]] = mediaDevices.addEventListener.mock.calls;
    expect(mediaDevices.removeEventListener).toHaveBeenCalledWith('devicechange', handler);
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases a mic stream that arrives after stopCapture instead of connecting it', async () => {
    await start('headset-mic');
    let deliver!: (stream: unknown) => void;
    mediaDevices.getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );

    endTrack(micStream.getAudioTracks()[0]);
    await vi.advanceTimersByTimeAsync(BACKSTOP_INTERVAL_MS); // the attempt now waits on getUserMedia
    await audioCaptureService.stopCapture();
    const late = makeStream([makeTrack('Headset Microphone')]);
    deliver(late);
    await vi.advanceTimersByTimeAsync(0);

    expect(late.getAudioTracks()[0].stop).toHaveBeenCalled();
    expect(contexts[0].sources.has(late)).toBe(false);
    expect(events('reacquire-ok')).toEqual([]);
  });

  it('skips getDisplayMedia when stopCapture lands during the loopback enable, and a new capture waits for that disable', async () => {
    await start();
    const enable = vi.mocked(window.electronAPI.enableLoopbackAudio);
    const disable = vi.mocked(window.electronAPI.disableLoopbackAudio);
    const getDisplayMedia = mediaDevices.getDisplayMedia;
    enable.mockClear();
    disable.mockClear();
    getDisplayMedia.mockClear();
    let finishEnable!: () => void;
    enable.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishEnable = resolve;
        }),
    );

    endTrack(systemStream.getAudioTracks()[0]);
    await vi.advanceTimersByTimeAsync(BACKSTOP_INTERVAL_MS); // the attempt now waits on the loopback enable
    await audioCaptureService.stopCapture(); // abandons the attempt: it disables loopback at once
    await audioCaptureService.startCapture(false); // a new recording, queued behind that disable

    expect(getDisplayMedia).toHaveBeenCalledTimes(1); // the new capture's only: the stale attempt skipped it
    expect(disable).toHaveBeenCalledTimes(2);
    // stale enable -> stale disable -> new enable -> getDisplayMedia -> new disable
    expect(disable.mock.invocationCallOrder[0]).toBeLessThan(enable.mock.invocationCallOrder[1]);
    expect(enable.mock.invocationCallOrder[1]).toBeLessThan(getDisplayMedia.mock.invocationCallOrder[0]);
    expect(getDisplayMedia.mock.invocationCallOrder[0]).toBeLessThan(disable.mock.invocationCallOrder[1]);
    expect(audioCaptureService.isCapturing()).toBe(true);

    finishEnable(); // the abandoned enable answering late changes nothing
    await vi.advanceTimersByTimeAsync(0);
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
  });

  it('re-acquires a chosen mic whose track stayed live when its id left and came back', async () => {
    await start('headset-mic');
    const getUserMedia = mediaDevices.getUserMedia;
    getUserMedia.mockClear();
    const silentTrack = micStream.getAudioTracks()[0]; // never ends: live, but the device is gone

    devices = LAPTOP; // the headset leaves...
    fireDeviceChange();
    await vi.advanceTimersByTimeAsync(DEVICE_CHANGE_DEBOUNCE_MS);
    expect(getUserMedia).not.toHaveBeenCalled();

    const back = makeStream([makeTrack('Headset Microphone')]);
    getUserMedia.mockResolvedValueOnce(back);
    devices = HEADSET; // ...and comes back
    fireDeviceChange();
    await vi.advanceTimersByTimeAsync(DEVICE_CHANGE_DEBOUNCE_MS);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0].audio.deviceId).toEqual({ exact: 'headset-mic' });
    expect(graph().ctx.sources.get(back)!.connectionTo(graph().micGain)).toBeDefined();
    expect(silentTrack.stop).toHaveBeenCalled();

    // Listed in both snapshots with a live track: nothing more is opened.
    fireDeviceChange();
    await vi.advanceTimersByTimeAsync(3 * BACKSTOP_INTERVAL_MS);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('times out a system re-acquisition that never answers, so loopback is free for the retry and a new capture', async () => {
    await start();
    const disable = vi.mocked(window.electronAPI.disableLoopbackAudio);
    const getDisplayMedia = mediaDevices.getDisplayMedia;
    disable.mockClear();
    getDisplayMedia.mockClear();
    let answerLate!: (stream: unknown) => void;
    getDisplayMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerLate = resolve;
        }),
    );

    endTrack(systemStream.getAudioTracks()[0]);
    await vi.advanceTimersByTimeAsync(BACKSTOP_INTERVAL_MS); // the attempt now hangs in getDisplayMedia
    await vi.advanceTimersByTimeAsync(REACQUIRE_TIMEOUT_MS - 1);
    expect(disable).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(events('reacquire-failed')).toEqual([
      { kind: 'reacquire-failed', channel: 'system', detail: 'error=TimeoutError' },
    ]);
    expect(disable).toHaveBeenCalledTimes(1);

    // The loopback queue is free again: the retry reaches getDisplayMedia and reconnects.
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    expect(getDisplayMedia).toHaveBeenCalledTimes(2);
    expect(onInterrupted).toHaveBeenCalledWith('system', true);

    // A new recording after Stop starts normally.
    await audioCaptureService.stopCapture();
    await audioCaptureService.startCapture(false);
    expect(getDisplayMedia).toHaveBeenCalledTimes(3);

    // The hung request answering at last: its stream is released, never connected.
    const late = makeStream([makeTrack('Late System Audio')], [makeTrack('screen')]);
    answerLate(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.getAudioTracks()[0].stop).toHaveBeenCalled();
    expect(contexts.some((ctx) => ctx.sources.has(late))).toBe(false);
  });

  it('keeps retrying a lost channel once per slow tick after its retry series is spent', async () => {
    await start('headset-mic');
    const t0 = Date.now();
    const advanceTo = (ms: number) => vi.advanceTimersByTimeAsync(t0 + ms - Date.now());
    const slowPeriod = SLOW_RETRY_EVERY_TICKS * BACKSTOP_INTERVAL_MS;
    const getUserMedia = mediaDevices.getUserMedia;
    getUserMedia.mockClear().mockRejectedValue(new DOMException('busy', 'NotReadableError'));

    endTrack(micStream.getAudioTracks()[0]); // still listed, but it cannot be opened yet
    await advanceTo(slowPeriod - 1);
    expect(getUserMedia).toHaveBeenCalledTimes(1 + RETRY_DELAYS_MS.length); // the spent series

    await advanceTo(slowPeriod);
    expect(getUserMedia).toHaveBeenCalledTimes(2 + RETRY_DELAYS_MS.length); // one slow attempt, no new series

    getUserMedia.mockResolvedValue(makeStream([makeTrack('Headset Microphone')]));
    await advanceTo(2 * slowPeriod - 1);
    expect(getUserMedia).toHaveBeenCalledTimes(2 + RETRY_DELAYS_MS.length);
    await advanceTo(2 * slowPeriod);
    expect(getUserMedia).toHaveBeenCalledTimes(3 + RETRY_DELAYS_MS.length);
    expect(onInterrupted).toHaveBeenLastCalledWith('mic', true);
    expect(events('reacquire-attempt').map((e) => e.detail)).toEqual([
      'attempt=1',
      'attempt=2',
      'attempt=3',
      'attempt=4',
      'attempt=slow',
      'attempt=slow',
    ]);
    fireCallback([-0.25], [-0.5]);
    expect(lastChunk('mic')).not.toBeNull();

    await audioCaptureService.stopCapture();
    await vi.advanceTimersByTimeAsync(3 * slowPeriod);
    expect(getUserMedia).toHaveBeenCalledTimes(3 + RETRY_DELAYS_MS.length);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('watches a re-acquired mic track: its mute is reported, and its own end silences the channel again', async () => {
    await start();
    const recovered = makeTrack('Backup Microphone');
    mediaDevices.getUserMedia.mockResolvedValueOnce(makeStream([recovered]));

    endTrack(micStream.getAudioTracks()[0]);
    await vi.advanceTimersByTimeAsync(BACKSTOP_INTERVAL_MS);
    expect(events('reacquire-ok')).toEqual([
      { kind: 'reacquire-ok', channel: 'mic', detail: 'label="Backup Microphone"' },
    ]);

    recovered.onmute!();
    expect(events('track-muted')).toEqual([
      { kind: 'track-muted', channel: 'mic', detail: 'label="Backup Microphone"' },
    ]);

    endTrack(recovered);
    expect(events('track-ended').at(-1)).toEqual({
      kind: 'track-ended',
      channel: 'mic',
      detail: 'label="Backup Microphone"',
    });
    expect(onInterrupted).toHaveBeenLastCalledWith('mic', false);
    fireCallback([-0.25], [-0.5]);
    expect(lastChunk('mic')).toBeNull();
  });

  it('logs each attempt, and a failed one with the error name only', async () => {
    await start();
    mediaDevices.getUserMedia.mockRejectedValueOnce(new DOMException('gone', 'NotFoundError'));

    endTrack(micStream.getAudioTracks()[0]);
    await vi.advanceTimersByTimeAsync(BACKSTOP_INTERVAL_MS);

    expect(events('track-ended')).toEqual([
      { kind: 'track-ended', channel: 'mic', detail: 'label="Headset Microphone"' },
    ]);
    expect(events('reacquire-attempt')).toEqual([{ kind: 'reacquire-attempt', channel: 'mic', detail: 'attempt=1' }]);
    expect(events('reacquire-failed')).toEqual([
      { kind: 'reacquire-failed', channel: 'mic', detail: 'error=NotFoundError' },
    ]);
  });
});

describe('enumerateAudioDevices', () => {
  const labelled = [
    { deviceId: 'mic-1', label: 'Headset Microphone', kind: 'audioinput' },
    { deviceId: 'spk-1', label: 'Headset Speakers', kind: 'audiooutput' },
  ];
  const unlabelled = labelled.map((d) => ({ ...d, label: '' }));

  it('does not open the microphone when labels are already visible', async () => {
    const mediaDevices = navigator.mediaDevices as unknown as Record<string, ReturnType<typeof vi.fn>>;
    mediaDevices.enumerateDevices = vi.fn().mockResolvedValue(labelled);

    const devices = await audioCaptureService.enumerateAudioDevices();

    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(devices.map((d) => d.label)).toEqual(['Headset Microphone', 'Headset Speakers']);
  });

  it('opens one temporary stream only while labels are empty, stops it, then re-enumerates', async () => {
    const mediaDevices = navigator.mediaDevices as unknown as Record<string, ReturnType<typeof vi.fn>>;
    mediaDevices.enumerateDevices = vi.fn().mockResolvedValueOnce(unlabelled).mockResolvedValueOnce(labelled);

    const devices = await audioCaptureService.enumerateAudioDevices();

    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(micStream.getAudioTracks()[0].stop).toHaveBeenCalled();
    expect(mediaDevices.enumerateDevices).toHaveBeenCalledTimes(2);
    expect(devices.map((d) => d.label)).toEqual(['Headset Microphone', 'Headset Speakers']);
  });
});
