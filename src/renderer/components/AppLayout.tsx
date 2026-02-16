// === FILE PURPOSE ===
// Main app layout: sidebar on left, routed page content on right.
// Wraps react-router-dom Outlet with ErrorBoundary + Suspense.

import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import ErrorBoundary from './ErrorBoundary';
import PageSkeleton from './PageSkeleton';

function AppLayout() {
  return (
    <div className="flex-1 flex overflow-hidden">
      <Sidebar />
      <main
        className="flex-1 overflow-auto transition-colors duration-300 bg-surface-50 dark:bg-surface-950 text-surface-900 dark:text-surface-50"
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
