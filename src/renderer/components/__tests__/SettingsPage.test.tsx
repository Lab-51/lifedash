// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Polyfills for jsdom missing APIs
// ---------------------------------------------------------------------------
if (typeof window.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

if (typeof navigator.mediaDevices === 'undefined') {
  Object.defineProperty(navigator, 'mediaDevices', {
    writable: true,
    value: {
      enumerateDevices: vi.fn().mockResolvedValue([]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

// ---------------------------------------------------------------------------
// Mock window.electronAPI with a Proxy that auto-stubs missing methods.
// The Settings page has many sub-components calling many different IPC methods.
// Rather than listing every one, we provide explicit mocks for critical ones
// and fall back to safe defaults for the rest.
// ---------------------------------------------------------------------------
const explicitMocks: Record<string, any> = {
  // Settings store
  getAIProviders: vi.fn().mockResolvedValue([]),
  getAllSettings: vi.fn().mockResolvedValue({}),
  isEncryptionAvailable: vi.fn().mockResolvedValue(true),
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(null),
  deleteSetting: vi.fn().mockResolvedValue(undefined),
  // Update events
  onUpdateStatus: vi.fn().mockReturnValue(() => {}),
  onBackupProgress: vi.fn().mockReturnValue(() => {}),
  onWhisperDownloadProgress: vi.fn().mockReturnValue(() => {}),
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
  installUpdate: vi.fn().mockResolvedValue(undefined),
  // Usage
  getAIUsageSummary: vi.fn().mockResolvedValue({ totalTokens: 0, totalCost: 0, byProvider: [] }),
  getAIUsageDaily: vi.fn().mockResolvedValue([]),
  // Statics
  appVersion: '2.2.15',
  platform: 'win32',
};

const electronAPIProxy = new Proxy(explicitMocks, {
  get(target, prop) {
    if (prop in target) return target[prop as string];
    // Auto-stub: if the method name starts with "on", return an event unsubscriber.
    // Otherwise, return a resolved-value mock.
    if (typeof prop === 'string' && prop.startsWith('on')) {
      const fn = vi.fn().mockReturnValue(() => {});
      target[prop] = fn;
      return fn;
    }
    const fn = vi.fn().mockResolvedValue(null);
    target[prop as string] = fn;
    return fn;
  },
});

const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
  matches: query === '(prefers-color-scheme: dark)',
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

vi.stubGlobal('window', {
  ...window,
  electronAPI: electronAPIProxy,
  matchMedia: matchMediaMock,
});

// ---------------------------------------------------------------------------
// Import stores and component after mocking
// ---------------------------------------------------------------------------
const { useSettingsStore } = await import('../../stores/settingsStore');
const { useBackupStore } = await import('../../stores/backupStore');
const { default: SettingsPageModern } = await import('../SettingsPageModern');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderComponent() {
  return render(
    <MemoryRouter>
      <SettingsPageModern />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SettingsPageModern', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Override store actions to no-ops so mount effects don't trigger loading
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
    } as any);

    useBackupStore.setState({
      backups: [],
      loading: false,
      error: null,
      progress: null,
      autoSettings: null,
    } as any);
  });

  it('renders without crashing', () => {
    renderComponent();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('tab navigation elements render', () => {
    renderComponent();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('AI & Models')).toBeInTheDocument();
    expect(screen.getByText('Data & Storage')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('section headers visible on general tab', () => {
    renderComponent();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Audio')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
    // "Notifications" appears in both the section heading and sub-content
    expect(screen.getAllByText('Notifications').length).toBeGreaterThanOrEqual(1);
  });

  it('default tab (General) is selected — Appearance section visible', () => {
    renderComponent();
    expect(screen.getByText('Customize the visual experience.')).toBeInTheDocument();
  });

  it('multiple tabs exist and can be clicked', async () => {
    const user = userEvent.setup();
    renderComponent();

    const aiTab = screen.getByText('AI & Models');
    await user.click(aiTab);

    // AI tab shows the provider section
    expect(screen.getByText('AI Providers')).toBeInTheDocument();
  });

  it('displays page subtitle', () => {
    renderComponent();
    expect(screen.getByText('Manage preferences and configurations.')).toBeInTheDocument();
  });

  it('shows the system label', () => {
    renderComponent();
    expect(screen.getByText('SYS.SETTINGS')).toBeInTheDocument();
  });
});
