// === FILE PURPOSE ===
// Enforcement test for the THIRD cloud-dispatch site: speakerDiarizationService
// (GUARD.1 Task 4). Diarization can only run against a cloud provider (Whisper has
// no diarization), so under local-only mode it MUST be blocked outright — no local
// fallback. Proves diarizeMeeting() short-circuits with the local-only error and
// never reaches a cloud transcriber (closing the leftover-API-key WAV-upload gap),
// while the control case (local-only off) proceeds past the guard.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('node:fs', () => ({ default: { existsSync: vi.fn(), readFileSync: vi.fn() } }));
vi.mock('../meetingService', () => ({
  getMeeting: vi.fn(),
  updateSegmentSpeakers: vi.fn(),
}));
vi.mock('../deepgramTranscriber', () => ({ transcribeFileWithDiarization: vi.fn() }));
vi.mock('../assemblyaiTranscriber', () => ({ transcribeFileWithDiarization: vi.fn() }));
vi.mock('../transcriptionProviderService', () => ({
  getConfig: vi.fn(),
  getDecryptedKey: vi.fn(),
  isLocalOnly: vi.fn(),
}));
vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));
vi.mock('../../db/schema', () => ({ settings: { __table: 'settings', key: 'key', value: 'value' } }));
vi.mock('drizzle-orm', () => ({ eq: (...a: unknown[]) => ({ eq: a }) }));

import { diarizeMeeting } from '../speakerDiarizationService';
import * as meetingService from '../meetingService';
import * as providerService from '../transcriptionProviderService';
import * as deepgramTranscriber from '../deepgramTranscriber';
import * as assemblyaiTranscriber from '../assemblyaiTranscriber';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('diarizeMeeting — local-only enforcement (third dispatch site)', () => {
  it('short-circuits and never reaches a cloud transcriber when local-only is on', async () => {
    vi.mocked(providerService.isLocalOnly).mockResolvedValue(true);

    const result = await diarizeMeeting('meeting-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Local-only transcription is on');
    // Blocked BEFORE any file/DB/provider work — and no cloud upload of the WAV.
    expect(meetingService.getMeeting).not.toHaveBeenCalled();
    expect(deepgramTranscriber.transcribeFileWithDiarization).not.toHaveBeenCalled();
    expect(assemblyaiTranscriber.transcribeFileWithDiarization).not.toHaveBeenCalled();
  });

  it('proceeds past the guard when local-only is off', async () => {
    vi.mocked(providerService.isLocalOnly).mockResolvedValue(false);
    vi.mocked(meetingService.getMeeting).mockResolvedValue(null as never);

    const result = await diarizeMeeting('meeting-1');

    // Guard did not fire — execution reached the meeting load (which returns null here).
    expect(meetingService.getMeeting).toHaveBeenCalledWith('meeting-1');
    expect(result.error).toBe('Meeting not found');
  });
});
