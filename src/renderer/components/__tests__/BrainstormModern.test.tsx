// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Polyfill scrollIntoView for jsdom (used by auto-scroll effect)
// ---------------------------------------------------------------------------
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = vi.fn();
}

// ---------------------------------------------------------------------------
// Mock window.electronAPI — must happen before any store or component import
// ---------------------------------------------------------------------------
vi.stubGlobal('electronAPI', {
  getBrainstormSessions: vi.fn().mockResolvedValue([]),
  getBrainstormSession: vi.fn().mockResolvedValue(null),
  createBrainstormSession: vi.fn().mockResolvedValue({ id: 'bs-1' }),
  updateBrainstormSession: vi.fn().mockResolvedValue(undefined),
  deleteBrainstormSession: vi.fn().mockResolvedValue(undefined),
  sendBrainstormMessage: vi.fn().mockResolvedValue(undefined),
  abortBrainstorm: vi.fn().mockResolvedValue(undefined),
  exportBrainstormToIdea: vi.fn().mockResolvedValue({ id: 'idea-1' }),
  exportBrainstormToCard: vi.fn().mockResolvedValue(undefined),
  onBrainstormChunk: vi.fn().mockReturnValue(() => {}),
  getProjects: vi.fn().mockResolvedValue([]),
  getAIProviders: vi.fn().mockResolvedValue([]),
  getAllSettings: vi.fn().mockResolvedValue({}),
  isEncryptionAvailable: vi.fn().mockResolvedValue(true),
  getSetting: vi.fn().mockResolvedValue(null),
  voiceTranscribe: vi.fn().mockResolvedValue(''),
  hasWhisperModel: vi.fn().mockResolvedValue(false),
  onWhisperDownloadProgress: vi.fn().mockReturnValue(() => {}),
  appVersion: '2.2.15',
  platform: 'win32',
});

// ---------------------------------------------------------------------------
// Import stores and component AFTER mocking
// ---------------------------------------------------------------------------
const { useBrainstormStore } = await import('../../stores/brainstormStore');
const { useProjectStore } = await import('../../stores/projectStore');
const { useSettingsStore } = await import('../../stores/settingsStore');
const { default: BrainstormModern } = await import('../BrainstormModern');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderComponent() {
  return render(
    <MemoryRouter>
      <BrainstormModern />
    </MemoryRouter>,
  );
}

const makeSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'bs-1',
  title: 'Marketing Ideas',
  status: 'active' as const,
  templateId: 'freeform',
  projectId: null,
  createdAt: '2026-03-10T10:00:00Z',
  updatedAt: '2026-03-10T10:30:00Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('BrainstormModern', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useBrainstormStore.setState({
      sessions: [],
      activeSession: null,
      loadingSessions: false,
      loadingSession: false,
      streaming: false,
      streamingText: '',
      draftInput: '',
      error: null,
      loadSessions: vi.fn().mockResolvedValue(undefined),
      loadSession: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn().mockResolvedValue({ id: 'bs-new' }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      abortStream: vi.fn().mockResolvedValue(undefined),
      exportToIdea: vi.fn().mockResolvedValue({ id: 'idea-1' }),
      exportToCard: vi.fn().mockResolvedValue(undefined),
      clearActiveSession: vi.fn(),
      setDraftInput: vi.fn(),
      consumeDraftInput: vi.fn().mockReturnValue(''),
    } as any);

    useProjectStore.setState({
      projects: [],
      loading: false,
      error: null,
      loadProjects: vi.fn().mockResolvedValue(undefined),
    } as any);

    useSettingsStore.setState({
      providers: [],
      settings: {},
      loading: false,
      error: null,
      connectionTests: {},
      encryptionAvailable: true,
      loadProviders: vi.fn().mockResolvedValue(undefined),
      loadSettings: vi.fn().mockResolvedValue(undefined),
      checkEncryption: vi.fn().mockResolvedValue(undefined),
      hasAnyEnabledProvider: vi.fn().mockReturnValue(true),
    } as any);
  });

  it('renders without crashing', () => {
    renderComponent();
    expect(screen.getByText('Brainstorm')).toBeInTheDocument();
  });

  it('shows the system label', () => {
    renderComponent();
    expect(screen.getByText('SYS.BRAINSTORM')).toBeInTheDocument();
  });

  it('shows New Session button', () => {
    renderComponent();
    expect(screen.getByText('New Session')).toBeInTheDocument();
  });

  it('shows empty state when no sessions and no active session', () => {
    renderComponent();
    expect(screen.getByText('Think out loud with AI')).toBeInTheDocument();
  });

  it('displays session list when sessions exist', () => {
    useBrainstormStore.setState({
      sessions: [
        makeSession({ id: 'bs-1', title: 'Marketing Ideas' }),
        makeSession({ id: 'bs-2', title: 'Product Roadmap' }),
      ] as any,
    });

    renderComponent();
    expect(screen.getByText('Marketing Ideas')).toBeInTheDocument();
    expect(screen.getByText('Product Roadmap')).toBeInTheDocument();
  });

  it('shows message input area when a session is active', () => {
    useBrainstormStore.setState({
      sessions: [makeSession()] as any,
      activeSession: {
        ...makeSession(),
        messages: [],
      } as any,
    });

    renderComponent();
    const textarea = screen.getByPlaceholderText('Message AI...');
    expect(textarea).toBeInTheDocument();
  });

  it('shows sidebar tab buttons (active/archived)', () => {
    useBrainstormStore.setState({
      sessions: [makeSession()] as any,
    });

    renderComponent();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });
});
