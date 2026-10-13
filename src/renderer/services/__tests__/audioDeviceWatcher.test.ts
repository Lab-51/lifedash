// === FILE PURPOSE ===
// Unit tests for audioDeviceWatcher (AUDIO-DEVICE.1 Task 3): the PURE rules that
// decide which capture channel to re-acquire after a device change, and the
// driver's bounded retries. The capture-level behaviour (getUserMedia /
// getDisplayMedia calls, chunks, callbacks, stop races) is pinned in
// audioCaptureService.test.ts against the real service.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BACKSTOP_INTERVAL_MS,
  DEVICE_CHANGE_DEBOUNCE_MS,
  RETRY_DELAYS_MS,
  decideReacquire,
  startDeviceWatcher,
  type DeviceSnapshot,
  type ReacquireInput,
} from '../audioDeviceWatcher';

const entries = (pairs: [string, string][]) => pairs.map(([deviceId, label]) => ({ deviceId, label }));

/** Headset off: the laptop mic and speakers are the OS defaults. */
const LAPTOP: DeviceSnapshot = {
  inputs: entries([
    ['default', 'Default - Laptop Mic'],
    ['laptop-mic', 'Laptop Mic'],
  ]),
  outputs: entries([
    ['default', 'Default - Speakers'],
    ['speakers', 'Speakers'],
  ]),
};

/** Headset on: it is listed and is the OS default both ways. */
const HEADSET: DeviceSnapshot = {
  inputs: entries([
    ['default', 'Default - Headset Mic'],
    ['laptop-mic', 'Laptop Mic'],
    ['headset-mic', 'Headset Mic'],
  ]),
  outputs: entries([
    ['default', 'Default - Headset'],
    ['speakers', 'Speakers'],
    ['headset', 'Headset'],
  ]),
};

/** HEADSET plus a USB mic that is not the default: an unrelated change. */
const HEADSET_PLUS_USB: DeviceSnapshot = {
  ...HEADSET,
  inputs: [...HEADSET.inputs, { deviceId: 'usb-mic', label: 'USB Mic' }],
};

/** HEADSET, except the OS default input has moved to the laptop mic. */
const HEADSET_LAPTOP_DEFAULT_INPUT: DeviceSnapshot = {
  ...HEADSET,
  inputs: HEADSET.inputs.map((d) => (d.deviceId === 'default' ? { ...d, label: 'Default - Laptop Mic' } : d)),
};

describe('decideReacquire — which channels to re-open', () => {
  const base: ReacquireInput = {
    previous: HEADSET,
    current: HEADSET,
    chosenMicId: undefined,
    mic: 'live',
    system: 'live',
  };

  it.each<[string, Partial<ReacquireInput>, string[]]>([
    [
      'chosen mic ended and still absent: nothing, even though the default input changed',
      { previous: HEADSET, current: LAPTOP, chosenMicId: 'headset-mic', mic: 'ended' },
      // (the default OUTPUT changed too, so system is re-opened -- never the mic)
      ['system'],
    ],
    ['chosen mic ended and its id is present again', { chosenMicId: 'headset-mic', mic: 'ended' }, ['mic']],
    [
      'chosen mic never opened, its id appears',
      { previous: LAPTOP, current: HEADSET, chosenMicId: 'headset-mic', mic: 'missing', system: 'ended' },
      ['mic', 'system'],
    ],
    [
      'chosen mic live while the default input switches: the chosen mic is kept',
      { previous: HEADSET, current: HEADSET_LAPTOP_DEFAULT_INPUT, chosenMicId: 'headset-mic' },
      [],
    ],
    [
      'chosen mic live, its id left and came back (a live but silent track)',
      { previous: LAPTOP, current: { ...HEADSET, outputs: LAPTOP.outputs }, chosenMicId: 'headset-mic' },
      ['mic'],
    ],
    [
      'chosen mic live and listed, no previous snapshot: no round trip is inferred',
      { previous: null, current: HEADSET, chosenMicId: 'headset-mic' },
      [],
    ],
    ['default-following mic ended while an input exists', { mic: 'ended' }, ['mic']],
    [
      'default-following mic live while the default input switches',
      { previous: LAPTOP, current: { ...HEADSET, outputs: LAPTOP.outputs } },
      ['mic'],
    ],
    [
      "the 'default' entry chosen explicitly follows the default too",
      { previous: LAPTOP, current: { ...HEADSET, outputs: LAPTOP.outputs }, chosenMicId: 'default' },
      ['mic'],
    ],
    ['mic off: never re-opened', { previous: LAPTOP, current: HEADSET, mic: 'off' }, ['system']],
    ['system ended', { system: 'ended' }, ['system']],
    [
      'system live while the default output switches',
      { previous: LAPTOP, current: { ...LAPTOP, outputs: HEADSET.outputs } },
      ['system'],
    ],
    [
      'unrelated change (a non-default device added, tracks live)',
      { previous: HEADSET, current: HEADSET_PLUS_USB },
      [],
    ],
    ['no previous snapshot: no default switch can be seen', { previous: null, current: LAPTOP }, []],
  ])('%s', (_name, overrides, expected) => {
    expect(decideReacquire({ ...base, ...overrides })).toEqual(expected);
  });
});

