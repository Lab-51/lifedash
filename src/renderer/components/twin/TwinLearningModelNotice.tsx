// === FILE PURPOSE ===
// One honest line in the Twin Memory tab header when fact learning is OFF because
// no model is allowed to run it (TWIN-LOOP.2 Task 1). Learning reads every
// meeting's notes, so it runs only on a model the user chose for it or on a local
// model — never the first-enabled-provider fallback. Without this line the twin
// would silently stop learning and nothing on the page would say why.
//
// Self-gating: renders nothing while loading, when the lookup fails (an unknown
// state is never reported as "off"), and when learning will run. Re-checks each
// time the Memory tab becomes the active one, so choosing a model in Settings and
// coming back clears the line.
//
// === DEPENDENCIES ===
// react, window.electronAPI.twinGetLearningModel

import { useEffect, useState } from 'react';
import type { TwinLearningModelInfo } from '../../../shared/types/twin';

export default function TwinLearningModelNotice({ active = true }: { active?: boolean }) {
  const [info, setInfo] = useState<TwinLearningModelInfo | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    // Promise.resolve().then so a missing/throwing bridge lands in the catch below.
    void Promise.resolve()
      .then(() => window.electronAPI.twinGetLearningModel())
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!info || info.willLearn) return null;
  return (
    <div
      role="status"
      className="shrink-0 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300"
    >
      Learning is off: choose a local model, or set a Twin learning model in Settings.
    </div>
  );
}
