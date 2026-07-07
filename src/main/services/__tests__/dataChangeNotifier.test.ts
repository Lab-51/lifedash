// === FILE PURPOSE ===
// Unit tests for notifyDataChanged — verifies the broadcast reaches every live
// renderer window (mocked webContents), skips destroyed windows, and passes the
// payload through unchanged.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Controllable window list backing the mocked BrowserWindow.getAllWindows().
const { windowsRef } = vi.hoisted(() => ({ windowsRef: { current: [] as Array<Record<string, unknown>> } }));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => windowsRef.current },
}));

import { notifyDataChanged } from '../dataChangeNotifier';

function makeWindow(destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() },
  };
}

beforeEach(() => {
  windowsRef.current = [];
});

describe('notifyDataChanged', () => {
  it('sends data:changed with the payload to every non-destroyed window', () => {
    const w1 = makeWindow();
    const w2 = makeWindow();
    windowsRef.current = [w1, w2];

    notifyDataChanged({ scope: 'cards', projectId: 'proj-1' });

    expect(w1.webContents.send).toHaveBeenCalledWith('data:changed', { scope: 'cards', projectId: 'proj-1' });
    expect(w2.webContents.send).toHaveBeenCalledWith('data:changed', { scope: 'cards', projectId: 'proj-1' });
  });

  it('skips destroyed windows so a closing window never receives the event', () => {
    const dead = makeWindow(true);
    const live = makeWindow();
    windowsRef.current = [dead, live];

    notifyDataChanged({ scope: 'projects', projectId: 'proj-9' });

    expect(dead.webContents.send).not.toHaveBeenCalled();
    expect(live.webContents.send).toHaveBeenCalledWith('data:changed', { scope: 'projects', projectId: 'proj-9' });
  });

  it('forwards a payload with no projectId (renderer refetches the visible board)', () => {
    const w = makeWindow();
    windowsRef.current = [w];

    notifyDataChanged({ scope: 'cards' });

    expect(w.webContents.send).toHaveBeenCalledWith('data:changed', { scope: 'cards' });
  });

  it('is a no-op when there are no open windows', () => {
    expect(() => notifyDataChanged({ scope: 'columns', projectId: 'p' })).not.toThrow();
  });
});
