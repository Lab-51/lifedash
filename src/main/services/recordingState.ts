// === FILE PURPOSE ===
// Shared recording state flag for the main process.
// Extracted to its own module to avoid circular dependencies
// between main.ts and IPC handlers.

let _isRecording = false;

export function getIsRecording(): boolean {
  return _isRecording;
}

export function setIsRecording(value: boolean): void {
  _isRecording = value;
}
