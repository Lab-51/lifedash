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

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom';
import TitleBar from './components/TitleBar';
import TrialBanner from './components/TrialBanner';
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
import { useGamificationStore } from './stores/gamificationStore';
import { useLicenseStore } from './stores/licenseStore';
import { useSettingsStore } from './stores/settingsStore';
import CommandPalette from './components/CommandPalette';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal';
import ToastContainer from './components/ToastContainer';
import AchievementBanner from './components/AchievementBanner';
import SetupWizard from './components/SetupWizard';
import { toast } from './hooks/useToast';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const MeetingsPage = lazy(() => import('./pages/MeetingsPage'));
const IdeasPage = lazy(() => import('./pages/IdeasPage'));
const BrainstormPage = lazy(() => import('./pages/BrainstormPage'));
const FocusPage = lazy(() => import('./pages/FocusPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const BoardPage = lazy(() => import('./pages/BoardPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const FocusStartModal = lazy(() => import('./components/FocusStartModal'));
const FocusCompleteModal = lazy(() => import('./components/FocusCompleteModal'));
const FocusOverlay = lazy(() => import('./components/FocusOverlay'));

const MIN_SPLASH_MS = 3000;

/** Wrapper that lives inside HashRouter to enable useNavigate for shortcuts */
function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const showStartModal = useFocusStore(s => s.showStartModal);
  const focusMode = useFocusStore(s => s.mode);

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
  const mountTime = useRef(Date.now());
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
      useGamificationStore.getState().loadStats(),
      useLicenseStore.getState().loadLicense(),
    ]).then(() => {
      const elapsed = Date.now() - mountTime.current;
      const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
      if (remaining > 0) {
        setTimeout(() => setAppReady(true), remaining);
      } else {
        setAppReady(true);
      }
    });
  }, []);

  // Show the setup wizard if: no providers configured AND wizard not yet completed.
  useEffect(() => {
    if (!appReady) return;
    async function checkWizard() {
      const settingsStore = useSettingsStore.getState();
      await Promise.all([
        settingsStore.loadProviders(),
        settingsStore.loadSettings(),
      ]);
      const providers = useSettingsStore.getState().providers;
      const settings = useSettingsStore.getState().settings;
      const wizardCompleted = settings['setupWizard.completed'] === 'true';
      if (providers.length === 0 && !wizardCompleted) {
        setShowWizard(true);
      }
    }
    checkWizard();
  }, [appReady]);

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


  // Show toast when break timer ends (break -> idle transition)
  const prevModeRef = useRef(focusMode);
  useEffect(() => {
    if (prevModeRef.current === 'break' && focusMode === 'idle') {
      toast('Break complete! Ready for another session?', 'info');
    }
    prevModeRef.current = focusMode;
  }, [focusMode]);

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
        {(focusMode === 'focus' || focusMode === 'break') && <FocusOverlay />}
        <FocusCompleteModal
          isOpen={focusMode === 'completed'}
          onClose={() => useFocusStore.getState().stop()}
        />
      </Suspense>
      {showWizard && (
        <SetupWizard onClose={() => setShowWizard(false)} />
      )}
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
          <TrialBanner />
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/meetings" element={<MeetingsPage />} />
              <Route path="/ideas" element={<IdeasPage />} />
              <Route path="/brainstorm" element={<BrainstormPage />} />
              <Route path="/focus" element={<FocusPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/projects/:projectId" element={<BoardPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
          <StatusBar />
          <AchievementBanner />
          <ToastContainer />
        </div>
      </AppShell>
    </HashRouter>
  );
}

export default App;
