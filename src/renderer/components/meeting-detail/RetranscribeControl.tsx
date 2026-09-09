// === FILE PURPOSE ===
// Redo one span of a completed meeting's transcript from its WAV, with a
// whisper model the user chooses (TRANS-COV.1 Task 5). The only caller of
// main's `retranscribeSpan` IPC (Task 4) — rendered by TranscriptSection once
// a span has been picked (a suspect-span chip, a coverage gap, or a manual
// mm:ss pair).
//
// === WHY THE SPAN IS SNAPPED HERE, NOT SENT AS PICKED ===
// Task 4's review found real data loss: the service DELETES whole transcript
// rows that OVERLAP the requested span, but only READS AUDIO for the span
// itself — a span starting mid-row reads no audio for the rest of that row,
// so its text is discarded with nothing to replace it (8,500 ms measured on
// one selection). The service deliberately does not fix this itself; the
// accepted fix is to WIDEN the span in the UI, first to cover every
// transcript row it touches, then to the live pipeline's own 10-second window
// stamps (so a span landing entirely inside an untranscribed gap still aligns
// to a real capture boundary). `snapSpanToRows` is the one place that
// happens, and its result is BOTH what gets sent to `retranscribeSpan` and
// what the "Redo mm:ss-mm:ss" copy shows — never two different numbers.
//
// === WHY RECORDING-ACTIVE IS READ FROM THE STORE, NOT A NEW IPC ===
// recordingStore.isRecording is a single app-wide Zustand slice (one recording
// at a time, per its own file header) kept current by a listener registered
// once at app bootstrap — it already reflects any recording in progress
// regardless of when this page mounted, so no new `recording:is-active`
// channel is needed for the "shown only when not recording" gate.
//
// === DEPENDENCIES ===
// react, lucide-react (Loader2/RefreshCw — already used elsewhere for an
// in-flight/redo action), recordingStore, shared/transcription/timeCoordinates
// (WINDOW_STAMP_MS), shared types, ./utils (formatTimestamp), ../../hooks/useToast.

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { formatTimestamp } from './utils';
import { WINDOW_STAMP_MS } from '../../../shared/transcription/timeCoordinates';
import { useRecordingStore } from '../../stores/recordingStore';
import { toast } from '../../hooks/useToast';
import type { RetranscribedSpan, RetranscribeSpanInput, TranscriptSegment, WhisperModel } from '../../../shared/types';

export interface PendingSpan {
  startMs: number;
  endMs: number;
}

interface RetranscribeControlProps {
  meetingId: string;
  /** The meeting's own segments — used ONLY to widen the picked span to whole
   *  rows before sending it (see the header). Never mutated here. */
  segments: readonly TranscriptSegment[];
  pendingSpan: PendingSpan | null;
  /** A completed run: the rows now in the database for the span, and the note
   *  to fold into `meetings.transcription_coverage.retranscribed`. The caller
   *  owns applying both to its own meeting state — this component has none. */
  onApplied: (segments: TranscriptSegment[], note: RetranscribedSpan) => void;
}

/** Parse a whisper catalog size string ("74 MB", "~874 MB", "1.5 GB") into MB
 *  for comparison. `null` when nothing recognizable is in it. */
