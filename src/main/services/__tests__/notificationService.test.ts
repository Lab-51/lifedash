// === FILE PURPOSE ===
// Unit tests for notificationService — POST-FLOW.1's new surface: the
// `briefReady` preference (additive, default true), showNotification's
// additive `onClick`, and notifyBriefReady's pref gating + click-to-focus/
// navigate. Pre-existing behaviour (due-date/daily-digest notifications) is
// untouched by this phase and is not re-tested here — this file is scoped to
// what POST-FLOW.1 added.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

// A minimal, constructible Notification double: tracks every instance so a
// test can assert what was constructed (or that nothing was), and captures
// 'click' handlers so a test can simulate a user click without a real OS
// notification. Mirrors dataChangeNotifier.test.ts's windowsRef pattern —
// state shared between the hoisted mock factory and the test bodies below.
const { notificationsRef, isSupportedMock } = vi.hoisted(() => ({
  notificationsRef: { current: [] as Array<Record<string, unknown>> },
  isSupportedMock: vi.fn(() => true),
}));

vi.mock('electron', () => {
  class MockNotification {
    title: string;
    body: string;
    clickHandlers: Array<() => void> = [];
    show = vi.fn();
    static isSupported = isSupportedMock;
    constructor(opts: { title: string; body: string }) {
      this.title = opts.title;
      this.body = opts.body;
      notificationsRef.current.push(this as unknown as Record<string, unknown>);
    }
    on(event: string, handler: () => void) {
      if (event === 'click') this.clickHandlers.push(handler);
      return this;
    }
  }
  return {
    Notification: MockNotification,
    BrowserWindow: class {},
  };
});

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({ settings: { key: 'key', value: 'value' } }));

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { showNotification, notifyBriefReady, setMainWindow, getNotificationPreferences } from '../notificationService';
import { getDb } from '../../db/connection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stored settings rows the mocked DB read returns — [] means "no stored prefs". */
const storedRows: { current: { key: string; value: string }[] } = { current: [] };

function makeFakeWindow() {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  notificationsRef.current = [];
  storedRows.current = [];
  isSupportedMock.mockReturnValue(true);
  vi.mocked(getDb).mockReturnValue({
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(storedRows.current) }) }) }),
  } as never);
});

// ---------------------------------------------------------------------------
// briefReady preference — additive, default true (POST-FLOW.1)
// ---------------------------------------------------------------------------

describe('briefReady preference default (POST-FLOW.1)', () => {
  it('defaults to true when no preferences have ever been stored', async () => {
    storedRows.current = [];

    const prefs = await getNotificationPreferences();

    expect(prefs.briefReady).toBe(true);
  });

  it('defaults to true for a stored preferences blob written before briefReady existed', async () => {
    storedRows.current = [
      { key: 'notification_preferences', value: JSON.stringify({ enabled: true, dueDateReminders: false }) },
    ];

    const prefs = await getNotificationPreferences();

    expect(prefs.briefReady).toBe(true);
    expect(prefs.dueDateReminders).toBe(false); // stored values still win where present
  });

  it('respects an explicit stored false', async () => {
    storedRows.current = [
      { key: 'notification_preferences', value: JSON.stringify({ enabled: true, briefReady: false }) },
    ];

    const prefs = await getNotificationPreferences();

    expect(prefs.briefReady).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// showNotification — additive onClick (POST-FLOW.1)
// ---------------------------------------------------------------------------

describe('showNotification — additive onClick', () => {
  it('omitting onClick constructs a notification with no click handler (byte-compatible with every pre-existing caller)', () => {
    showNotification('Card Due Soon', '"Ship it" is due tomorrow');

    expect(notificationsRef.current).toHaveLength(1);
    const [n] = notificationsRef.current as unknown as { clickHandlers: unknown[] }[];
    expect(n.clickHandlers).toHaveLength(0);
  });

  it('an onClick handler fires when the notification is clicked', () => {
    const onClick = vi.fn();
    showNotification('LifeDash', 'Brief ready — Weekly Sync', onClick);

    const [n] = notificationsRef.current as unknown as { clickHandlers: Array<() => void> }[];
    expect(n.clickHandlers).toHaveLength(1);
    n.clickHandlers[0]();

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// notifyBriefReady — pref-gated arrival notification (POST-FLOW.1)
// ---------------------------------------------------------------------------

describe('notifyBriefReady', () => {
  it('does not construct a Notification when briefReady is off', async () => {
    storedRows.current = [
      { key: 'notification_preferences', value: JSON.stringify({ enabled: true, briefReady: false }) },
    ];

    await notifyBriefReady('meeting-1', 'Weekly Sync');

    expect(notificationsRef.current).toHaveLength(0);
  });

  it('does not construct a Notification when the master toggle is off', async () => {
    storedRows.current = [
      { key: 'notification_preferences', value: JSON.stringify({ enabled: false, briefReady: true }) },
    ];

    await notifyBriefReady('meeting-1', 'Weekly Sync');

    expect(notificationsRef.current).toHaveLength(0);
  });

  it('constructs a notification with the pinned body copy when enabled', async () => {
    storedRows.current = [];

    await notifyBriefReady('meeting-1', 'Weekly Sync');

    expect(notificationsRef.current).toHaveLength(1);
    const [n] = notificationsRef.current as unknown as { title: string; body: string }[];
    expect(n.title).toBe('LifeDash');
    expect(n.body).toBe('Brief ready — Weekly Sync');
  });

  it('a click focuses the main window and navigates the renderer to the session route', async () => {
    const win = makeFakeWindow();
    setMainWindow(win as never);
    storedRows.current = [];

    await notifyBriefReady('meeting-42', 'Weekly Sync');

    const [n] = notificationsRef.current as unknown as { clickHandlers: Array<() => void> }[];
    expect(n.clickHandlers).toHaveLength(1);
    n.clickHandlers[0]();

    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith('app:navigate', '/session/meeting-42');
  });

  it('a click on a destroyed window is a silent no-op', async () => {
    const win = { ...makeFakeWindow(), isDestroyed: () => true };
    setMainWindow(win as never);
    storedRows.current = [];

    await notifyBriefReady('meeting-42', 'Weekly Sync');

    const [n] = notificationsRef.current as unknown as { clickHandlers: Array<() => void> }[];
    expect(() => n.clickHandlers[0]()).not.toThrow();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('degrades to defaults (never throws) when the preference lookup fails', async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('db unavailable');
    });

    await expect(notifyBriefReady('meeting-1', 'Weekly Sync')).resolves.toBeUndefined();
    // getNotificationPreferences degrades to DEFAULT_PREFERENCES (enabled and
    // briefReady both default true) — a DB failure must never silently swallow
    // the arrival notification, only a genuine off-pref should.
    expect(notificationsRef.current).toHaveLength(1);
  });
});
