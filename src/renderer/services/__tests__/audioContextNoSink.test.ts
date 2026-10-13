// === FILE PURPOSE ===
// Unit tests for createCaptureContext (AUDIO-DEVICE.1 Task 2): the capture
// context asks for a 'none' output sink, verifies the runtime actually applied
// it, and otherwise falls back to the plain default-sink context -- never
// failing a recording or voice-input start because of the sink.
//
// AudioContext is faked: the helper touches only its constructor, `sinkId`
// and `close`. Node environment.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCaptureContext } from '../audioContextNoSink';

type SinkRuntime = 'honours' | 'ignores' | 'throws';

let created: FakeAudioContext[] = [];
let runtime: SinkRuntime = 'honours';

class FakeAudioContext {
  sinkId: unknown = '';
  close = vi.fn().mockResolvedValue(undefined);

  constructor(public options: { sampleRate: number; sinkId?: { type: 'none' } }) {
    if (options.sinkId && runtime === 'throws') throw new DOMException('no sinkId', 'NotSupportedError');
    if (options.sinkId && runtime === 'honours') this.sinkId = options.sinkId;
    created.push(this);
  }
}

beforeEach(() => {
  created = [];
  runtime = 'honours';
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createCaptureContext', () => {
  it("requests a 'none' sink at the given rate and reports it when the runtime honours it", () => {
    const result = createCaptureContext(16000);

    expect(result.sink).toBe('none');
    expect(result.fallbackReason).toBeUndefined();
    expect(created).toHaveLength(1);
    expect(created[0].options).toEqual({ sampleRate: 16000, sinkId: { type: 'none' } });
    expect(result.ctx).toBe(created[0]);
  });

  it('falls back to a default-sink context, naming the error, when the constructor throws', () => {
    runtime = 'throws';

    const result = createCaptureContext(16000);

    expect(result.sink).toBe('default');
    expect(result.fallbackReason).toBe('error=NotSupportedError');
    expect(result.ctx).toBe(created[0]);
    expect(created[0].options).toEqual({ sampleRate: 16000 });
  });

  it("closes the discarded context and falls back when the runtime ignores the 'none' sink", () => {
    runtime = 'ignores';

    const result = createCaptureContext(16000);

    expect(result.sink).toBe('default');
    expect(result.fallbackReason).toBe('sink-not-honoured');
    expect(created).toHaveLength(2);
    expect(created[0].close).toHaveBeenCalledTimes(1);
    expect(result.ctx).toBe(created[1]);
    expect(created[1].options).toEqual({ sampleRate: 16000 });
  });
});
