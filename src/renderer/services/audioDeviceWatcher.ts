// === FILE PURPOSE ===
// Brings a running capture's mic and system audio back after a device drops and
// returns (AUDIO-DEVICE.1) -- e.g. a Bluetooth headset power-cycled mid-call -- so
// the recording carries on instead of needing a new session.
//   - decideReacquire: the PURE rules for which channels to re-open, given the
//     previous and current device snapshot and each channel's state.
//   - startDeviceWatcher: the driver audioCaptureService runs while capturing.
//     Checks on 'devicechange' (debounced) and on a backstop poll, runs at most
//     ONE re-acquisition at a time with bounded retries, and does nothing after stop().
//   - openSystemAudio / releaseStream: acquisition helpers shared by the capture
//     start and by re-acquisition.
//
// === DEPENDENCIES ===
// navigator.mediaDevices (enumerateDevices, 'devicechange', getDisplayMedia),
// window.electronAPI (enable/disableLoopbackAudio), audioCaptureEvents
//
// === LIMITATIONS ===
// - A CHOSEN mic is matched by deviceId only (user decision: wait for it and open
//   nothing else meanwhile). A device that came back under a new id is waited for
//   forever; the device-change log line names what was added, which shows that case.
// - 'devicechange' delivery for a default-device switch is unverified, hence the
//   backstop poll. The OS default is read from Chromium's 'default' entry; without
//   one, a default switch is not detected.
// - Retries are bounded per device set: after a failed series a channel is tried
//   again only once the device list (or the channel's state) changes.

import type { AudioCaptureChannel } from '../../shared/types';
import { emitAudioEvent, trackLabel } from './audioCaptureEvents';

/** A capture channel's track: capturing, ended by the device, or not there at all. */
export type ChannelState = 'live' | 'ended' | 'missing';
/** The mic can also be 'off': not requested for this capture, so never re-acquired. */
export type MicState = ChannelState | 'off';

export interface DeviceEntry {
  deviceId: string;
  label: string;
}

export interface DeviceSnapshot {
  inputs: DeviceEntry[];
  outputs: DeviceEntry[];
}

export interface ReacquireInput {
  /** The snapshot from the previous check; null before the first one (no default switch can be seen). */
  previous: DeviceSnapshot | null;
  current: DeviceSnapshot;
  /** The mic chosen in Settings; undefined (or Chromium's 'default' entry) follows the OS default. */
  chosenMicId: string | undefined;
  mic: MicState;
  system: ChannelState;
}

/** One re-acquisition attempt's result; `detail` is the new device's label or the error name, for the log. */
export interface ReacquireOutcome {
  ok: boolean;
  detail: string;
}

export interface DeviceWatcherDeps {
  chosenMicId: string | undefined;
  /** Each channel's state right now. */
  channelStates: () => { mic: MicState; system: ChannelState };
  /**
   * One attempt to re-open a channel. Resolves null when the capture stopped meanwhile.
   * `signal` aborts when the attempt times out or the watcher stops: whatever it opens
   * after that must be released, never connected.
   */
  reacquire: (channel: AudioCaptureChannel, signal: AbortSignal) => Promise<ReacquireOutcome | null>;
  /** A channel that had been lost is capturing again. */
  onRecovered: (channel: AudioCaptureChannel) => void;
}

export interface DeviceWatcher {
  /** Remove every listener and timer; no re-acquisition starts afterwards. */
  stop: () => void;
}

export const DEVICE_CHANGE_DEBOUNCE_MS = 1500;
export const BACKSTOP_INTERVAL_MS = 10_000;
/** Waits before the 2nd, 3rd and 4th attempt: a returning device can enumerate before it opens. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000];
/** An attempt with no answer by then fails: getDisplayMedia can hang when main finds no capture source. */
export const REACQUIRE_TIMEOUT_MS = 15_000;
/** After a spent retry series, a still-lost channel gets one attempt every this many backstop ticks (~60 s). */
export const SLOW_RETRY_EVERY_TICKS = 6;

/** Label of Chromium's 'default' entry, which names the device the OS default currently is. */
function defaultLabel(devices: DeviceEntry[]): string | null {
  return devices.find((d) => d.deviceId === 'default')?.label ?? null;
}

const isLost = (state: MicState): boolean => state === 'ended' || state === 'missing';

/**
 * Which channels to re-acquire now. Rules:
 * - chosen mic: only when that id is present AND either its track is ended/missing or
 *   the id was absent from the previous snapshot (it left and came back; a Bluetooth
 *   headset can leave a live but silent track behind) -- nothing else is ever opened
 *   in its place;
 * - mic following the default: when ended/missing and any input exists, or when the
 *   default input changed;
 * - system: when ended/missing, or when the default output changed.
 * Anything else (labels unchanged, tracks live) re-acquires nothing.
 */
