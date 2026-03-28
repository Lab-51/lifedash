// === FILE PURPOSE ===
// Generate a default meeting title with the current date and time.
// Shared between RecordingControls (UI) and the quick-record keyboard shortcut.

/** Generate a default meeting title with the current date and time. */
export function suggestMeetingTitle(): string {
  const now = new Date();
  const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Meeting - ${date}, ${time}`;
}
