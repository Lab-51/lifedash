// === FILE PURPOSE ===
// The two independent twin-memory switches (TWIN-LOOP.2 Task 2), shown in the Memory
// tab header:
//   - "Pause learning"  (twin.learningPaused) — stops NEW facts being learned.
//   - "Use learned facts" (twin.factsInUse)   — whether the facts it already learned
//     are applied to briefs, chat and triage.
// Before this task pausing silently did both. They are native checkbox inputs with
// role="switch" (keyboard-reachable, Space toggles), each with one plain line saying
// what it does. State lives in the settings store, so it survives a refresh; the
// gates themselves stay main-side (twinMemoryService) — this only reflects and flips.
//
// PINNING: with no stored "Use learned facts" choice the main side resolves it from
// the pause flag (legacy-preserving default). If we paused learning from that state,
// the resolved value would flip to OFF and the user would lose what was learned —
// the opposite of what the pause button promises. So the first pause writes the
// CURRENT resolved value down before it pauses.
//
// === DEPENDENCIES ===
// settingsStore, shared/types/twin (setting keys + resolveFactsInUse)

import { useSettingsStore } from '../../stores/settingsStore';
import {
  TWIN_FACTS_IN_USE_SETTING_KEY,
  TWIN_LEARNING_PAUSED_SETTING_KEY,
  resolveFactsInUse,
} from '../../../shared/types/twin';

/** The banner line for the current switch state, or null when both are at rest. */
export function learningStatusLine(paused: boolean, factsInUse: boolean): string | null {
  if (paused && factsInUse)
    return 'Learning is paused — no new facts are being learned. Existing facts are still applied.';
  if (paused) return 'Learning is paused — no new facts are being learned or applied.';
  if (!factsInUse) return 'Learned facts are switched off — they are not applied to briefs, chat or triage.';
  return null;
}

/** Reads both switches from the settings store in one place, host and switches alike. */
export function useLearningSwitchState(): { paused: boolean; factsInUse: boolean } {
  const settings = useSettingsStore((s) => s.settings);
  const paused = settings[TWIN_LEARNING_PAUSED_SETTING_KEY] === 'true';
  return { paused, factsInUse: resolveFactsInUse(settings[TWIN_FACTS_IN_USE_SETTING_KEY], paused) };
}

interface SwitchRowProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}

function SwitchRow({ id, label, description, checked, onChange }: SwitchRowProps) {
  return (
    <div className="flex items-start gap-2 min-w-0 max-w-[16rem]">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={onChange}
        aria-describedby={`${id}-desc`}
        className="mt-0.5 w-4 h-4 shrink-0 cursor-pointer accent-[var(--color-accent)]"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-xs font-medium text-[var(--color-text-primary)] cursor-pointer">
          {label}
        </label>
        <p id={`${id}-desc`} className="text-xs text-[var(--color-text-secondary)] break-words">
          {description}
        </p>
      </div>
    </div>
  );
}

export default function TwinLearningSwitches() {
  const setSetting = useSettingsStore((s) => s.setSetting);
  const storedFactsInUse = useSettingsStore((s) => s.settings[TWIN_FACTS_IN_USE_SETTING_KEY]);
  const { paused, factsInUse } = useLearningSwitchState();

  const togglePause = async (): Promise<void> => {
    if (!paused && storedFactsInUse === undefined) {
      await setSetting(TWIN_FACTS_IN_USE_SETTING_KEY, String(factsInUse));
    }
    await setSetting(TWIN_LEARNING_PAUSED_SETTING_KEY, paused ? 'false' : 'true');
  };

  const toggleFacts = async (): Promise<void> => {
    await setSetting(TWIN_FACTS_IN_USE_SETTING_KEY, factsInUse ? 'false' : 'true');
  };

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 min-w-0">
      <SwitchRow
        id="twin-pause-learning"
        label="Pause learning"
        description="Stop learning new facts from your sessions. What it already learned stays."
        checked={paused}
        onChange={() => void togglePause()}
      />
      <SwitchRow
        id="twin-use-facts"
        label="Use learned facts"
        description="Let briefs, chat and triage draw on learned facts. Your profile is always used."
        checked={factsInUse}
        onChange={() => void toggleFacts()}
      />
    </div>
  );
}