export function decideReacquire({
  previous,
  current,
  chosenMicId,
  mic,
  system,
}: ReacquireInput): AudioCaptureChannel[] {
  const defaultChanged = (kind: keyof DeviceSnapshot) =>
    previous !== null && defaultLabel(previous[kind]) !== defaultLabel(current[kind]);
  const listed = (snapshot: DeviceSnapshot) => snapshot.inputs.some((d) => d.deviceId === chosenMicId);
  const channels: AudioCaptureChannel[] = [];

  if (mic !== 'off') {
    const followsDefault = !chosenMicId || chosenMicId === 'default';
    const wanted = followsDefault
      ? (isLost(mic) && current.inputs.length > 0) || defaultChanged('inputs')
      : listed(current) && (isLost(mic) || (previous !== null && !listed(previous)));
    if (wanted) channels.push('mic');
  }
  if (isLost(system) || defaultChanged('outputs')) channels.push('system');
  return channels;
}

/** Stop a stream's tracks after detaching their handlers. */
export function releaseStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => {
    track.onended = null;
    track.onmute = null;
    track.onunmute = null;
    track.stop();
  });
}

/** The state of a stream's audio track, as the decision rules see it. */
export function streamState(stream: MediaStream | null): ChannelState {
  const track = stream?.getAudioTracks()[0];
  if (!track) return 'missing';
  return track.readyState === 'ended' ? 'ended' : 'live';
}

/**
 * Settles like `promise`, or rejects with `signal.reason` as soon as `signal` aborts;
 * a value that arrives after the abort is handed to `onLate` (e.g. to release it).
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal, onLate: (value: T) => void = () => {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) onLate(value);
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

// The loopback switch is ONE display-media handler in main. Calls are queued so a
// stale attempt's disable can never land between another caller's enable and its
// getDisplayMedia (which would fail that capture).
let loopbackQueue: Promise<unknown> = Promise.resolve();

/**
 * Open system audio: enable loopback -> getDisplayMedia (video dropped) -> disable
 * loopback, which runs on every path, errors included. Resolves null, without
 * calling getDisplayMedia, when `isCurrent` turns false during the enable.
 * Re-acquisitions pass `signal`: once it aborts the call rejects at once, so a
 * getDisplayMedia that never answers cannot hold the queue; a stream it delivers
 * later is released. The capture start passes none and waits as before.
 */
export function openSystemAudio(
  isCurrent: () => boolean = () => true,
  signal?: AbortSignal,
): Promise<MediaStream | null> {
  const bounded = <T>(promise: Promise<T>, onLate?: (value: T) => void) =>
    signal ? untilAborted(promise, signal, onLate) : promise;
  const run = loopbackQueue.then(async () => {
    let stream: MediaStream | null = null;
    try {
      await bounded(window.electronAPI.enableLoopbackAudio());
      if (!isCurrent()) return null;
      // IMPORTANT: video: true is REQUIRED by the API even though we don't want video
      const opened = await bounded(navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }), releaseStream);
      stream = opened;
      opened.getVideoTracks().forEach((track) => {
        track.stop();
        opened.removeTrack(track);
      });
      return opened;
    } finally {
      // Restores normal getDisplayMedia behaviour. If that fails, the stream must not leak.
      await window.electronAPI.disableLoopbackAudio().catch((error: unknown) => {
        if (stream) releaseStream(stream);
        throw error;
      });
    }
  });
  loopbackQueue = run.catch(() => undefined);
  return run;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

async function readSnapshot(): Promise<DeviceSnapshot | null> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const pick = (kind: MediaDeviceKind) =>
      devices.filter((d) => d.kind === kind).map((d) => ({ deviceId: d.deviceId, label: d.label }));
    return { inputs: pick('audioinput'), outputs: pick('audiooutput') };
  } catch {
    return null; // no enumeration: this check is skipped, the next one tries again
  }
}

/** Labels of the entries in `after` whose id is not in `before`, quoted for the log. */
function addedLabels(before: DeviceEntry[], after: DeviceEntry[]): string[] {
  return after.filter((d) => !before.some((b) => b.deviceId === d.deviceId)).map((d) => `"${trackLabel(d)}"`);
}

/** Log what changed between two snapshots: labels only, never ids or content. */
function reportChanges(before: DeviceSnapshot | null, after: DeviceSnapshot): void {
  if (!before || JSON.stringify(before) === JSON.stringify(after)) return;
  const all = (s: DeviceSnapshot) => [...s.inputs, ...s.outputs];
  const added = addedLabels(all(before), all(after));
  const removed = addedLabels(all(after), all(before));
  emitAudioEvent('device-change', null, `added=[${added.join(',')}] removed=[${removed.join(',')}]`);
  for (const [kind, channel] of [
    ['inputs', 'mic'],
    ['outputs', 'system'],
  ] as const) {
    const from = defaultLabel(before[kind]);
    const to = defaultLabel(after[kind]);
    if (from !== to) {
      emitAudioEvent(
        'default-changed',
        channel,
        `from="${trackLabel({ label: from ?? '' })}" to="${trackLabel({ label: to ?? '' })}"`,
      );
    }
  }
}

