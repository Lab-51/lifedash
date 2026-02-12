// === FILE PURPOSE ===
// Custom hook that polls the Electron IPC getDatabaseStatus() endpoint.
// Returns the current database connection status for display in the StatusBar.
// Polls on mount and every 30 seconds, with cleanup on unmount.

// === DEPENDENCIES ===
// react (useState, useEffect, useCallback), window.electronAPI (preload bridge)

import { useState, useEffect, useCallback } from 'react';

interface DatabaseStatusState {
  connected: boolean;
  message: string;
  checking: boolean;
}

const POLL_INTERVAL_MS = 30_000;

function useDatabaseStatus(): DatabaseStatusState {
  const [status, setStatus] = useState<DatabaseStatusState>({
    connected: false,
    message: 'Checking...',
    checking: true,
  });

  const checkStatus = useCallback(async () => {
    // Guard: electronAPI may not exist when running outside Electron (e.g. dev browser)
    if (typeof window === 'undefined' || !window.electronAPI?.getDatabaseStatus) {
      setStatus({
        connected: false,
        message: 'Electron API not available',
        checking: false,
      });
      return;
    }

    try {
      const result = await window.electronAPI.getDatabaseStatus();
      setStatus({
        connected: result.connected,
        message: result.message,
        checking: false,
      });
    } catch (err) {
      setStatus({
        connected: false,
        message: err instanceof Error ? err.message : 'Unknown error',
        checking: false,
      });
    }
  }, []);

  useEffect(() => {
    // Initial check
    checkStatus();

    // Poll every 30 seconds
    const intervalId = setInterval(checkStatus, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [checkStatus]);

  return status;
}

export default useDatabaseStatus;
