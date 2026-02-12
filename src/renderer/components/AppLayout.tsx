// === FILE PURPOSE ===
// Main app layout: sidebar on left, routed page content on right.
// Wraps react-router-dom Outlet with ErrorBoundary + Suspense so
// lazy-loaded pages show a skeleton while loading and a friendly
// error card if they crash.

// === DEPENDENCIES ===
// react (Suspense), react-router-dom (Outlet), Sidebar, ErrorBoundary, PageSkeleton

import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import ErrorBoundary from './ErrorBoundary';
import PageSkeleton from './PageSkeleton';

function AppLayout() {
  return (
    <div className="flex-1 flex overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-surface-950 text-surface-100">
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
