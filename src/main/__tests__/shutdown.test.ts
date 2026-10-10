// === FILE PURPOSE ===
// createShutdown (UPDATER-SAFE.1): steps run once, in order, a failing step does not
// stop the rest, and a hung step cannot hold the app open past the timeout.

import { describe, it, expect, vi } from 'vitest';
import { createQuitHandler, createShutdown, type QuitHandlerDeps } from '../shutdown';

const quietLog = () => ({ info: vi.fn(), warn: vi.fn() });

describe('createShutdown', () => {
  it('runs every step in order, awaiting async ones', async () => {
    const order: string[] = [];
    const shutdown = createShutdown(
      [
        { name: 'a', run: () => void order.push('a') },
        {
          name: 'b',
          run: async () => {
            await new Promise((r) => setTimeout(r, 10));
            order.push('b');
          },
        },
        { name: 'c', run: () => void order.push('c') },
      ],
      quietLog(),
      1000,
    );
    await shutdown();
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('keeps going after a failing step', async () => {
    const ran = vi.fn();
    const log = quietLog();
    const shutdown = createShutdown(
      [
        {
          name: 'boom',
          run: () => {
            throw new Error('x');
          },
        },
        { name: 'database', run: ran },
      ],
      log,
      1000,
    );
    await shutdown();
    expect(ran).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('boom'), expect.any(Error));
  });

  it('runs the steps only once however many callers', async () => {
    const run = vi.fn();
    const shutdown = createShutdown([{ name: 'once', run }], quietLog(), 1000);
    await Promise.all([shutdown(), shutdown(), shutdown()]);
    expect(run).toHaveBeenCalledOnce();
  });

  it('shares ONE timeout between callers, so a second caller does not extend the wait', async () => {
    const shutdown = createShutdown([{ name: 'hang', run: () => new Promise<void>(() => undefined) }], quietLog(), 80);
    const started = Date.now();
    await shutdown();
    const firstDone = Date.now() - started;
    await shutdown(); // e.g. the quit an update install triggers
    expect(Date.now() - started).toBeLessThan(firstDone + 40);
  });

  it('resolves at the timeout when a step hangs', async () => {
    const log = quietLog();
    const shutdown = createShutdown([{ name: 'hang', run: () => new Promise<void>(() => undefined) }], log, 50);
    const started = Date.now();
    await shutdown();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('exiting anyway'));
  });
});

describe('createQuitHandler', () => {
  const event = () => ({ preventDefault: vi.fn() });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  function deps(overrides: Partial<QuitHandlerDeps> = {}) {
    return {
      shutdown: vi.fn(async () => undefined),
      isRecording: vi.fn(() => false),
      confirmQuitWhileRecording: vi.fn((): Promise<boolean> | null => Promise.resolve(true)),
      quit: vi.fn(),
      onCancelled: vi.fn(),
      ...overrides,
    };
  }

  it('holds the quit, shuts down once, re-issues the quit, then lets it through', async () => {
    const d = deps();
    const onQuit = createQuitHandler(d);
    const first = event();
    onQuit(first);
    expect(first.preventDefault).toHaveBeenCalled();
    await flush();
    expect(d.shutdown).toHaveBeenCalledOnce();
    expect(d.quit).toHaveBeenCalledOnce();

    const second = event(); // the re-issued quit
    onQuit(second);
    expect(second.preventDefault).not.toHaveBeenCalled(); // Electron finishes normally: will-quit fires
    expect(d.shutdown).toHaveBeenCalledOnce();
  });

  it('asks during a recording and quits only after the user chose to stop', async () => {
    const d = deps({ isRecording: vi.fn().mockReturnValueOnce(true).mockReturnValue(false) });
    const onQuit = createQuitHandler(d);
    onQuit(event());
    expect(d.confirmQuitWhileRecording).toHaveBeenCalledOnce();
    expect(d.shutdown).not.toHaveBeenCalled();
    await flush();
    expect(d.quit).toHaveBeenCalledOnce(); // re-enters; the recording has stopped by now
    onQuit(event());
    await flush();
    expect(d.shutdown).toHaveBeenCalledOnce();
  });

  it('cancels the quit when the user keeps recording', async () => {
    const d = deps({ isRecording: vi.fn(() => true), confirmQuitWhileRecording: vi.fn(() => Promise.resolve(false)) });
    createQuitHandler(d)(event());
    await flush();
    expect(d.onCancelled).toHaveBeenCalledOnce();
    expect(d.shutdown).not.toHaveBeenCalled();
    expect(d.quit).not.toHaveBeenCalled();
  });

  it('treats a failed dialog as "keep recording"', async () => {
    const d = deps({
      isRecording: vi.fn(() => true),
      confirmQuitWhileRecording: vi.fn(() => Promise.reject(new Error('x'))),
    });
    createQuitHandler(d)(event());
    await flush();
    expect(d.onCancelled).toHaveBeenCalledOnce();
    expect(d.shutdown).not.toHaveBeenCalled();
  });

  it('shuts down (saving the recording) when there is no window to ask', async () => {
    const d = deps({ isRecording: vi.fn(() => true), confirmQuitWhileRecording: vi.fn(() => null) });
    createQuitHandler(d)(event());
    await flush();
    expect(d.shutdown).toHaveBeenCalledOnce();
    expect(d.quit).toHaveBeenCalledOnce();
  });

  it('ignores repeated quit requests while asking or shutting down', async () => {
    let answer!: (goOn: boolean) => void;
    const d = deps({
      isRecording: vi.fn(() => true),
      confirmQuitWhileRecording: vi.fn(() => new Promise<boolean>((r) => (answer = r))),
    });
    const onQuit = createQuitHandler(d);
    onQuit(event());
    const again = event();
    onQuit(again);
    expect(again.preventDefault).toHaveBeenCalled();
    expect(d.confirmQuitWhileRecording).toHaveBeenCalledOnce();
    answer(false);
    await flush();
    expect(d.shutdown).not.toHaveBeenCalled();
    expect(d.quit).not.toHaveBeenCalled();
  });

  it('holds repeated quits during shutdown without running it twice', async () => {
    let finish!: () => void;
    const d = deps({ shutdown: vi.fn(() => new Promise<void>((r) => (finish = r))) });
    const onQuit = createQuitHandler(d);
    onQuit(event());
    const again = event();
    onQuit(again);
    expect(again.preventDefault).toHaveBeenCalled();
    expect(d.shutdown).toHaveBeenCalledOnce();
    finish();
    await flush();
    expect(d.quit).toHaveBeenCalledOnce();
  });
});
