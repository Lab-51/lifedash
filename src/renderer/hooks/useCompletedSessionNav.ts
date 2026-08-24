// === FILE PURPOSE ===
// useCompletedSessionNav (POST-FLOW.1 Task 2) — the "arrival" half of the wrap-up:
// the instant a recording finishes processing, land on that session's page so the
// brief hero is the first thing the user sees.
//
// This effect used to live inside SessionsHome, which is mounted ONLY on the "/"
// route — so a recording stopped from anywhere else (the quick-record hotkey, the
// calendar ribbon, LiveModeOverlay's own Stop button while a different page sat
// underneath) processed silently and never navigated. It now lives in AppShell,
// the router host that owns useNavigate() and is mounted for the whole app
// lifetime, which is strictly above LiveModeOverlay's mount parent (AppLayout) —
// so the overlay unmounting on stop cannot take the effect with it. One home also
// means it can only fire ONCE.
//
// `completedMeetingId` is set by recordingStore.stopRecording and by nothing else:
// cancel/discard clears the recording without ever setting it, so those paths
// cannot navigate. The id is cleared BEFORE navigating so a re-render can never
// re-trigger.
//
// === DEPENDENCIES ===
// react, react-router-dom (useNavigate), recordingStore

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecordingStore } from '../stores/recordingStore';

export function useCompletedSessionNav(): void {
  const navigate = useNavigate();
  const completedMeetingId = useRecordingStore((s) => s.completedMeetingId);
  const clearCompletedMeetingId = useRecordingStore((s) => s.clearCompletedMeetingId);

  useEffect(() => {
    if (!completedMeetingId) return;
    clearCompletedMeetingId();
    // ?autoGenerate=1 tells SessionWorkspace to kick the brief + action items off
    // (it joins main's own auto-run rather than racing it — generateBriefShared).
    // react-router v7's NavigateFunction returns void | Promise<void> (Promise only
    // under a data router, which this app's <HashRouter> is not) — `void` is the
    // rule's documented escape hatch, not a suppressed real promise.
    void navigate(`/session/${completedMeetingId}?autoGenerate=1`);
  }, [completedMeetingId, clearCompletedMeetingId, navigate]);
}
