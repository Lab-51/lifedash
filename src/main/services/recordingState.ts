// === FILE PURPOSE ===
// Shared recording state for the main process (a renderer-driven boolean flag,
// plus the id of the meeting actually being recorded). Extracted to its own
// dependency-free module to avoid circular dependencies — between main.ts and
// IPC handlers for the boolean flag, and between meetingService and
// audioProcessor (meetingService -> audioProcessor -> transcriptionService ->
// meetingService would otherwise cycle) for the active meeting id.

let _isRecording = false;
let _activeMeetingId: string | null = null;

export function getIsRecording(): boolean {
  return _isRecording;
}

export function setIsRecording(value: boolean): void {
  _isRecording = value;
}

/** The id of the meeting audioProcessor is currently recording, or null. Set by
 *  audioProcessor.startRecording/stopRecording — read by meetingService's
 *  active-recording delete guard (MEET-DEL.1) without an IPC round-trip. */
export function getActiveMeetingId(): string | null {
  return _activeMeetingId;
}

export function setActiveMeetingId(id: string | null): void {
  _activeMeetingId = id;
}
