// === FILE PURPOSE ===
// The step Settings was missing: turning a DOWNLOADED GGUF into a local AI the
// app actually routes to. Downloading a model from the catalog creates NO
// `builtin` provider row — only the setup wizard did that — so a user could pull
// 2.3 GB down from this page and reach a dead end: nothing routed to the file,
// and (once the status-bar indicator shipped) nothing visible either, because
// visibility keys on an enabled `builtin` provider existing.
//
// Shown only while that row is absent AND a chat model is on disk; it disappears
// by itself the moment activation succeeds, because the provider-CRUD push flips
// `configured` true.
//
// === DEPENDENCIES ===
// React, lucide-react, HudSelect, settingsStore (provider CRUD + task models),
// useRuntimeStatus (`configured` — a pure read), setup-wizard/localBuiltin
// (routableModels + builtinTaskModelPatch), ./format (tool-calling consequence).
//
// === CONTRACT NOTES ===
// - Writes ONLY on an explicit click. Rendering this costs nothing, spawns
//   nothing and downloads nothing (LOCAL-RT.1's optionality contract).
// - Reuses the wizard's `builtinTaskModelPatch`, so Settings and the wizard
//   cannot write divergent routing for the same choice.
// - Task models are MERGED over what is stored, never replaced — a returning
//   user's own assignments survive, same rule the wizard follows.
// - Only DOWNLOADED files are offered: the runtime can serve nothing else.

import { useMemo, useState } from 'react';
import { Cpu, Loader2 } from 'lucide-react';
import type { AITaskType, TaskModelConfig } from '../../../../shared/types';
import type { LocalModelsView } from '../../../../shared/types/localModels';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useRuntimeStatus } from '../../../hooks/useRuntimeStatus';
import { builtinTaskModelPatch, routableModels } from '../../setup-wizard/localBuiltin';
import HudSelect from '../../HudSelect';
import { NO_TOOL_CALLING_CONSEQUENCE } from './format';

/** Option label carries the trade-off at the moment of choosing, matching the
 *  precedent set by Model Assignments' own dropdown. */
const optionLabel = (label: string, toolCalling: boolean) =>
  `${label} — ${toolCalling ? 'tool calling' : 'no tool calling'}`;

export default function EnableBuiltinCard({ view, onActivated }: { view: LocalModelsView; onActivated: () => void }) {
  const { snapshot } = useRuntimeStatus();
  const providers = useSettingsStore((s) => s.providers);
  const createProvider = useSettingsStore((s) => s.createProvider);
  const updateProvider = useSettingsStore((s) => s.updateProvider);
  const loadProviders = useSettingsStore((s) => s.loadProviders);
  const getTaskModels = useSettingsStore((s) => s.getTaskModels);
  const setTaskModels = useSettingsStore((s) => s.setTaskModels);

  const chats = useMemo(() => routableModels(view, 'chat'), [view]);
  const embeddings = useMemo(() => routableModels(view, 'embedding'), [view]);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A dropdown default, NOT a silent config write — nothing is stored until the
  // button is clicked. Tool-callers lead because the Digital Twin needs one.
  const chosen = chats.find((c) => c.id === picked) ?? chats.find((c) => c.toolCalling) ?? chats[0];

  // Wait for the real snapshot before deciding (null would flash the card on for
  // an already-configured user). Hidden once an enabled `builtin` row exists.
  if (!snapshot || snapshot.configured || !chosen) return null;

  const activate = async () => {
    setBusy(true);
    setError(null);
    try {
      // Reuse a row the user may already have (possibly disabled) rather than
      // adding a duplicate — the same rule the wizard follows.
      const existing = providers.find((p) => p.name === 'builtin');
      const provider = existing ?? (await createProvider({ name: 'builtin' }));
      if (existing && !existing.enabled) await updateProvider(existing.id, { enabled: true });

      const merged = {
        ...(getTaskModels() ?? {}),
        ...builtinTaskModelPatch(provider.id, { chatModelId: chosen.id, embeddingModelId: embeddings[0]?.id }),
      };
      await setTaskModels(merged as Record<AITaskType, TaskModelConfig>);
      await loadProviders();
      onActivated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch on the built-in runtime.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 p-3 rounded-lg border border-[var(--color-border-accent)] overflow-hidden">
      <div className="flex items-center gap-2">
        <Cpu size={14} className="text-[var(--color-accent)] shrink-0" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Downloaded, but not switched on yet</h3>
      </div>

      <p className="mt-1 text-xs text-[var(--color-text-secondary)] break-words">
        Downloading a model does not start using it. Switch on the built-in runtime to route the in-meeting assistant
        {embeddings.length > 0 ? ' and semantic search' : ''} to it. Your other model assignments are kept.
      </p>

      {chats.length > 1 && (
        <div className="mt-2 max-w-md">
          <HudSelect
            value={chosen.id}
            onChange={setPicked}
            ariaLabel="Choose which downloaded chat model to use"
            compact
            options={chats.map((c) => ({ value: c.id, label: optionLabel(c.label, c.toolCalling) }))}
          />
        </div>
      )}

      {!chosen.toolCalling && (
        <p className="mt-2 text-xs text-amber-400/90 break-words">
          {chosen.label} — {NO_TOOL_CALLING_CONSEQUENCE}
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-400 font-data break-words overflow-hidden" role="alert">
          {error}
        </p>
      )}

      <button
        onClick={() => void activate()}
        disabled={busy}
        className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-[var(--color-border-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)] disabled:opacity-50 transition-colors"
      >
        {busy && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
        Use {chats.length > 1 ? 'this model' : chosen.label} for local AI
      </button>
    </div>
  );
}
