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
import AppLayout from './components/AppLayout';
import StatusBar from './components/StatusBar';
import useKeyboardShortcuts from './hooks/useKeyboardShortcuts';
import { useTheme } from './hooks/useTheme';
import { useFontScale } from './hooks/useFontScale';

import { useRecordingStore } from './stores/recordingStore';
import { useProjectStore } from './stores/projectStore';
import { useMeetingStore } from './stores/meetingStore';
import { useIdeaStore } from './stores/ideaStore';
import { useIntelFeedStore } from './stores/intelFeedStore';
import { useBrainstormStore } from './stores/brainstormStore';
import { useBoardStore } from './stores/boardStore';
import { useFocusStore } from './stores/focusStore';
import { useGamificationStore } from './stores/gamificationStore';
import { useSettingsStore } from './stores/settingsStore';
import CommandPalette from './components/CommandPalette';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal';
import ToastContainer from './components/ToastContainer';
import AchievementBanner from './components/AchievementBanner';
import SetupWizard from './components/SetupWizard';
import FeatureTour from './components/FeatureTour';
import WhatsNewModal from './components/WhatsNewModal';
import RecoveryDialog from './components/RecoveryDialog';
import { releaseNotes, releaseHistory, getReleaseType } from '../shared/releaseNotes';
import type { ReleaseType, ReleaseNoteSection, ReleaseNotesData } from '../shared/releaseNotes';
import type { RecoveryState } from '../shared/types/electron-api';
import { toast } from './hooks/useToast';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const MeetingsPage = lazy(() => import('./pages/MeetingsPage'));
const IdeasPage = lazy(() => import('./pages/IdeasPage'));
const IntelPage = lazy(() => import('./pages/IntelPage'));
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
  const [showTour, setShowTour] = useState(false);
  const [recoveryState, setRecoveryState] = useState<RecoveryState | null>(null);
  const [whatsNew, setWhatsNew] = useState<{
    version: string;
    releaseType: ReleaseType;
    sections: ReleaseNoteSection[];
    previousVersions: ReleaseNotesData[];
  } | null>(null);
  const showStartModal = useFocusStore((s) => s.showStartModal);
  const focusMode = useFocusStore((s) => s.mode);

  const toggleCommandPalette = useCallback(() => {
    setShowCommandPalette((prev) => !prev);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setShowCommandPalette(false);
  }, []);

  const toggleShortcutsHelp = useCallback(() => {
    setShowShortcutsHelp((prev) => !prev);
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
  useFontScale();
  const mountTime = useRef(Date.now());
  // Initialize recording state listener (always active regardless of page)
  useEffect(() => {
    const cleanup = useRecordingStore.getState().initListener();
    return cleanup;
  }, []);

  // Check for crash recovery on mount
  useEffect(() => {
    if (!window.electronAPI?.checkRecovery) return;
    window.electronAPI
      .checkRecovery()
      .then(({ hasCrash, state }) => {
        if (hasCrash && state) {
          setRecoveryState(state);
        }
      })
      .catch(() => {
        /* ignore — recovery check is best-effort */
      });
  }, []);

  const handleRecoveryRestore = useCallback(async () => {
    if (!window.electronAPI?.restoreSession) return;
    try {
      const state = await window.electronAPI.restoreSession();
      if (state?.cardDrafts && state.cardDrafts.length > 0) {
        for (const draft of state.cardDrafts) {
          try {
            await window.electronAPI.updateCard(draft.cardId, { [draft.field]: draft.value });
          } catch {
            // Card may have been deleted — skip silently
          }
        }
        toast(`Restored ${state.cardDrafts.length} card draft(s)`, 'success');
      }
      if (state?.activeRecording) {
        toast('A recording was interrupted — saved audio may be available in Meetings', 'info');
      }
    } catch {
      toast('Failed to restore session', 'error');
    }
    setRecoveryState(null);
  }, []);

  const handleRecoveryDiscard = useCallback(async () => {
    if (window.electronAPI?.discardRecovery) {
      await window.electronAPI.discardRecovery().catch(() => {});
    }
    setRecoveryState(null);
  }, []);

  // Pre-load entity data so command palette (Ctrl+K) always has results,
  // even before the user visits the corresponding pages.
  // Once all stores settle, mark app as ready so the splash can be dismissed.
  useEffect(() => {
    Promise.allSettled([
      useProjectStore.getState().loadProjects(),
      useMeetingStore.getState().loadMeetings(),
      useIdeaStore.getState().loadIdeas(),
      useIntelFeedStore.getState().loadItems(),
      useBrainstormStore.getState().loadSessions(),
      useBoardStore.getState().loadAllCards(),
      useFocusStore.getState().loadSettings(),
      useGamificationStore.getState().loadStats(),
    ]).then(() => {
      // Fire non-blocking background fetch for intel sources
      useIntelFeedStore.getState().fetchAll();
      const elapsed = Date.now() - mountTime.current;
      const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
      if (remaining > 0) {
        setTimeout(() => setAppReady(true), remaining);
      } else {
        setAppReady(true);
      }
    });
  }, []);

  // Show the feature tour (new users) or setup wizard on first launch.
  // Tour shows first for brand-new users; existing users skip straight to wizard if needed.
  useEffect(() => {
    if (!appReady) return;
    async function checkFirstLaunch() {
      const settingsStore = useSettingsStore.getState();
      await Promise.all([settingsStore.loadProviders(), settingsStore.loadSettings()]);
      const providers = useSettingsStore.getState().providers;
      const settings = useSettingsStore.getState().settings;
      const tourCompleted = settings['featureTour.completed'] === 'true';
      const wizardCompleted = settings['setupWizard.completed'] === 'true';

      // Skip onboarding overlays in E2E test mode
      if ((window as any).electronAPI?.isTestMode) return;

      if (!tourCompleted && !wizardCompleted && providers.length === 0) {
        // Brand-new user — show tour first, wizard after
        setShowTour(true);
      } else if (!wizardCompleted && providers.length === 0) {
        // Existing user who still needs the wizard (tour already done or skipped)
        setShowWizard(true);
      }
    }
    checkFirstLaunch();
  }, [appReady]);

  // Show "What's New" modal after an update (version changed since last launch)
  useEffect(() => {
    if (!appReady) return;
    async function checkWhatsNew() {
      const settingsStore = useSettingsStore.getState();
      // Settings may already be loaded by the wizard check — safe to re-call
      await settingsStore.loadSettings();
      const settings = useSettingsStore.getState().settings;
      const lastSeen = settings['app.lastSeenVersion'];
      const currentVersion = window.electronAPI?.appVersion;
      if (!currentVersion) return;

      if (!lastSeen) {
        // Setting never existed — could be first install OR existing user upgrading
        // to the version that introduced this feature. Check setupWizard flag to tell apart.
        const isExistingUser = settings['setupWizard.completed'] === 'true' || Object.keys(settings).length > 0;
        if (isExistingUser && releaseNotes.version === currentVersion) {
          // Persist immediately so the modal won't reappear if the app is closed
          // before the user clicks dismiss.
          await settingsStore.setSetting('app.lastSeenVersion', currentVersion);
          setWhatsNew({
            version: currentVersion,
            releaseType: 'minor', // first time seeing the modal = treat as notable
            sections: releaseNotes.sections,
            previousVersions: releaseHistory.slice(1),
          });
        } else {
          // Genuine first install — seed silently
          await settingsStore.setSetting('app.lastSeenVersion', currentVersion);
        }
      } else if (lastSeen !== currentVersion && releaseNotes.version === currentVersion) {
        // Version changed and we have matching notes — show modal.
        // Persist immediately so the modal won't reappear if the app is closed
        // before the user clicks dismiss.
        await settingsStore.setSetting('app.lastSeenVersion', currentVersion);
        setWhatsNew({
          version: currentVersion,
          releaseType: getReleaseType(lastSeen, currentVersion),
          sections: releaseNotes.sections,
          previousVersions: releaseHistory.slice(1),
        });
      } else if (lastSeen !== currentVersion) {
        // Version changed but no matching notes (edge case) — silently update
        await settingsStore.setSetting('app.lastSeenVersion', currentVersion);
      }
    }
    checkWhatsNew();
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

  // Refresh all stores when pull sync brings in new data from the web
  useEffect(() => {
    if (!window.electronAPI?.onSyncPullComplete) return;
    return window.electronAPI.onSyncPullComplete(() => {
      useProjectStore.getState().loadProjects();
      useMeetingStore.getState().loadMeetings();
      useIdeaStore.getState().loadIdeas();
      useBrainstormStore.getState().loadSessions();
      useBoardStore.getState().loadAllCards();
      // Reload the active board if the user is viewing one
      const boardState = useBoardStore.getState();
      if (boardState.project?.id) {
        boardState.loadBoard(boardState.project.id);
      }
    });
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
      <KeyboardShortcutsModal isOpen={showShortcutsHelp} onClose={closeShortcutsHelp} />
      <Suspense fallback={null}>
        <FocusStartModal isOpen={showStartModal} onClose={() => useFocusStore.getState().setShowStartModal(false)} />
        {(focusMode === 'focus' || focusMode === 'break') && <FocusOverlay />}
        <FocusCompleteModal isOpen={focusMode === 'completed'} onClose={() => useFocusStore.getState().stop()} />
      </Suspense>
      {recoveryState && (
        <RecoveryDialog state={recoveryState} onRestore={handleRecoveryRestore} onDiscard={handleRecoveryDiscard} />
      )}
      {showTour && (
        <FeatureTour
          onComplete={(proceedToWizard) => {
            setShowTour(false);
            if (proceedToWizard) {
              setShowWizard(true);
            }
          }}
        />
      )}
      {showWizard && <SetupWizard onClose={() => setShowWizard(false)} />}
      {whatsNew && (
        <WhatsNewModal
          version={whatsNew.version}
          releaseType={whatsNew.releaseType}
          sections={whatsNew.sections}
          previousVersions={whatsNew.previousVersions}
          onDismiss={() => {
            setWhatsNew(null);
          }}
        />
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
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/meetings" element={<MeetingsPage />} />
              <Route path="/intel" element={<IntelPage />} />
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
