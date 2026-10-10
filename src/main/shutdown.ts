// === FILE PURPOSE ===
// Runs the app's shutdown steps exactly once, in order, and never longer than a hard
// timeout (UPDATER-SAFE.1). Both a normal quit and an update install await it, so the
// database is closed and llama-server stopped before the process exits — previously
// before-quit was an un-awaited async listener and the updater called process.exit.
// createQuitHandler is the before-quit listener built on it: it asks first during a
// recording, holds the quit until shutdown finishes, then lets Electron complete the
// quit normally (windows close, will-quit fires — Sentry ends its session there).

export interface QuitEvent {
  preventDefault: () => void;
}

export interface QuitHandlerDeps {
  shutdown: () => Promise<void>;
  isRecording: () => boolean;
  /**
   * Asks the user whether to stop the recording and quit. Resolves true to go on
   * quitting (the recording has been stopped), false to cancel. Null when it cannot ask
   * (no window) — the quit then proceeds and shutdown saves what was recorded.
   */
  confirmQuitWhileRecording: () => Promise<boolean> | null;
  /** app.quit — re-enters the handler, which lets it through once shutdown is done. */
  quit: () => void;
  onCancelled: () => void;
}

export function createQuitHandler(deps: QuitHandlerDeps): (event: QuitEvent) => void {
  let shutdownDone = false;
  let asking = false;
  let shuttingDown = false;
  return (event) => {
    if (shutdownDone) return; // let Electron finish the quit normally
    event.preventDefault();
    if (asking || shuttingDown) return;
    if (deps.isRecording()) {
      const answer = deps.confirmQuitWhileRecording();
      if (answer) {
        asking = true;
        answer.then(
          (goOn) => {
            asking = false;
            if (goOn) deps.quit();
            else deps.onCancelled();
          },
          () => {
            asking = false;
            deps.onCancelled();
          },
        );
        return;
      }
    }
    shuttingDown = true;
    void deps.shutdown().finally(() => {
      shutdownDone = true;
      deps.quit();
    });
  };
}

export type ShutdownStep = { name: string; run: () => void | Promise<void> };

interface ShutdownLog {
  info: (message: string) => void;
  warn: (message: string, err?: unknown) => void;
}

/**
 * Returns a function that runs `steps` in order on its first call (a failing step is
 * logged and the rest still run) and resolves when they finish or `timeoutMs` passes,
 * whichever is first. Later calls share the first run.
 */
export function createShutdown(steps: ShutdownStep[], log: ShutdownLog, timeoutMs: number): () => Promise<void> {
  let running: Promise<void> | null = null;
  let bounded: Promise<void> | null = null;
  // One run and ONE timeout shared by every caller: an update install and the quit it
  // triggers must not each get their own full timeout.
  return () => {
    running ??= (async () => {
      const started = Date.now();
      for (const step of steps) {
        try {
          await step.run();
        } catch (err) {
          log.warn(`Shutdown step "${step.name}" failed (continuing):`, err);
        }
      }
      log.info(`Shutdown complete in ${Date.now() - started} ms`);
    })();
    bounded ??= Promise.race([
      running,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          log.warn(`Shutdown still running after ${timeoutMs} ms — exiting anyway`);
          resolve();
        }, timeoutMs).unref();
      }),
    ]);
    return bounded;
  };
}
