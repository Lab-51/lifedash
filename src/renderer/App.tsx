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

import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom';
import TitleBar from './components/TitleBar';
import AppLayout from './components/AppLayout';
import StatusBar from './components/StatusBar';
import useKeyboardShortcuts from './hooks/useKeyboardShortcuts';
import { useTheme } from './hooks/useTheme';

import { useRecordingStore } from './stores/recordingStore';
import { useProjectStore } from './stores/projectStore';
import { useMeetingStore } from './stores/meetingStore';
import { useIdeaStore } from './stores/ideaStore';
import { useBrainstormStore } from './stores/brainstormStore';
import { useBoardStore } from './stores/boardStore';
import { useFocusStore } from './stores/focusStore';
import CommandPalette from './components/CommandPalette';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal';
import ToastContainer from './components/ToastContainer';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const MeetingsPage = lazy(() => import('./pages/MeetingsPage'));
const IdeasPage = lazy(() => import('./pages/IdeasPage'));
const BrainstormPage = lazy(() => import('./pages/BrainstormPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const BoardPage = lazy(() => import('./pages/BoardPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const FocusStartModal = lazy(() => import('./components/FocusStartModal'));

/** Wrapper that lives inside HashRouter to enable useNavigate for shortcuts */
function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const showStartModal = useFocusStore(s => s.showStartModal);

  const toggleCommandPalette = useCallback(() => {
    setShowCommandPalette(prev => !prev);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setShowCommandPalette(false);
  }, []);

  const toggleShortcutsHelp = useCallback(() => {
    setShowShortcutsHelp(prev => !prev);
  }, []);

  const closeShortcutsHelp = useCallback(() => {
    setShowShortcutsHelp(false);
  }, []);

  const openShortcutsHelp = useCallback(() => {
    setShowCommandPalette(false);
    setShowShortcutsHelp(true);
  }, []);

  const toggleFocusMode = useCallback(() => {
    const focusState = useFocusStore.getState();
    if (focusState.mode === 'idle') {
      focusState.setShowStartModal(true);
    } else {
      focusState.stop();
    }
  }, []);

  useKeyboardShortcuts(navigate, toggleCommandPalette, toggleShortcutsHelp, toggleFocusMode);
  useTheme();
  // Initialize recording state listener (always active regardless of page)
  useEffect(() => {
    const cleanup = useRecordingStore.getState().initListener();
    return cleanup;
  }, []);

  // Pre-load entity data so command palette (Ctrl+K) always has results,
  // even before the user visits the corresponding pages.
  // Once all stores settle, mark app as ready so the splash can be dismissed.
  useEffect(() => {
    Promise.allSettled([
      useProjectStore.getState().loadProjects(),
      useMeetingStore.getState().loadMeetings(),
      useIdeaStore.getState().loadIdeas(),
      useBrainstormStore.getState().loadSessions(),
      useBoardStore.getState().loadAllCards(),
      useFocusStore.getState().loadSettings(),
    ]).then(() => setAppReady(true));
  }, []);

  // Dismiss the splash screen once the app is ready
  useEffect(() => {
    if (!appReady) return;
    const splash = document.getElementById('splash');
    if (!splash) return;
    splash.classList.add('splash-hidden');
    setTimeout(() => splash.remove(), 400);
  }, [appReady]);

  // Listen for global hotkey IPC event (Ctrl+Shift+Space from main process)
  useEffect(() => {
    if (!window.electronAPI?.onShowCommandPalette) return;
    const cleanup = window.electronAPI.onShowCommandPalette(() => {
      setShowCommandPalette(true);
    });
    return cleanup;
  }, []);

  return (
    <>
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={closeCommandPalette}
        navigate={navigate}
        onShowShortcuts={openShortcutsHelp}
      />
      <KeyboardShortcutsModal
        isOpen={showShortcutsHelp}
        onClose={closeShortcutsHelp}
      />
      <Suspense fallback={null}>
        <FocusStartModal
          isOpen={showStartModal}
          onClose={() => useFocusStore.getState().setShowStartModal(false)}
        />
      </Suspense>
      {appReady && children}
    </>
  );
}

function App() {
  return (
    <HashRouter>
      <AppShell>
        <div className="h-screen flex flex-col overflow-hidden">
          <TitleBar />
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/meetings" element={<MeetingsPage />} />
              <Route path="/ideas" element={<IdeasPage />} />
              <Route path="/brainstorm" element={<BrainstormPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/projects/:projectId" element={<BoardPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
          <StatusBar />
          <ToastContainer />
        </div>
      </AppShell>
    </HashRouter>
  );
}

export default App;