describe('startDeviceWatcher — bounded retries', () => {
  let devices: { deviceId: string; label: string; kind: string }[];
  let listeners: Set<() => void>;
  let logAudioEvent: ReturnType<typeof vi.fn>;

  const asDevices = (snapshot: DeviceSnapshot) => [
    ...snapshot.inputs.map((d) => ({ ...d, kind: 'audioinput' })),
    ...snapshot.outputs.map((d) => ({ ...d, kind: 'audiooutput' })),
  ];
  const events = (kind: string) => logAudioEvent.mock.calls.map((c) => c[0]).filter((e) => e.kind === kind);

  beforeEach(() => {
    vi.useFakeTimers();
    devices = asDevices(HEADSET);
    listeners = new Set();
    logAudioEvent = vi.fn();
    vi.stubGlobal('window', { electronAPI: { logAudioEvent } });
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: vi.fn(async () => devices),
        addEventListener: vi.fn((_type: string, fn: () => void) => listeners.add(fn)),
        removeEventListener: vi.fn((_type: string, fn: () => void) => listeners.delete(fn)),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries a failed re-acquisition with backoff, then waits for the device list to change', async () => {
    const reacquire = vi.fn().mockResolvedValue({ ok: false, detail: 'error=NotReadableError' });
    const watcher = startDeviceWatcher({
      chosenMicId: undefined,
      channelStates: () => ({ mic: 'off', system: 'ended' }),
      reacquire,
      onRecovered: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(BACKSTOP_INTERVAL_MS);
    expect(reacquire).toHaveBeenCalledTimes(1);

    // Each retry waits its own delay -- not a moment less.
    for (const [i, delay] of RETRY_DELAYS_MS.entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(reacquire).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(reacquire).toHaveBeenCalledTimes(i + 2);
    }
    expect(events('reacquire-attempt').map((e) => e.detail)).toEqual([
      'attempt=1',
      'attempt=2',
      'attempt=3',
      'attempt=4',
    ]);
    expect(events('reacquire-failed')).toHaveLength(4);

    // The series is spent: later (non-slow) checks over the same device list try nothing.
    await vi.advanceTimersByTimeAsync(BACKSTOP_INTERVAL_MS * 3);
    expect(reacquire).toHaveBeenCalledTimes(4);

    // A changed device list starts a new series.
    devices = asDevices(HEADSET_PLUS_USB);
    listeners.forEach((fn) => fn());
    await vi.advanceTimersByTimeAsync(DEVICE_CHANGE_DEBOUNCE_MS);
    expect(reacquire).toHaveBeenCalledTimes(5);
    expect(events('device-change')).toEqual([
      { kind: 'device-change', channel: null, detail: 'added=["USB Mic"] removed=[]' },
    ]);

    watcher.stop();
  });
});
