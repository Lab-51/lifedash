// === FILE PURPOSE ===
// Root React component — sets up HashRouter, title bar, route structure,
// status bar, and global keyboard shortcuts.
// HashRouter is required because Electron uses the file:// protocol
// (BrowserRouter would break on navigation).
// Pages are lazy-loaded so each route chunk is fetched on demand.
// AppShell lives inside HashRouter so useNavigate() is available.

// === DEPENDENCIES ===
// react (lazy), react-router-dom (HashRouter, Routes, Route, useNavigate),
// TitleBar, AppLayout, StatusBar, useKeyboardShortcuts, lazy page components

import { lazy, useEffect } from 'react';
import type { ReactNode } from 'react';
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom';
import TitleBar from './components/TitleBar';
import AppLayout from './components/AppLayout';
import StatusBar from './components/StatusBar';
import useKeyboardShortcuts from './hooks/useKeyboardShortcuts';
import { useTheme } from './hooks/useTheme';
import { useRecordingStore } from './stores/recordingStore';

const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const MeetingsPage = lazy(() => import('./pages/MeetingsPage'));
const IdeasPage = lazy(() => import('./pages/IdeasPage'));
const BrainstormPage = lazy(() => import('./pages/BrainstormPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const BoardPage = lazy(() => import('./pages/BoardPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

/** Wrapper that lives inside HashRouter to enable useNavigate for shortcuts */
function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  useKeyboardShortcuts(navigate);
  useTheme();

  // Initialize recording state listener (always active regardless of page)
  useEffect(() => {
    const cleanup = useRecordingStore.getState().initListener();
    return cleanup;
  }, []);

  return <>{children}</>;
}

function App() {
  return (
    <HashRouter>
      <AppShell>
        <div className="h-screen flex flex-col overflow-hidden">
          <TitleBar />
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<ProjectsPage />} />
              <Route path="/meetings" element={<MeetingsPage />} />
              <Route path="/ideas" element={<IdeasPage />} />
              <Route path="/brainstorm" element={<BrainstormPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/projects/:projectId" element={<BoardPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
          <StatusBar />
        </div>
      </AppShell>
    </HashRouter>
  );
}

export default App;
