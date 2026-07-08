// === FILE PURPOSE ===
// Digital Twin creation MODE-CHOICE screen (V3.3.5). The wizard's entry fork: the
// user writes their free-form brief (the seed for every mode) and picks one of
// three ways to build their twin — Quick form (manual, never gated), Deep
// interview, or Build from my history.
//
// SOTA GATE (WARN + CONTINUE-ANYWAY, never a hard block): the deep paths want a
// state-of-the-art frontier model for quality. When the resolved creation model
// (twin:get-creation-model) is NOT a frontier cloud model, the Deep and History
// cards carry a prominent, unmissable notice offering (a) a one-tap switch to the
// best configured frontier model — writing the SAME `twin_interview` task-model
// setting the Settings row writes, via the existing settings store (NO new IPC) —
// and (b) an explicit "Continue with local model anyway" escape. Quick form is
// NEVER gated; BYOK/offline users keep every deep path.
//
// === DEPENDENCIES ===
// react, lucide-react, settingsStore (existing task-model write path),
// shared/types/ai (FRONTIER_PROVIDERS — the single frontier definition).

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, MessagesSquare, History, Sparkles, ChevronRight, AlertTriangle, Settings } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { isFrontierProvider } from '../../../shared/types/ai';
import type { AIProviderName, AITaskType, TaskModelConfig } from '../../../shared/types/ai';
import type { TwinCreationModel } from '../../../shared/types/twin';

/** Which way the user chose to build their twin. */
export type TwinCreationMode = 'quick' | 'deep' | 'history';

/** Default model to route `twin_interview` to per frontier provider on one-tap.
 *  Every frontier provider in FRONTIER_PROVIDERS has an entry so the one-tap can
 *  auto-route to whichever the user configured (Gemini included — its adapter is live). */
const FRONTIER_DEFAULT_MODEL: Partial<Record<AIProviderName, string>> = {
  openai: 'gpt-5-mini',
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-2.5-flash',
};

const SOTA_MESSAGE =
  'Deep creation is a one-time, cents-scale, quality-critical step — it works best with a state-of-the-art model such as GPT (OpenAI), Claude (Anthropic), or Gemini (Google).';

interface TwinModeChoiceProps {
  brief: string;
  onBriefChange: (brief: string) => void;
  onChoose: (mode: TwinCreationMode) => void;
}

/** The SOTA warn-notice shown on the gated deep cards. When a frontier provider is
 *  configured it offers a one-tap switch to the best one; when NONE is configured it
 *  points at Settings (never a dead notice). "Continue with local model anyway" always
 *  stands — the gate is a warning, never a block. */
