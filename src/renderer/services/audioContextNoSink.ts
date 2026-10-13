// === FILE PURPOSE ===
// Creates the 16 kHz AudioContext used by recording and voice input WITHOUT an
// output device (AUDIO-DEVICE.1). A ScriptProcessorNode only fires while it is
// connected to `destination`, and on a default-sink context that connection
// opens a silent output stream on the default speaker -- the Bluetooth headset
// during a call, on top of its mic and loopback streams. A 'none' sink keeps the
// processor firing at full rate and opens nothing.
//
// === DEPENDENCIES ===
// Web Audio API (AudioContext). `sinkId` in the AudioContext constructor is not
// in TypeScript's lib.dom, so it is typed locally below.
//
// === LIMITATIONS ===
// - Detection is by outcome, not by user agent: the context is asked for a
//   'none' sink and then checked. A runtime that ignores the option (or throws
//   on it) falls back to the default sink, i.e. exactly the old behaviour.
// - On a runtime that ignores the option, the first context is a default-sink
//   one that is opened and then closed before the fallback is created.

/** Which output the capture context ended up with. */
export type CaptureSink = 'none' | 'default';

export interface CaptureContext {
  ctx: AudioContext;
  sink: CaptureSink;
  /** Why the 'none' sink was not used (error name or a short phrase); set only when sink is 'default'. */
  fallbackReason?: string;
}

/** AudioContextOptions plus the `sinkId` member lib.dom does not declare yet. */
interface NoSinkContextOptions extends AudioContextOptions {
  sinkId: { type: 'none' };
}

/** The part of the context that reports the sink the runtime actually applied. */
interface SinkReportingContext {
  /** An object `{ type: 'none' }` for a no-output context; a string (device id, '' = default) otherwise. */
  sinkId?: unknown;
}

function isNoSink(ctx: AudioContext): boolean {
  const sinkId = (ctx as SinkReportingContext).sinkId;
  return typeof sinkId === 'object' && sinkId !== null && (sinkId as { type?: unknown }).type === 'none';
}

/**
 * Build the capture AudioContext. Tries a 'none' sink first and verifies it took
 * effect; on any failure falls back to a plain default-sink context. Only the
 * fallback construction itself can throw, as it always could.
 */
export function createCaptureContext(sampleRate: number): CaptureContext {
  let fallbackReason: string;
  try {
    const options: NoSinkContextOptions = { sampleRate, sinkId: { type: 'none' } };
    const ctx = new AudioContext(options);
    if (isNoSink(ctx)) return { ctx, sink: 'none' };
    // Option silently ignored: this context has a default sink, so drop it.
    ctx.close().catch(() => {});
    fallbackReason = 'sink-not-honoured';
  } catch (error) {
    fallbackReason = `error=${error instanceof Error ? error.name : 'UnknownError'}`;
  }
  return { ctx: new AudioContext({ sampleRate }), sink: 'default', fallbackReason };
}
