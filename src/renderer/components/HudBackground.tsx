// === FILE PURPOSE ===
// Shared HUD background layers — grid, diagonal lines, scanlines, starfield, and radial glow.
// Dark mode only. Extracted from DashboardModern for reuse across all main sections.

import { lazy, Suspense } from 'react';

const Starfield = lazy(() => import('./Starfield'));

export default function HudBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none dark:block hidden z-0">
      <div className="absolute inset-0 grid-bg" />
      <div className="absolute inset-0 diagonal-lines" />
      <div className="absolute inset-0 scanlines z-[1]" />
      <Suspense fallback={null}>
        <Starfield />
      </Suspense>
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(62,232,228,0.06)_0%,transparent_70%)]" />
    </div>
  );
}
