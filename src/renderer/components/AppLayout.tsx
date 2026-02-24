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
  const focusMode = useFocusStore(s => s.mode);

  return (
    <div className="flex-1 flex overflow-hidden">
      {focusMode !== 'focus' && focusMode !== 'break' && <Sidebar />}
      <main
        className="flex-1 overflow-auto transition-colors duration-300 bg-surface-50 dark:bg-surface-950 text-[var(--color-text-primary)]"
      >
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