function parseSizeMb(size: string): number | null {
  const match = size.match(/([\d.]+)\s*(GB|MB)/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return match[2].toUpperCase() === 'GB' ? value * 1024 : value;
}

/** The largest model by parsed size; the LAST entry when nothing in the list
 *  parses at all (never an arbitrary first pick). */
function pickLargestModel(models: readonly WhisperModel[]): WhisperModel | undefined {
  let best: WhisperModel | undefined;
  let bestMb = -Infinity;
  for (const model of models) {
    const mb = parseSizeMb(model.size);
    if (mb !== null && mb > bestMb) {
      best = model;
      bestMb = mb;
    }
  }
  return best ?? models[models.length - 1];
}

/**
 * Widen a picked span to whole transcript rows, then to 10-second window
 * stamps (see the file header). Exported for the test that pins the
 * row-widening behaviour directly.
 */
export function snapSpanToRows(
  span: PendingSpan,
  segments: readonly Pick<TranscriptSegment, 'startTime' | 'endTime'>[],
): PendingSpan {
  let { startMs, endMs } = span;
  let changed = true;
  while (changed) {
    changed = false;
    for (const seg of segments) {
      if (seg.startTime < endMs && seg.endTime > startMs) {
        if (seg.startTime < startMs) {
          startMs = seg.startTime;
          changed = true;
        }
        if (seg.endTime > endMs) {
          endMs = seg.endTime;
          changed = true;
        }
      }
    }
  }
  startMs = Math.floor(startMs / WINDOW_STAMP_MS) * WINDOW_STAMP_MS;
  endMs = Math.ceil(endMs / WINDOW_STAMP_MS) * WINDOW_STAMP_MS;
  return { startMs, endMs };
}

function describeFailure(reason: string, detail?: string): string {
  return detail ? `${reason}: ${detail}` : reason;
}

export default function RetranscribeControl({ meetingId, segments, pendingSpan, onApplied }: RetranscribeControlProps) {
  const [models, setModels] = useState<WhisperModel[]>([]);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recordingActive = useRecordingStore((s) => s.isRecording);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .getWhisperModels()
      .then((all) => {
        if (cancelled) return;
        const available = all.filter((m) => m.available);
        setModels(available);
        setSelectedFileName(pickLargestModel(available)?.fileName ?? null);
      })
      .catch(() => {
        // Best-effort: an empty list just means nothing to pick below.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!pendingSpan || recordingActive) return null;

  const { startMs, endMs } = snapSpanToRows(pendingSpan, segments);
  const selectedModel = models.find((m) => m.fileName === selectedFileName);

  const run = async () => {
    if (!selectedModel || busy) return;
    setBusy(true);
    setError(null);
    const input: RetranscribeSpanInput = { meetingId, startMs, endMs, modelFileName: selectedModel.fileName };
    const result = await window.electronAPI.retranscribeSpan(input);
    setBusy(false);
    if (!result.ok) {
      setError(describeFailure(result.reason, result.detail));
      return;
    }
    toast(`Redone: ${result.replaced} replaced, ${result.inserted} written`, 'success');
    onApplied(result.segments, {
      startMs,
      endMs: result.clampedEndMs,
      model: selectedModel.fileName,
      at: new Date().toISOString(),
      replaced: result.replaced,
      inserted: result.inserted,
    });
  };

  return (
    <div className="p-3 rounded-lg border border-[var(--color-border)] bg-surface-50 dark:bg-surface-950/50 space-y-2 overflow-hidden">
      <p className="text-xs text-[var(--color-text-secondary)] break-words">
        Redo {formatTimestamp(startMs)}–{formatTimestamp(endMs)}
        {selectedModel ? ` with ${selectedModel.name}` : ''}. Speaker labels in this span will be cleared.
      </p>
      {models.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">No downloaded models — get one in Settings first.</p>
      )}
      {models.length > 0 && (
        <select
          aria-label="Model to redo this span with"
          value={selectedFileName ?? ''}
          onChange={(e) => setSelectedFileName(e.target.value)}
          disabled={busy}
          className="text-xs bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded px-2 py-1 max-w-full"
        >
          {models.map((m) => (
            <option key={m.fileName} value={m.fileName}>
              {m.name} ({m.size})
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || !selectedModel}
        className="flex items-center gap-1.5 text-xs font-hud px-2.5 py-1.5 rounded-md bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent-muted)] hover:bg-[var(--color-accent)]/20 disabled:opacity-50 transition-colors"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        {busy ? 'Redoing…' : 'Redo this span'}
      </button>
      {error && (
        <p className="text-xs text-red-400 break-words" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
