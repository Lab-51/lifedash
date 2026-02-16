// === FILE PURPOSE ===
// Main app layout: sidebar on left, routed page content on right.
// Wraps react-router-dom Outlet with ErrorBoundary + Suspense.
// Dynamically adjusts background based on design variant.

import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { useDesign } from '../hooks/useDesign';
import Sidebar from './Sidebar';
import ErrorBoundary from './ErrorBoundary';
import PageSkeleton from './PageSkeleton';

function AppLayout() {
  const { designVariant } = useDesign();

  return (
    <div className="flex-1 flex overflow-hidden">
      <Sidebar />
      <main
        className={`flex-1 overflow-auto transition-colors duration-300 ${designVariant === 'modern'
            ? 'bg-surface-50 dark:bg-surface-950 text-surface-900 dark:text-surface-50'
            : 'bg-surface-950 text-surface-100'
          }`}
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
