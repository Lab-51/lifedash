// === FILE PURPOSE ===
// Is this window actually on screen? A thin, event-driven read of the NATIVE
// Page Visibility API — `document.visibilityState` plus its `visibilitychange`
// event — introduced for TWIN-READ.1 Task 4's core shimmer.
//
// WHY IT EXISTS AT ALL, given that browsers already throttle hidden pages: the
// twin memory graph's one sanctioned idle animation must be provably absent when
// the window is hidden, not merely slowed at the compositor's discretion.
// Removing the class is observable and testable; relying on an engine's
// throttling policy is an assumption about a behaviour no spec guarantees.
//
// Costs nothing at idle: one event listener, no timer, no polling, no rAF —
// which is what lets it sit inside a component whose whole architectural promise
// is that a settled graph schedules nothing.
//
// === DEPENDENCIES ===
// react

import { useEffect, useState } from 'react';

/** True unless the document is explicitly hidden. Guards a missing `document`
 *  (and jsdom's default 'visible') so a non-browser context reads as visible
 *  rather than as permanently hidden. */
function readDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(readDocumentVisible);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handler = (): void => setVisible(readDocumentVisible());
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  return visible;
}

export default useDocumentVisible;
