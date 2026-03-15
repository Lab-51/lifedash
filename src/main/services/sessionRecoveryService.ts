// === FILE PURPOSE ===
// Crash recovery service for the main process.
// Periodically snapshots active state (recording, card drafts) to disk.
// On next launch, if a crash marker exists, the renderer can recover that state.

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getIsRecording } from './recordingState';
import { createLogger } from './logger';

const log = createLogger('Recovery');

export interface RecoveryState {
  timestamp: string;
  activeRecording?: { meetingId: string; startTime: string };
  pendingAiOps?: { type: string; context: string }[];
  cardDrafts?: { cardId: string; field: string; value: string; projectId?: string }[];
}

const recoveryFile = () => path.join(app.getPath('userData'), 'recovery-state.json');
const crashMarkerFile = () => path.join(app.getPath('userData'), '.crash-marker');

let cardDrafts: RecoveryState['cardDrafts'] = [];
let snapshotInterval: ReturnType<typeof setInterval> | null = null;

export function writeCrashMarker(): void {
  try {
    fs.writeFileSync(crashMarkerFile(), new Date().toISOString());
  } catch {
    // Best-effort — if userData isn't accessible, skip
  }
}

export function snapshotState(): void {
  try {
    const state: RecoveryState = {
      timestamp: new Date().toISOString(),
    };

    if (getIsRecording()) {
      state.activeRecording = {
        meetingId: 'unknown',
        startTime: new Date().toISOString(),
      };
    }

    if (cardDrafts && cardDrafts.length > 0) {
      state.cardDrafts = [...cardDrafts];
    }

    fs.writeFileSync(recoveryFile(), JSON.stringify(state, null, 2));
  } catch (err) {
    log.error('Failed to write recovery snapshot:', err);
  }
}

export function hasCrashMarker(): boolean {
  return fs.existsSync(crashMarkerFile());
}

export function getRecoveryState(): RecoveryState | null {
  if (!hasCrashMarker()) return null;
  try {
    const data = fs.readFileSync(recoveryFile(), 'utf-8');
    return JSON.parse(data) as RecoveryState;
  } catch {
    return null;
  }
}

export function clearCrashMarker(): void {
  try {
    fs.unlinkSync(crashMarkerFile());
  } catch {
    /* ignore ENOENT */
  }
}

export function clearRecoveryState(): void {
  try {
    fs.unlinkSync(crashMarkerFile());
  } catch {
    /* ignore ENOENT */
  }
  try {
    fs.unlinkSync(recoveryFile());
  } catch {
    /* ignore ENOENT */
  }
  cardDrafts = [];
}

export function saveCardDraft(draft: { cardId: string; field: string; value: string; projectId?: string }): void {
  if (!cardDrafts) cardDrafts = [];
  const idx = cardDrafts.findIndex((d) => d.cardId === draft.cardId && d.field === draft.field);
  if (idx >= 0) {
    cardDrafts[idx] = draft;
  } else {
    cardDrafts.push(draft);
  }
  snapshotState();
}

export function clearCardDraft(cardId: string, field: string): void {
  if (!cardDrafts) return;
  cardDrafts = cardDrafts.filter((d) => !(d.cardId === cardId && d.field === field));
  snapshotState();
}

export function startPeriodicSnapshot(intervalMs = 30000): void {
  if (snapshotInterval) clearInterval(snapshotInterval);
  snapshotInterval = setInterval(() => snapshotState(), intervalMs);
  log.info(`Periodic recovery snapshot started (${intervalMs}ms interval)`);
}

export function stopPeriodicSnapshot(): void {
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
    log.info('Periodic recovery snapshot stopped');
  }
}