/**
 * Watch the devices while capturing and re-acquire lost or stale channels.
 * Never throws: without 'devicechange' or enumerateDevices it degrades to doing nothing.
 */
export function startDeviceWatcher(deps: DeviceWatcherDeps): DeviceWatcher {
  let stopped = false;
  let busy = false; // a check -- and any re-acquisition it runs -- is in flight
  let recheckWanted = false;
  let previous: DeviceSnapshot | null = null;
  // channel -> "state|device set" under which its last retry series gave up
  const gaveUpOn = new Map<AudioCaptureChannel, string>();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let backoff: { timer: ReturnType<typeof setTimeout>; wake: () => void } | null = null;
  let inFlight: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | null = null;
  let backstopTicks = 0;

  const scheduleCheck = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void check(false), DEVICE_CHANGE_DEBOUNCE_MS);
  };
  const backstopTimer = setInterval(
    () => void check(++backstopTicks % SLOW_RETRY_EVERY_TICKS === 0),
    BACKSTOP_INTERVAL_MS,
  );
  try {
    navigator.mediaDevices.addEventListener('devicechange', scheduleCheck);
  } catch {
    // No 'devicechange' here: the backstop poll still runs.
  }
  void readSnapshot().then((snapshot) => {
    if (previous === null) previous = snapshot;
  });

  /** Resolves after `ms`, or at once when stop() runs meanwhile. */
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        backoff = null;
        resolve();
      }, ms);
      backoff = { timer, wake: resolve };
    });

  /** One attempt; it fails with a TimeoutError when it has not answered within REACQUIRE_TIMEOUT_MS. */
  async function attemptOnce(channel: AudioCaptureChannel): Promise<ReacquireOutcome | null> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException('no answer in time', 'TimeoutError')),
      REACQUIRE_TIMEOUT_MS,
    );
    inFlight = { controller, timer };
    try {
      return await untilAborted(deps.reacquire(channel, controller.signal), controller.signal);
    } catch (error) {
      return { ok: false, detail: `error=${errorName(error)}` };
    } finally {
      clearTimeout(timer);
      inFlight = null;
    }
  }

  /** 1 + delays.length attempts with those waits between; true once the channel is re-opened. */
  async function reacquireWithRetries(
    channel: AudioCaptureChannel,
    wasLost: boolean,
    delays: readonly number[],
  ): Promise<boolean> {
    for (let attempt = 0; !stopped; attempt++) {
      emitAudioEvent('reacquire-attempt', channel, delays.length ? `attempt=${attempt + 1}` : 'attempt=slow');
      const outcome = await attemptOnce(channel);
      if (stopped || outcome === null) return false;
      if (outcome.ok) {
        emitAudioEvent('reacquire-ok', channel, outcome.detail);
        if (wasLost) deps.onRecovered(channel);
        return true;
      }
      emitAudioEvent('reacquire-failed', channel, outcome.detail);
      if (attempt >= delays.length) return false;
      await wait(delays[attempt]);
    }
    return false;
  }

  /**
   * A full retry series, unless one already failed on this exact device set and
   * channel state: then a still-lost channel gets a single attempt on a slow tick.
   */
  async function reacquireChannel(channel: AudioCaptureChannel, state: MicState, key: string, slowTick: boolean) {
    const spent = gaveUpOn.get(channel) === key;
    if (spent && !(slowTick && isLost(state))) return;
    const ok = await reacquireWithRetries(channel, isLost(state), spent ? [] : RETRY_DELAYS_MS);
    if (ok) gaveUpOn.delete(channel);
    else gaveUpOn.set(channel, key);
  }

  async function check(slowTick: boolean): Promise<void> {
    if (stopped) return;
    if (busy) {
      recheckWanted = true; // run once more when the current check is done
      return;
    }
    busy = true;
    try {
      const current = await readSnapshot();
      if (stopped || !current) return;
      reportChanges(previous, current);
      const states = deps.channelStates();
      const wanted = decideReacquire({ previous, current, chosenMicId: deps.chosenMicId, ...states });
      previous = current;
      for (const channel of wanted) {
        await reacquireChannel(channel, states[channel], `${states[channel]}|${JSON.stringify(current)}`, slowTick);
        if (stopped) return;
      }
    } finally {
      busy = false;
      if (recheckWanted && !stopped) {
        recheckWanted = false;
        scheduleCheck();
      }
    }
  }

  return {
    stop: () => {
      stopped = true;
      clearTimeout(debounceTimer);
      clearInterval(backstopTimer);
      if (backoff) {
        clearTimeout(backoff.timer);
        backoff.wake();
        backoff = null;
      }
      if (inFlight) {
        // Abandon the running attempt: its timer goes now, and the loopback queue is released.
        clearTimeout(inFlight.timer);
        inFlight.controller.abort(new DOMException('capture stopped', 'AbortError'));
        inFlight = null;
      }
      try {
        navigator.mediaDevices.removeEventListener('devicechange', scheduleCheck);
      } catch {
        // Nothing was registered.
      }
    },
  };
}
