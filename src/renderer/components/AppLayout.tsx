// === FILE PURPOSE ===
// Main app layout: sidebar on left, routed page content on right.
// Wraps react-router-dom Outlet with ErrorBoundary + Suspense.

import { Suspense, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import ErrorBoundary from './ErrorBoundary';
import PageSkeleton from './PageSkeleton';
import { useFocusStore } from '../stores/focusStore';
import { useSoundEffect } from '../hooks/useSoundEffect';

/** Selector matching interactive elements that should trigger a click sound. */
const CLICK_SOUND_SELECTOR = [
  'button',
  'a',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'select',
].join(',');

/** Selector matching elements that should NOT trigger a click sound. */
const CLICK_SOUND_EXCLUDE_SELECTOR = [
  'input[type="text"]',
  'input[type="search"]',
  'input[type="email"]',
  'input[type="password"]',
  'input[type="number"]',
  'input[type="url"]',
  'input[type="tel"]',
  'input:not([type])',
  'textarea',
  'audio',
  'video',
  '[data-no-click-sound]',
].join(',');

function AppLayout() {
  const focusMode = useFocusStore((s) => s.mode);
  const { playClick } = useSoundEffect();

  // Global click-sound via event delegation (capture phase for reliability)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;

      // Skip excluded elements (text inputs, media controls)
      if (target.closest(CLICK_SOUND_EXCLUDE_SELECTOR)) return;

      // Play sound if target is (or is inside) an interactive element
      if (target.closest(CLICK_SOUND_SELECTOR)) {
        playClick();
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [playClick]);

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
