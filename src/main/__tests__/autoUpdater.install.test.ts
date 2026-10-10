// === FILE PURPOSE ===
// installUpdate (UPDATER-SAFE.1): never during a recording, never a file whose bytes
// changed since they were verified (checked before AND after shutdown), never twice,
// and on success the app's services are shut down BEFORE the installer is spawned,
// then the app quits through the normal path (app.quit, so will-quit still fires).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const order = vi.hoisted(() => [] as string[]);
const recording = vi.hoisted(() => ({ ui: false, audio: false }));

vi.mock('electron', () => ({
  app: {
    quit: vi.fn(() => order.push('quit')),
    exit: vi.fn(() => order.push('exit')),
    getPath: vi.fn(),
    getVersion: vi.fn(),
    isPackaged: true,
    on: vi.fn(),
  },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn() },
  net: { fetch: vi.fn() },
  Notification: class {},
  shell: { openExternal: vi.fn() },
}));
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    order.push('spawn');
    return { unref: vi.fn(), on: vi.fn() };
  }),
}));
vi.mock('../services/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../services/recordingState', () => ({ getIsRecording: () => recording.ui }));
vi.mock('../services/audioProcessor', () => ({ isRecording: () => recording.audio }));

let installer: { path: string; sha256: string };
const shutdown = vi.fn(async () => {
  await new Promise((r) => setTimeout(r, 10));
  order.push('shutdown');
});

/** Fresh module per test: installUpdate keeps an "install in progress" flag. */
async function load() {
  const { installUpdate } = await import('../autoUpdater');
  const { spawn } = await import('node:child_process');
  const { app } = await import('electron');
  return { installUpdate, spawn: vi.mocked(spawn), app };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  order.length = 0;
  recording.ui = false;
  recording.audio = false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-install-'));
  const file = path.join(dir, 'LifeDash-9.9.9-Setup.exe');
  fs.writeFileSync(file, 'verified installer bytes');
  installer = { path: file, sha256: createHash('sha256').update('verified installer bytes').digest('hex') };
});

describe('installUpdate', () => {
  it('shuts the services down before spawning the installer, then quits normally', async () => {
    const { installUpdate, spawn, app } = await load();
    void installUpdate(installer, shutdown); // never resolves: the app is quitting
    await vi.waitFor(() => expect(order).toEqual(['shutdown', 'spawn', 'quit']));
    expect(spawn.mock.calls[0][0]).toBe(installer.path);
    expect(spawn.mock.calls[0][1]).toContain('/VERYSILENT');
    expect(app.exit).not.toHaveBeenCalled();
  });

  it('starts only one installer when Install is clicked twice', async () => {
    const { installUpdate, spawn } = await load();
    void installUpdate(installer, shutdown);
    const second = await installUpdate(installer, shutdown);
    expect(second.reason).toMatch(/already being installed/);
    await vi.waitFor(() => expect(order).toContain('quit'));
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('does not run an installer that changed during shutdown, but still quits (services are down)', async () => {
    const { installUpdate, spawn } = await load();
    const tamperingShutdown = vi.fn(async () => {
      fs.writeFileSync(installer.path, 'swapped while shutting down');
      order.push('shutdown');
    });
    void installUpdate(installer, tamperingShutdown);
    await vi.waitFor(() => expect(order).toEqual(['shutdown', 'quit']));
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ['the window reports a recording', 'ui'],
    ['the audio pipeline is recording', 'audio'],
  ] as const)('refuses while %s', async (_label, source) => {
    const { installUpdate, spawn, app } = await load();
    recording[source] = true;
    const refusal = await installUpdate(installer, shutdown);
    expect(refusal.reason).toMatch(/recording/);
    expect(refusal.discardDownload).toBe(false);
    expect(shutdown).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('refuses and discards an installer whose bytes changed after verification', async () => {
    const { installUpdate, spawn } = await load();
    fs.writeFileSync(installer.path, 'tampered');
    const refusal = await installUpdate(installer, shutdown);
    expect(refusal).toEqual({ reason: expect.stringMatching(/verification/), discardDownload: true });
    expect(shutdown).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses when the installer file is gone', async () => {
    const { installUpdate, spawn } = await load();
    fs.rmSync(installer.path);
    expect((await installUpdate(installer, shutdown)).discardDownload).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses when nothing was downloaded', async () => {
    const { installUpdate, spawn } = await load();
    expect((await installUpdate(null, shutdown)).reason).toMatch(/No update/);
    expect(spawn).not.toHaveBeenCalled();
  });
});
