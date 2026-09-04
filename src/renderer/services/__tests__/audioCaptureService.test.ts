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
//   - the level meter reads the MIXED sum, not one channel.
//
// The Web Audio API and window.electronAPI are faked; the real capture service
// runs. Node environment: this module touches no DOM, only globals.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as audioCaptureService from '../audioCaptureService';

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

  constructor(public options: { sampleRate: number }) {
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
    return Promise.resolve();
  }
}

let contexts: FakeAudioContext[] = [];

function makeTrack() {
  return { onended: null as null | (() => void), stop: vi.fn() };
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
let systemStream: ReturnType<typeof makeStream>;
let micStream: ReturnType<typeof makeStream>;

beforeEach(() => {
  contexts = [];
  sendAudioChunk = vi.fn();
  systemStream = makeStream();
  micStream = makeStream();

  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('window', {
    electronAPI: {
      enableLoopbackAudio: vi.fn().mockResolvedValue(undefined),
      disableLoopbackAudio: vi.fn().mockResolvedValue(undefined),
      sendAudioChunk,
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
