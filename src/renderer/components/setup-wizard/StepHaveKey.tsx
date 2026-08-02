// === FILE PURPOSE ===
// "Set up AI" branching step. Running on this computer is the headline option
// and comes first: LifeDash ships the runtime, so the local path no longer means
// "install Ollama and use a terminal". LM Studio / Ollama survive as the
// bring-your-own sub-option, and the cloud paths follow, unchanged.

import { ArrowRight, Cloud, Cpu, HelpCircle, Monitor } from 'lucide-react';
import HelpTip from '../HelpTip';

/** Local runtimes the user may already be running themselves. */
export type ExistingLocalRuntime = 'lmstudio' | 'ollama';

interface StepHaveKeyProps {
  /** Bundled llama.cpp path — pick a model, download it, done. */
  onUseBuiltin: () => void;
  /** Bring-your-own local server (existing detection + tutorial flow). */
  onUseExistingLocal: (provider: ExistingLocalRuntime) => void;
  onHaveKey: () => void;
  onGetHelp: () => void;
  onSkip: () => void;
}

const CARD = 'w-full text-left p-4 rounded-lg border bg-[var(--color-chrome)] transition-all overflow-hidden';
const PLAIN_CARD = `${CARD} border-[var(--color-border)] hover:border-[var(--color-border-accent)]`;

const BYO_BUTTON =
  'flex items-center gap-1.5 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-2.5 py-1 rounded-lg text-xs transition-colors';

export default function StepHaveKey({
  onUseBuiltin,
  onUseExistingLocal,
  onHaveKey,
  onGetHelp,
  onSkip,
}: StepHaveKeyProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-hud text-base tracking-wide text-[var(--color-text-primary)] mb-1">Set up AI</h2>
        <p className="text-xs text-[var(--color-text-secondary)]">Choose how you'd like to connect AI to LifeDash.</p>
      </div>

      <div className="flex flex-col gap-3">
        {/* Option A — the headline: AI that runs here. Not a <button>, because it
            carries its own actions (a button inside a button is invalid). */}
        <div className={`${CARD} border-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)]`}>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-[var(--color-accent)]">
              <Cpu size={20} aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <div className="font-medium text-sm text-[var(--color-text-primary)] flex flex-wrap items-center gap-1 break-words">
                Private — AI runs on this computer
                <span className="text-[0.625rem] px-1.5 py-0.5 rounded font-medium bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
                  Recommended
                </span>
                <HelpTip text="LifeDash includes the engine that runs AI models — there is nothing to install and no terminal involved. You pick a model from a short list, LifeDash downloads it once (several gigabytes; the next step shows each model's exact size) and runs it here. No account, no API key, no usage costs." />
              </div>
              <div className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-relaxed break-words">
                Nothing to install and no API key. Pick a model, LifeDash downloads it once, and your meetings, notes
                and transcripts never leave this device.
              </div>

              <button
                type="button"
                onClick={onUseBuiltin}
                className="mt-3 w-full flex items-center justify-center gap-2 py-2 btn-primary clip-corner-cut-sm text-sm font-medium"
              >
                Set up the built-in AI
                <ArrowRight size={15} aria-hidden="true" />
              </button>

              {/* Sub-option: bring your own local server. */}
              <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] break-words">
                  <Monitor size={13} aria-hidden="true" />
                  Already running your own?
                  <HelpTip text="If you already use LM Studio or Ollama, LifeDash can talk to the models you have loaded there instead of downloading its own." />
                </span>
                <button type="button" onClick={() => onUseExistingLocal('lmstudio')} className={BYO_BUTTON}>
                  LM Studio
                </button>
                <button type="button" onClick={() => onUseExistingLocal('ollama')} className={BYO_BUTTON}>
                  Ollama
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Option B — cloud, with an honest note about where the data goes. */}
        <button type="button" onClick={onHaveKey} className={PLAIN_CARD}>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-[var(--color-text-secondary)]">
              <Cloud size={20} aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <div className="font-medium text-sm text-[var(--color-text-primary)] flex items-center gap-1 break-words">
                Cloud — I have an API key
                <HelpTip text="A secret code that lets LifeDash talk to AI services like OpenAI or Anthropic. You get one by creating a free account on their website." />
              </div>
              <div className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-relaxed break-words">
                The most capable models, billed per request. Whatever you send — prompts, transcripts, notes — goes to
                that provider.
              </div>
            </div>
            <ArrowRight size={16} className="mt-0.5 text-[var(--color-text-muted)]" aria-hidden="true" />
          </div>
        </button>

        {/* Option C — guided key signup. */}
        <button type="button" onClick={onGetHelp} className={PLAIN_CARD}>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-[var(--color-text-secondary)]">
              <HelpCircle size={20} aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <div className="font-medium text-sm text-[var(--color-text-primary)] break-words">
                Help me get a cloud API key
              </div>
              <div className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-relaxed break-words">
                Takes about 2 minutes. We'll walk you through it.
              </div>
            </div>
            <ArrowRight size={16} className="mt-0.5 text-[var(--color-text-muted)]" aria-hidden="true" />
          </div>
        </button>
      </div>

      {/* Option D: Skip */}
      <button
        type="button"
        onClick={onSkip}
        className="w-full py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors text-center"
      >
        Skip for now
      </button>
    </div>
  );
}