function SotaNotice({
  frontierLabel,
  applying,
  onUseFrontier,
  onContinueAnyway,
  onConfigure,
}: {
  frontierLabel: string | null;
  applying: boolean;
  onUseFrontier: () => void;
  onContinueAnyway: () => void;
  onConfigure: () => void;
}) {
  return (
    <div role="note" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
      <p className="flex items-start gap-1.5 text-xs text-amber-500 break-words">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{SOTA_MESSAGE}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {frontierLabel ? (
          <button
            type="button"
            onClick={onUseFrontier}
            disabled={applying}
            className="flex items-center gap-1.5 text-xs border border-[var(--color-accent-dim)] text-[var(--color-accent)] hover:border-[var(--color-accent)] px-2.5 py-1 rounded transition-colors disabled:opacity-50"
          >
            <Sparkles size={13} />
            {applying ? 'Switching…' : `Use ${frontierLabel}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={onConfigure}
            className="flex items-center gap-1.5 text-xs border border-[var(--color-accent-dim)] text-[var(--color-accent)] hover:border-[var(--color-accent)] px-2.5 py-1 rounded transition-colors"
          >
            <Settings size={13} />
            Set up a frontier model in Settings
          </button>
        )}
        <button
          type="button"
          onClick={onContinueAnyway}
          className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] underline transition-colors"
        >
          Continue with local model anyway
        </button>
      </div>
    </div>
  );
}

/** One mode card: an icon, title, description, and either a select affordance or,
 *  when gated, the SOTA notice. */
function ModeCard({
  icon: Icon,
  title,
  description,
  gated,
  notice,
  onSelect,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  gated: boolean;
  notice: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <div className="hud-panel clip-corner-cut-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <Icon size={20} className="text-[var(--color-accent)] shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h3 className="font-hud text-sm text-[var(--color-text-primary)]">{title}</h3>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 break-words">{description}</p>
          </div>
        </div>
        {!gated && (
          <button
            type="button"
            onClick={onSelect}
            aria-label={`Start ${title}`}
            className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg font-medium text-xs bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] transition-all"
          >
            Start
            <ChevronRight size={14} />
          </button>
        )}
      </div>
      {gated && notice}
    </div>
  );
}

export default function TwinModeChoice({ brief, onBriefChange, onChoose }: TwinModeChoiceProps) {
  const navigate = useNavigate();
  const providers = useSettingsStore((s) => s.providers);
  const loadProviders = useSettingsStore((s) => s.loadProviders);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const getTaskModels = useSettingsStore((s) => s.getTaskModels);
  const setTaskModels = useSettingsStore((s) => s.setTaskModels);

  const [creationModel, setCreationModel] = useState<TwinCreationModel | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    window.electronAPI
      .twinGetCreationModel()
      .then(setCreationModel)
      .catch(() => setCreationModel(null));
    // Ensure providers + task-model settings are available for the one-tap.
    void loadProviders();
    void loadSettings();
  }, [loadProviders, loadSettings]);

  // The deep paths are gated only once we KNOW the resolved model is not frontier.
  const gated = creationModel != null && !creationModel.isFrontier;

  const bestFrontier =
    providers.find((p) => p.enabled && p.hasApiKey && isFrontierProvider(p.name) && FRONTIER_DEFAULT_MODEL[p.name]) ??
    null;
  const frontierLabel = bestFrontier ? bestFrontier.displayName || bestFrontier.name : null;

  const handleUseFrontier = async () => {
    if (!bestFrontier || applying) return;
    const model = FRONTIER_DEFAULT_MODEL[bestFrontier.name];
    if (!model) return;
    setApplying(true);
    try {
      const current = getTaskModels() ?? ({} as Record<AITaskType, TaskModelConfig>);
      await setTaskModels({ ...current, twin_interview: { providerId: bestFrontier.id, model } });
      // Re-resolve so the notice clears the moment the model becomes frontier.
      setCreationModel(await window.electronAPI.twinGetCreationModel());
    } catch {
      // Non-blocking — the "Continue with local model anyway" escape still stands.
    } finally {
      setApplying(false);
    }
  };

  const goToSettings = () => navigate('/settings');

  const notice = (
    <SotaNotice
      frontierLabel={frontierLabel}
      applying={applying}
      onUseFrontier={() => void handleUseFrontier()}
      onContinueAnyway={() => onChoose('deep')}
      onConfigure={goToSettings}
    />
  );

  const modelLine = creationModel
    ? creationModel.modelLabel
      ? `${creationModel.providerLabel} · ${creationModel.modelLabel}`
      : creationModel.providerLabel
    : 'Checking…';

  return (
    <div className="space-y-5">
      <div>
        <label className="block">
          <span className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
            In a sentence or two, who is your twin?
          </span>
          <span className="block text-xs text-[var(--color-text-secondary)] mb-2 break-words">
            Optional — your own words. This seeds whichever path you pick below and steers every brief, chat, and
            triage.
          </span>
          <textarea
            value={brief}
            onChange={(e) => onBriefChange(e.target.value)}
            rows={3}
            placeholder="e.g. A senior product manager at a fintech startup, focused on payments, who values concise, direct communication."
            className="w-full text-sm bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] resize-y"
          />
        </label>
        <p className="mt-2 text-xs font-data text-[var(--color-text-muted)] break-words">
          Creation model: <span className="text-[var(--color-text-secondary)]">{modelLine}</span>
        </p>
      </div>

      <div className="space-y-3">
        <ModeCard
          icon={FileText}
          title="Quick form"
          description="Fill your profile section by section — fully usable with no AI. The fastest way to a complete twin."
          gated={false}
          notice={null}
          onSelect={() => onChoose('quick')}
        />
        <ModeCard
          icon={MessagesSquare}
          title="Deep interview"
          description="Answer a short, guided conversation and let the assistant draft your profile from it."
          gated={gated}
          notice={notice}
          onSelect={() => onChoose('deep')}
        />
        <ModeCard
          icon={History}
          title="Build from my history"
          description="Draft your twin from your meetings, briefs, projects, and cards — with your consent first."
          gated={gated}
          notice={
            <SotaNotice
              frontierLabel={frontierLabel}
              applying={applying}
              onUseFrontier={() => void handleUseFrontier()}
              onContinueAnyway={() => onChoose('history')}
              onConfigure={goToSettings}
            />
          }
          onSelect={() => onChoose('history')}
        />
      </div>
    </div>
  );
}
