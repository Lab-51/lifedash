// === FILE PURPOSE ===
// Main app layout: sidebar on left, routed page content on right.
// Wraps react-router-dom Outlet with ErrorBoundary + Suspense.

import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import ErrorBoundary from './ErrorBoundary';
import PageSkeleton from './PageSkeleton';
import { useFocusStore } from '../stores/focusStore';

function AppLayout() {
  const focusMode = useFocusStore((s) => s.mode);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Global HUD scanline beam — dark mode only */}
      <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden dark:block hidden">
        <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--color-accent)] to-transparent opacity-[0.07] animate-scanline" />
      </div>
      {focusMode !== 'focus' && focusMode !== 'break' && <Sidebar />}
      <main className="flex-1 overflow-auto transition-colors duration-300 bg-surface-50 dark:bg-surface-950 text-[var(--color-text-primary)]">
        <ErrorBoundary>
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default AppLayout;
