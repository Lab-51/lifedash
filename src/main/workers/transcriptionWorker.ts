// === FILE PURPOSE ===
// Worker thread for Whisper transcription. Runs in a separate thread
// to avoid blocking Electron's main process event loop.
//
// Protocol:
//   Main → Worker: { type: 'init', modelPath: string }
//   Main → Worker: { type: 'transcribe', audioData: ArrayBuffer, segmentIndex: number, startTimeMs: number }
//   Main → Worker: { type: 'stop' }
//   Worker → Main: { type: 'ready' }
//   Worker → Main: { type: 'result', text: string, segments: Array<{text,t0,t1}>, segmentIndex: number, startTimeMs: number }
//   Worker → Main: { type: 'error', message: string }
//
// === DEPENDENCIES ===
// @fugood/whisper.node (initWhisper)
//
// === LIMITATIONS ===
// - Sequential transcription only (one segment at a time)
// - Must init before transcribe

import { parentPort } from 'worker_threads';
import { initWhisper } from '@fugood/whisper.node';

// Types for the WhisperContext returned by initWhisper
// (using the actual return type from the library)
type WhisperContext = Awaited<ReturnType<typeof initWhisper>>;

// Messages received from the main process
interface WorkerInitMessage {
  type: 'init';
  modelPath: string;
}

interface WorkerTranscribeMessage {
  type: 'transcribe';
  audioData: ArrayBuffer;
  segmentIndex: number;
  startTimeMs: number;
}

interface WorkerStopMessage {
  type: 'stop';
}

type MainToWorkerMessage = WorkerInitMessage | WorkerTranscribeMessage | WorkerStopMessage;

let context: WhisperContext | null = null;

parentPort?.on('message', async (msg: MainToWorkerMessage) => {
  try {
    switch (msg.type) {
      case 'init': {
        if (context) {
          await context.release();
        }
        context = await initWhisper({ filePath: msg.modelPath });
        parentPort?.postMessage({ type: 'ready' });
        break;
      }

      case 'transcribe': {
        if (!context) {
          parentPort?.postMessage({
            type: 'error',
            message: 'Worker not initialized. Send init message first.',
          });
          return;
        }

        const { promise } = context.transcribeData(msg.audioData, {
          language: 'en',
        });

        const result = await promise;

        // Sanitize segment timestamps from native binding
        // whisper.cpp may return denormalized floats (e.g. 3.57e-310) for t0/t1
        const sanitizedSegments = result.segments.map((seg: { text: string; t0: number; t1: number }) => ({
          text: seg.text,
          t0: Number.isFinite(seg.t0) ? Math.round(seg.t0) : 0,
          t1: Number.isFinite(seg.t1) ? Math.round(seg.t1) : 0,
        }));

        parentPort?.postMessage({
          type: 'result',
          text: result.result,
          segments: sanitizedSegments,
          segmentIndex: msg.segmentIndex,
          startTimeMs: msg.startTimeMs,
        });
        break;
      }

      case 'stop': {
        if (context) {
          await context.release();
          context = null;
        }
        parentPort?.postMessage({ type: 'stopped' });
        break;
      }
    }
  } catch (error) {
    parentPort?.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
